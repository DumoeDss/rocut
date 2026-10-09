use super::{Binding, PreparedPatch, Roi};
use serde::{Deserialize, Serialize};

pub(super) const MAX_HEADER: usize = 4096;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    binding: Binding,
    roi: Roi,
}

/// Strict [u32LE header length][UTF-8 JSON][exact tightly packed RGBA8 ROI].
/// Identity is checked against Rust's requested binding, not the untrusted header.
pub(super) fn decode<'a>(
    expected: &Binding,
    roi: Roi,
    input: &'a [u8],
) -> Result<&'a [u8], String> {
    let prefix: [u8; 4] = input
        .get(..4)
        .ok_or("Missing Flame preprocessing envelope")?
        .try_into()
        .unwrap();
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > MAX_HEADER {
        return Err("Invalid Flame preprocessing header length".into());
    }
    let start = 4usize
        .checked_add(length)
        .ok_or("Flame envelope size overflow")?;
    let size = (roi.width as usize)
        .checked_mul(roi.height as usize)
        .and_then(|v| v.checked_mul(4))
        .ok_or("Flame ROI byte size overflow")?;
    if start.checked_add(size) != Some(input.len()) {
        return Err("Flame preprocessing requires exact ROI RGBA length".into());
    }
    let header: Header = serde_json::from_slice(&input[4..start])
        .map_err(|e| format!("Invalid Flame preprocessing header: {e}"))?;
    if &header.binding != expected || header.roi != roi {
        return Err("Flame preprocessing identity or ROI mismatch".into());
    }
    Ok(&input[start..])
}

impl PreparedPatch {
    /// One-shot binary output; no RGB array enters a frame JSON payload.
    pub fn into_envelope(self) -> Result<Vec<u8>, String> {
        encode(&self.binding, self.roi, &self.rgba)
    }
}

pub(super) fn encode(binding: &Binding, roi: Roi, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if binding.roi()? != roi
        || rgba.len() as u64 != u64::from(roi.width) * u64::from(roi.height) * 4
    {
        return Err("Flame preprocessing output identity or RGBA length mismatch".into());
    }
    let header = serde_json::to_vec(&Header {
        binding: binding.clone(),
        roi,
    })
    .map_err(|e| e.to_string())?;
    if header.is_empty() || header.len() > MAX_HEADER {
        return Err("Invalid Flame preprocessing output header length".into());
    }
    let length = 4usize
        .checked_add(header.len())
        .and_then(|v| v.checked_add(rgba.len()))
        .ok_or("Flame output size overflow")?;
    let mut output = Vec::with_capacity(length);
    output.extend_from_slice(&(header.len() as u32).to_le_bytes());
    output.extend_from_slice(&header);
    output.extend_from_slice(rgba);
    Ok(output)
}
