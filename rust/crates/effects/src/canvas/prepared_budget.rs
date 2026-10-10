use super::{CanvasError, CanvasPass, CanvasReplayJob};
use crate::{EffectPass, UniformValue};

pub const MAX_PREPARATION_BYTES: u64 = 96 * 1024 * 1024;
pub const MAX_PREPARATION_WORK: u64 = 82_000_000;

/// Conservative logical allocation charges, not measured RSS. Captured bytes
/// and visible capacities are charged; opaque map buckets use bounded allowances.
/// Caller clones, GPU resources/readback/IPC copies, allocator metadata and stack
/// are outside this native owned-preparation budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanvasPreparationBudget {
    pub peak_bytes: u64,
    pub retained_pass_bytes: u64,
    pub captured_capacity_bytes: u64,
    pub replay_peak_bytes: u64,
    pub work: u64,
}
fn overflow() -> CanvasError {
    CanvasError("Canvas preparation budget arithmetic overflow")
}
pub(super) fn pass_charge(pass: &EffectPass) -> Result<u64, CanvasError> {
    // HashMap's precise bucket layout is private. 512/capacity intentionally
    // overcharges entry/control/bucket storage rather than pretending exact RSS.
    let mut bytes = (pass.uniforms.capacity() as u64)
        .checked_mul(512)
        .and_then(|v| v.checked_add(std::mem::size_of::<EffectPass>() as u64))
        .and_then(|v| v.checked_add(pass.shader.capacity() as u64))
        .ok_or_else(overflow)?;
    for (key, value) in &pass.uniforms {
        bytes = bytes
            .checked_add(key.capacity() as u64)
            .ok_or_else(overflow)?;
        if let UniformValue::Vector(values) = value {
            bytes = bytes
                .checked_add(
                    (values.capacity() as u64)
                        .checked_mul(4)
                        .ok_or_else(overflow)?,
                )
                .ok_or_else(overflow)?;
        }
    }
    Ok(bytes)
}
pub(super) fn admit(
    pass: &EffectPass,
    decoded: &CanvasPass,
    dimensions: [u32; 2],
    length: usize,
    capacity: usize,
) -> Result<CanvasPreparationBudget, CanvasError> {
    if capacity < length {
        return Err(CanvasError(
            "Canvas predicted capture capacity is smaller than exact bytes",
        ));
    }
    super::raster::dimensions(dimensions[0], dimensions[1], length)?;
    let replay = CanvasReplayJob::estimate(decoded.config(), decoded.strokes())?;
    let cells = u64::from(decoded.config().columns)
        .checked_mul(u64::from(decoded.config().rows))
        .ok_or_else(overflow)?;
    let retained_pass_bytes = pass_charge(pass)?;
    let captured_capacity_bytes = capacity as u64;
    let mut decoded_bytes = (decoded.parameters().len() as u64)
        .checked_mul(1024)
        .and_then(|v| v.checked_add(std::mem::size_of::<CanvasPass>() as u64))
        .and_then(|v| {
            v.checked_add(
                (decoded.strokes().len() as u64)
                    * std::mem::size_of::<super::CanvasStroke>() as u64,
            )
        })
        .ok_or_else(overflow)?;
    for key in decoded.parameters().keys() {
        decoded_bytes = decoded_bytes
            .checked_add(key.capacity() as u64)
            .ok_or_else(overflow)?;
    }
    // Conservatively overlap decoder, replay, temporary grid and two payload
    // arrays even though those phases do not all coexist. Headers included.
    let peak_bytes = retained_pass_bytes
        .checked_add(captured_capacity_bytes)
        .and_then(|v| v.checked_add(replay.peak_bytes))
        .and_then(|v| v.checked_add(cells.checked_mul(64)?))
        .and_then(|v| v.checked_add(decoded_bytes))
        .and_then(|v| v.checked_add(std::mem::size_of::<super::CanvasPreparation>() as u64))
        .and_then(|v| v.checked_add(std::mem::size_of::<super::PreparedCanvasPass>() as u64))
        .ok_or_else(overflow)?;
    let work = replay
        .full_duration_work
        .checked_add(cells.checked_mul(32).ok_or_else(overflow)?)
        .and_then(|v| v.checked_add((pass.uniforms.len() as u64).checked_mul(4096)?))
        .ok_or_else(overflow)?;
    if peak_bytes > MAX_PREPARATION_BYTES || work > MAX_PREPARATION_WORK {
        return Err(CanvasError("Canvas preparation peak/work budget exceeded"));
    }
    Ok(CanvasPreparationBudget {
        peak_bytes,
        retained_pass_bytes,
        captured_capacity_bytes,
        replay_peak_bytes: replay.peak_bytes,
        work,
    })
}
