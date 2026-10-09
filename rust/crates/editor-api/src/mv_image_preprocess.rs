//! Transient, non-authored image preprocessing. The platform supplies admitted
//! Canvas RGBA facts; Rust owns identity, allocation, algorithm and publication.
//! No bridge exports yet: the render owner must supply joint residency costs.
use crate::programmatic_resources;
pub use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[path = "mv_image_preprocess/deflame.rs"]
mod deflame;
#[path = "mv_image_preprocess/envelope.rs"]
mod envelope;

pub const ALGORITHM: &str = "flame-deflame-v1";
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_UPDATES: u64 = 100_000_000;
const MAX_SESSIONS: usize = 64;
const MAX_STEP_PIXELS: u32 = 16_384;
// Parsed and retained bindings, serialized header and output envelope header,
// plus bounded registry/Vec bookkeeping. Payload copies are charged separately.
const METADATA_BYTES: u64 = 4 * envelope::MAX_HEADER as u64 + 4096;
fn upper_preparation_bytes(pixels: u64) -> Result<u64, String> {
    pixels
        .checked_mul(34)
        .and_then(|v| v.checked_add(METADATA_BYTES))
        .ok_or_else(|| "Flame memory budget overflow".into())
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
    pub flame_at: [f64; 6],
    pub algorithm: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Roi {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub binding: Binding,
    pub roi: Roi,
}

impl Request {
    pub fn new(binding: Binding) -> Result<Self, String> {
        let roi = binding.roi()?;
        Ok(Self { binding, roi })
    }
    pub fn patch_key(&self) -> Result<String, String> {
        if self.binding.roi()? != self.roi {
            return Err("Flame preprocessing request ROI mismatch".into());
        }
        serde_json::to_string(&self.binding).map_err(|e| e.to_string())
    }
}

impl Binding {
    pub fn roi(&self) -> Result<Roi, String> {
        if let Some(issue) =
            programmatic_resources::validate(std::slice::from_ref(&self.resource)).first()
        {
            return Err(issue.message.clone());
        }
        if self.resource.kind != "image" || self.algorithm != ALGORITHM {
            return Err("Invalid Flame preprocessing binding".into());
        }
        roi_for_dimensions(self.width, self.height, self.flame_at)
    }
    pub fn encode_rgba(&self, rgba: &[u8]) -> Result<Vec<u8>, String> {
        envelope::encode(self, self.roi()?, rgba)
    }
    pub fn decode_rgba<'a>(&self, encoded: &'a [u8]) -> Result<&'a [u8], String> {
        envelope::decode(self, self.roi()?, encoded)
    }
}

pub(crate) fn roi_for_dimensions(
    width: u32,
    height: u32,
    flame_at: [f64; 6],
) -> Result<Roi, String> {
    crate::image_sequence::decoded_image_bytes(width, height)?;
    let [cx, cy, base, rx, ry, cr] = flame_at;
    if !flame_at.iter().all(|v| v.is_finite())
        || flame_at.iter().any(|v| *v == 0.0 && v.is_sign_negative())
        || !(0.0..=width as f64).contains(&cx)
        || !(0.0..=height as f64).contains(&cy)
        || !(0.0..=height as f64).contains(&base)
        || rx <= 0.0
        || ry <= 0.0
        || cr <= 0.0
        || rx > 8192.0
        || ry > 8192.0
        || cr > 8192.0
    {
        return Err("Invalid Flame preprocessing geometry".into());
    }
    let ey = cy - ry * 0.3;
    let x0 = (cx - rx - 6.0).floor().max(0.0);
    let y0 = (ey - ry - 6.0).floor().max(0.0);
    let x1 = (cx + rx + 6.0).ceil().min(width as f64);
    let y1 = (ey + ry + 6.0).ceil().min(height as f64);
    if x1 <= x0 || y1 <= y0 {
        return Err("Flame preprocessing requires a nonempty ROI".into());
    }
    Ok(Roi {
        x: x0 as u32,
        y: y0 as u32,
        width: (x1 - x0) as u32,
        height: (y1 - y0) as u32,
    })
}

/// Internal render-owner admission, never an author-provided override. External
/// includes ALL concurrent encoded/decoded images, full-image surfaces, retained
/// patch caches and render scratch. Input/wasm readback and output copies are
/// conservatively charged inside the session as well.
pub struct Budget {
    pub external_bytes: u64,
    pub(crate) max_bytes: u64,
    pub(crate) max_channel_updates: u64,
}

impl Budget {
    pub fn joint(external_bytes: u64) -> Self {
        Self {
            external_bytes,
            max_bytes: MAX_BYTES,
            max_channel_updates: MAX_UPDATES,
        }
    }
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.max_bytes == 0
            || self.max_bytes > MAX_BYTES
            || self.external_bytes > self.max_bytes
            || self.max_channel_updates > MAX_UPDATES
        {
            return Err("Invalid Flame preprocessing budget".into());
        }
        Ok(())
    }
}

pub struct PreparedPatch {
    pub binding: Binding,
    pub roi: Roi,
    pub rgba: Vec<u8>,
    pub channel_updates: u64,
}

pub struct Progress {
    pub complete: bool,
    pub channel_updates: u64,
}

