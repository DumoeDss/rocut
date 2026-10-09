//! Bounded Rust JSON boundary for world-space particle surface sampling.
//!
//! Version 1 returns either {version, ok: true, samples} or
//! {version, ok: false, error: {code, path, message}}. No partial samples escape.
//! The input String has already been allocated by the bridge on entry. Its
//! capacity must fit 64 MiB; rejecting it cannot undo that earlier allocation.
//!
//! The 192 MiB budget counts input capacity, parsed input (including Vec growth),
//! prepared weights, sample capacity, final output capacity, and 64 KiB of fixed
//! parser/error scratch allowance. Input and parsed geometry are dropped before
//! output serialization. The bounded output Vec becomes the String without a
//! second buffer. JS-side copies, bridge transport copies outside this function,
//! allocator bookkeeping/fragmentation and the rest of the process are excluded.

use crate::particle_surface::{
    MAX_SURFACE_SAMPLES, MAX_SURFACE_WORKING_BYTES, SURFACE_FIXED_OVERHEAD_BYTES, SurfaceError,
    SurfaceErrorCode, SurfaceSample, SurfaceSampleResponse, sample_surface_json_with_allocation,
};
use serde::Serialize;
use std::{io, mem::size_of};

#[cfg(test)]
#[path = "particle_surface/motion_bridge_tests.rs"]
mod motion_tests;
#[cfg(test)]
mod tests;

pub(crate) const VERSION: u8 = 1;
pub(crate) const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const ENVELOPE_BYTES: usize = 128;
// At most 15 finite f64s (25 bytes each), three u32s (10 bytes each),
// fixed ASCII keys and punctuation. 768 bytes includes ample layout headroom.
pub(crate) const SAMPLE_JSON_BYTES: usize = 768;
// Motion adds three position floats plus one size float, with finite numeric
// spelling and fixed keys. The legacy reservation remains unchanged.
pub(crate) const MOTION_SAMPLE_JSON_BYTES: usize = 960;
const ERROR_OUTPUT_BYTES: usize = 4096;
const FALLBACK_ERROR: &str = "{\"version\":1,\"ok\":false,\"error\":{\"code\":\"serialization\",\"path\":\"surface\",\"message\":\"Unable to encode surface error\"}}";

#[derive(Serialize)]
struct SuccessEnvelope<'a> {
    version: u8,
    ok: bool,
    samples: &'a [SurfaceSample],
}

#[derive(Serialize)]
struct ErrorEnvelope<'a> {
    version: u8,
    ok: bool,
    error: &'a SurfaceError,
}

#[bridge::export]
pub fn sample_particle_surface_json(input: String) -> String {
    let result = sample_surface_json_with_allocation(&input, input.capacity());
    // The parsed request and prepared weights have also been dropped by the
    // sampling entry point. Serialization never overlaps those allocations.
    drop(input);
    match result {
        Ok(response) => match serialize_success(&response) {
            Ok(output) => output,
            Err(error) => {
                drop(response);
                serialize_error(&error)
            }
        },
        Err(error) => serialize_error(&error),
    }
}

fn bridge_error(code: SurfaceErrorCode, message: &str) -> SurfaceError {
    SurfaceError {
        code,
        path: "surface".into(),
        message: message.into(),
    }
}

fn output_budget(samples: usize, capacity: usize) -> Result<usize, SurfaceError> {
    output_budget_with_motion(samples, capacity, false)
}

fn output_budget_with_motion(
    samples: usize,
    capacity: usize,
    motion: bool,
) -> Result<usize, SurfaceError> {
    if samples > MAX_SURFACE_SAMPLES as usize {
        return Err(bridge_error(
            SurfaceErrorCode::OutputBytes,
            "Surface sample count exceeds the output budget",
        ));
    }
    let limit = samples
        .checked_mul(if motion {
            MOTION_SAMPLE_JSON_BYTES
        } else {
            SAMPLE_JSON_BYTES
        })
        .and_then(|bytes| bytes.checked_add(ENVELOPE_BYTES))
        .filter(|bytes| *bytes <= MAX_OUTPUT_BYTES)
        .ok_or_else(|| {
            bridge_error(
                SurfaceErrorCode::OutputBytes,
                "Surface output exceeds 64 MiB",
            )
        })?;
    let peak = capacity
        .checked_mul(size_of::<SurfaceSample>())
        .and_then(|bytes| bytes.checked_add(limit))
        .and_then(|bytes| bytes.checked_add(SURFACE_FIXED_OVERHEAD_BYTES));
    if peak.is_none_or(|bytes| bytes > MAX_SURFACE_WORKING_BYTES) {
        return Err(bridge_error(
            SurfaceErrorCode::WorkingBytes,
            "Surface samples and encoded output exceed the 192 MiB working-set budget",
        ));
    }
    Ok(limit)
}

fn serialize_success(response: &SurfaceSampleResponse) -> Result<String, SurfaceError> {
    let motion = response
        .samples
        .iter()
        .any(|sample| sample.motion_position.is_some() || sample.size.is_some());
    let limit = if motion {
        output_budget_with_motion(response.samples.len(), response.samples.capacity(), true)?
    } else {
        output_budget(response.samples.len(), response.samples.capacity())?
    };
    serialize_bounded(
        &SuccessEnvelope {
            version: VERSION,
            ok: true,
            samples: &response.samples,
        },
        limit,
    )
}

fn serialize_error(error: &SurfaceError) -> String {
    match serialize_bounded(
        &ErrorEnvelope {
            version: VERSION,
            ok: false,
            error,
        },
        ERROR_OUTPUT_BYTES,
    ) {
        Ok(output) => output,
        Err(_) => FALLBACK_ERROR.to_owned(),
    }
}

fn serialize_bounded<T: Serialize>(value: &T, limit: usize) -> Result<String, SurfaceError> {
    let mut writer = BoundedWriter::new(limit)?;
    if serde_json::to_writer(&mut writer, value).is_err() {
        let exceeded = writer.exceeded;
        drop(writer);
        return Err(if exceeded {
            bridge_error(
                SurfaceErrorCode::OutputBytes,
                "Surface JSON exceeded its bounded output allocation",
            )
        } else {
            bridge_error(
                SurfaceErrorCode::Serialization,
                "Unable to serialize surface JSON",
            )
        });
    }
    String::from_utf8(writer.bytes).map_err(|_| {
        bridge_error(
            SurfaceErrorCode::Serialization,
            "Surface serialization produced invalid UTF-8",
        )
    })
}

struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl BoundedWriter {
    fn new(limit: usize) -> Result<Self, SurfaceError> {
        if limit > MAX_OUTPUT_BYTES {
            return Err(bridge_error(
                SurfaceErrorCode::OutputBytes,
                "Surface output exceeds 64 MiB",
            ));
        }
        let mut bytes = Vec::new();
        bytes.try_reserve_exact(limit).map_err(|_| {
            bridge_error(
                SurfaceErrorCode::Allocation,
                "Unable to allocate surface JSON output",
            )
        })?;
        Ok(Self {
            bytes,
            limit,
            exceeded: false,
        })
    }
}

impl io::Write for BoundedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self
            .bytes
            .len()
            .checked_add(bytes.len())
            .is_none_or(|length| length > self.limit)
        {
            self.exceeded = true;
            return Err(io::ErrorKind::WriteZero.into());
        }
        // Capacity was reserved once; this never grows or partially writes.
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
