//! Versioned particle transport policy for native and WASM consumers.
//!
//! Kernel limits describe the existing Rust sampling/serialization boundary.
//! Host defaults are a conservative profile for a future frame driver, not
//! limits enforced by this publication function or a process-memory guarantee.
//! All geometry and byte ceilings apply independently; reaching one maximum
//! does not promise that the other ceilings can also be reached.
//!
//! Version 1 reserves, without refund until the frame ends:
//! N * (request JSON + response JSON + request envelope + response envelope)
//! + worker pending * request JSON + one active worker response JSON.
//! N is the whole frame request limit, not the in-flight limit: replies can
//! outlive sampling while CDP acknowledges delivery. Count complete UTF-8 JSON
//! envelopes after escaping, never just their nested raw strings.
//!
//! This is a logical retained-payload budget. Additional UTF-16/IPC/CDP copies,
//! parsed JS objects, allocator overhead, authored/Three resources and other
//! process memory are outside it and outside the kernel's Rust working set.
//! Future admission must enforce both the frame reservation and actual bytes.
//! Compilation identity must bind the complete effective policy, not version
//! alone; changing recommendations can alter admission without changing shape.

use crate::particle_surface::{
    MAX_SURFACE_JSON_BYTES, MAX_SURFACE_JSON_TOKEN_BYTES, MAX_SURFACE_SAMPLES,
    MAX_SURFACE_TRIANGLES, MAX_SURFACE_WORKING_BYTES,
};
use crate::particle_surface_bridge::{MAX_OUTPUT_BYTES, VERSION as SURFACE_VERSION};
use serde::Serialize;

#[cfg(test)]
mod tests;

const MIB: usize = 1024 * 1024;
const ENVELOPE_HEADROOM_BYTES: usize = 4096;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParticleTransportPolicy {
    version: u8,
    operation: &'static str,
    surface_version: u8,
    transport_version: u8,
    kernel: KernelLimits,
    host_defaults: HostDefaults,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KernelLimits {
    max_triangles: usize,
    max_samples: u32,
    max_input_json_bytes: usize,
    max_output_json_bytes: usize,
    max_working_bytes: usize,
    max_json_token_bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostDefaults {
    max_triangles: usize,
    max_samples: u32,
    max_request_json_bytes: usize,
    max_response_json_bytes: usize,
    max_request_envelope_bytes: usize,
    max_response_envelope_bytes: usize,
    max_requests_per_frame: usize,
    max_in_flight: usize,
    max_frame_retained_payload_bytes: usize,
    request_timeout_ms: u32,
    frame_timeout_ms: u32,
    process: ProcessDefaults,
    cleanup_timeout_ms: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessDefaults {
    max_pending_requests: usize,
    init_timeout_ms: u32,
    termination_timeout_ms: u32,
}

fn policy() -> ParticleTransportPolicy {
    let request_bytes = 2 * MIB;
    let response_bytes = 4 * MIB;
    ParticleTransportPolicy {
        version: 1,
        operation: "particleSurface",
        surface_version: SURFACE_VERSION,
        transport_version: 1,
        kernel: KernelLimits {
            max_triangles: MAX_SURFACE_TRIANGLES,
            max_samples: MAX_SURFACE_SAMPLES,
            max_input_json_bytes: MAX_SURFACE_JSON_BYTES,
            max_output_json_bytes: MAX_OUTPUT_BYTES,
            max_working_bytes: MAX_SURFACE_WORKING_BYTES,
            max_json_token_bytes: MAX_SURFACE_JSON_TOKEN_BYTES,
        },
        host_defaults: HostDefaults {
            max_triangles: 16_384,
            max_samples: 4096,
            max_request_json_bytes: request_bytes,
            max_response_json_bytes: response_bytes,
            // Headroom is not an authorization or identity-length exemption.
            // Future hosts must still check the entire encoded envelope.
            max_request_envelope_bytes: 2 * request_bytes + ENVELOPE_HEADROOM_BYTES,
            max_response_envelope_bytes: 2 * response_bytes + ENVELOPE_HEADROOM_BYTES,
            max_requests_per_frame: 2,
            max_in_flight: 1,
            max_frame_retained_payload_bytes: 64 * MIB,
            request_timeout_ms: 15_000,
            frame_timeout_ms: 30_000,
            process: ProcessDefaults {
                max_pending_requests: 1,
                init_timeout_ms: 5000,
                termination_timeout_ms: 5000,
            },
            cleanup_timeout_ms: 5000,
        },
    }
}

/// Return a deterministic policy snapshot for native and WASM consumers.
/// Publishing this capability does not itself enable a frame driver or enforce
/// these recommendations; transport consumers must be explicitly wired.
#[bridge::export]
pub fn particle_transport_policy_json() -> String {
    serde_json::to_string(&policy()).expect("finite static particle policy serializes")
}