struct Entry {
    binding: Binding,
    roi: Roi,
    state: deflame::State,
    bytes: u64,
    updates: u64,
}

/// Owner-scoped registry; dropping the owner drops all sessions. No globals,
/// authored tickets or partially prepared results escape this boundary.
#[derive(Default)]
pub struct Sessions {
    entries: BTreeMap<u64, Entry>,
    next_id: u64,
    bytes: u64,
    updates: u64,
}

impl Sessions {
    pub fn begin_rgba(
        &mut self,
        expected: &Binding,
        rgba: &[u8],
        budget: &Budget,
    ) -> Result<u64, String> {
        budget.validate()?;
        if self.entries.len() >= MAX_SESSIONS {
            return Err("Flame preprocessing session limit exceeded".into());
        }
        let roi = expected.roi()?;
        let pixels = u64::from(roi.width)
            .checked_mul(u64::from(roi.height))
            .ok_or("Flame ROI size overflow")?;
        self.admit_bytes(upper_preparation_bytes(pixels)?, budget)?;
        let encoded = expected.encode_rgba(rgba)?;
        self.begin(expected, &encoded, budget)
    }
    pub fn admit_external(&self, external_bytes: u64) -> Result<(), String> {
        let budget = Budget::joint(external_bytes);
        budget.validate()?;
        self.admit_bytes(0, &budget)
    }
    pub fn begin(
        &mut self,
        expected: &Binding,
        input: &[u8],
        budget: &Budget,
    ) -> Result<u64, String> {
        budget.validate()?;
        if self.entries.len() >= MAX_SESSIONS {
            return Err("Flame preprocessing session limit exceeded".into());
        }
        let roi = expected.roi()?;
        let pixels = u64::from(roi.width)
            .checked_mul(u64::from(roi.height))
            .ok_or("Flame ROI size overflow")?;
        // 2 RGBA input/readbacks + 2 masks + float32 RGB + worst-case u32
        // indices + 2 RGBA output/transport copies, plus bounded metadata.
        // Conservative peak covers overlapping copies, including retained input.
        let upper = upper_preparation_bytes(pixels)?;
        self.admit_bytes(upper, budget)?;
        let rgba = envelope::decode(expected, roi, input)?;
        let mask = deflame::Mask::new(expected, roi, rgba)?;
        let updates = (mask.indices.len() as u64)
            .checked_mul(220 * 3)
            .ok_or("Flame work budget overflow")?;
        if self
            .updates
            .checked_add(updates)
            .ok_or("Flame work budget overflow")?
            > budget.max_channel_updates
        {
            return Err("Flame preprocessing exceeds the channel update budget".into());
        }
        let bytes = pixels
            .checked_mul(30)
            .and_then(|v| v.checked_add((mask.indices.len() as u64).checked_mul(4)?))
            .and_then(|v| v.checked_add(METADATA_BYTES))
            .ok_or("Flame memory budget overflow")?;
        self.admit_bytes(bytes, budget)?;
        let next = self
            .next_id
            .checked_add(1)
            .ok_or("Flame preprocessing session ID overflow")?;
        let state = deflame::State::new(roi, rgba, mask);
        self.bytes += bytes;
        self.updates += updates;
        self.next_id = next;
        self.entries.insert(
            next,
            Entry {
                binding: expected.clone(),
                roi,
                state,
                bytes,
                updates,
            },
        );
        Ok(next)
    }

    fn admit_bytes(&self, bytes: u64, budget: &Budget) -> Result<(), String> {
        if budget
            .external_bytes
            .checked_add(self.bytes)
            .and_then(|v| v.checked_add(bytes))
            .ok_or("Flame memory budget overflow")?
            > budget.max_bytes
        {
            return Err("Flame preprocessing exceeds the joint memory budget".into());
        }
        Ok(())
    }

    pub fn step(&mut self, id: u64, max_pixels: u32) -> Result<Progress, String> {
        if max_pixels == 0 || max_pixels > MAX_STEP_PIXELS {
            return Err("Flame preprocessing step must contain 1..16384 pixels".into());
        }
        let entry = self
            .entries
            .get_mut(&id)
            .ok_or("Unknown Flame preprocessing session")?;
        Ok(entry.state.step(max_pixels))
    }

    pub fn take(&mut self, id: u64, expected: &Binding) -> Result<PreparedPatch, String> {
        let entry = self
            .entries
            .get(&id)
            .ok_or("Unknown Flame preprocessing session")?;
        if &entry.binding != expected {
            return Err("Flame preprocessing result identity mismatch".into());
        }
        if !entry.state.complete() {
            return Err("Flame preprocessing is incomplete".into());
        }
        let entry = self.entries.remove(&id).expect("checked session");
        self.bytes -= entry.bytes;
        self.updates -= entry.updates;
        Ok(PreparedPatch {
            binding: entry.binding,
            roi: entry.roi,
            rgba: entry.state.finish(),
            channel_updates: entry.updates,
        })
    }

    pub fn dispose(&mut self, id: u64) {
        if let Some(entry) = self.entries.remove(&id) {
            self.bytes -= entry.bytes;
            self.updates -= entry.updates;
        }
    }
}

#[cfg(test)]
#[path = "mv_image_preprocess/tests.rs"]
mod tests;
