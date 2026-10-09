//! Preparation-phase reservation, made before labels/crops/fracture/identity allocations.
use super::Binding;
use serde::Serialize;
const MAX: u64 = 256 * 1024 * 1024;
// 14 spokes / 9 radii: <=224 cells; each polygon <=18 jagged paths,
// each jagged path <=71 points (max chord 1368 / seg20). Vector growth,
// retained edge/cell clones, temporary reversed/concatenated paths and shards
// are jointly bounded below 12 MiB. Reserve 16 MiB, before fracture allocation.
const FRACTURE_BYTES: u64 = 16 * 1024 * 1024;
// Full validated image descriptor + decoded/derived SHA + struct/Vec/serializer
// bookkeeping per possible published part. Each retained chip uses >=50 pixels.
const IDENTITY_BYTES: u64 = 2048;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub ceiling_bytes: u64,
    pub encoded_source_bytes: u64,
    pub decoded_source_bytes: u64,
    pub native_source_bytes: u64,
    pub fracture_bytes: u64,
    pub identity_bytes: u64,
    pub max_parts: u64,
    pub component_budget_bytes: u64,
}
pub fn inspect(binding: &Binding, max_bytes: usize) -> Result<Admission, String> {
    if let Some(issue) =
        crate::programmatic_resources::validate(std::slice::from_ref(&binding.source)).first()
    {
        return Err(issue.message.clone());
    }
    if binding.source.kind != "image"
        || binding.algorithm != super::plan::prepared::ALGORITHM
        || binding.decoder != super::plan::prepared::DECODER
    {
        return Err("Invalid Heart preparation binding".into());
    }
    let decoded =
        crate::image_sequence::decoded_image_bytes(binding.decoded_width, binding.decoded_height)?;
    let parts = 1 + decoded / 4 / 50;
    let identity = parts
        .checked_mul(IDENTITY_BYTES)
        .ok_or("Heart preparation budget overflow")?;
    let reserved = decoded
        .checked_mul(2)
        .and_then(|v| v.checked_add(binding.source.byte_length()))
        .and_then(|v| v.checked_add(FRACTURE_BYTES))
        .and_then(|v| v.checked_add(identity))
        .and_then(|v| v.checked_add(64 * 1024))
        .ok_or("Heart preparation budget overflow")?;
    let ceiling = (max_bytes as u64).min(MAX);
    let component_budget = ceiling
        .checked_sub(reserved)
        .ok_or("Heart preparation residency exceeds admission ceiling")?;
    Ok(Admission {
        ceiling_bytes: ceiling,
        encoded_source_bytes: binding.source.byte_length(),
        decoded_source_bytes: decoded,
        native_source_bytes: decoded,
        fracture_bytes: FRACTURE_BYTES,
        identity_bytes: identity,
        max_parts: parts,
        component_budget_bytes: component_budget,
    })
}
pub fn reserve(binding: &Binding, rgba_len: usize, max_bytes: usize) -> Result<usize, String> {
    let decoded =
        crate::image_sequence::decoded_image_bytes(binding.decoded_width, binding.decoded_height)?;
    if decoded != rgba_len as u64 {
        return Err("Heart decoded source dimensions mismatch".into());
    }
    let admission = inspect(binding, max_bytes)?;
    // Source decoded RGBA + decoder/native source backing and encoded bytes
    // stay reserved; components additionally charge body and chip native copies.
    usize::try_from(admission.component_budget_bytes)
        .map_err(|_| "Heart preparation budget overflow".into())
}
