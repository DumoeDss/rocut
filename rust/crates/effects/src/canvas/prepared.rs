use super::{
    CanvasConfig, CanvasError, CanvasPreparationBudget, CanvasRasterPayload, CanvasReplayJob,
    CanvasReplayProgress, decode_pass, raster_payload, sample_rgba8_grid,
};
use crate::{EffectPass, UniformValue};
use std::num::NonZeroU64;

/// Owns caller-supplied full capture bytes, not proof of an ordered GPU capture.
#[derive(Debug)]
pub struct CanvasPreparation {
    pass: EffectPass,
    dimensions: [u32; 2],
    captured_rgba: Vec<u8>,
    config: CanvasConfig,
    job: CanvasReplayJob,
    budget: CanvasPreparationBudget,
}
impl CanvasPreparation {
    /// Preflight before GPU capture/full-source allocation. Decoding uses small
    /// bounded metadata allocations, but no pixel or replay allocation occurs.
    /// new() rechecks the real Vec capacity, not just this caller prediction.
    pub fn estimate(
        pass: &EffectPass,
        dimensions: [u32; 2],
        captured_capacity: usize,
    ) -> Result<CanvasPreparationBudget, CanvasError> {
        let raw_bytes = u64::from(dimensions[0])
            .checked_mul(u64::from(dimensions[1]))
            .and_then(|v| v.checked_mul(4))
            .and_then(|v| usize::try_from(v).ok())
            .ok_or(CanvasError("Canvas predicted capture byte overflow"))?;
        let decoded = decode_pass(pass)?;
        super::prepared_budget::admit(pass, &decoded, dimensions, raw_bytes, captured_capacity)
    }
    pub fn new(
        pass: EffectPass,
        dimensions: [u32; 2],
        captured_rgba: Vec<u8>,
    ) -> Result<Self, CanvasError> {
        let decoded = decode_pass(&pass)?;
        let budget = super::prepared_budget::admit(
            &pass,
            &decoded,
            dimensions,
            captured_rgba.len(),
            captured_rgba.capacity(),
        )?;
        // Sampling and replay allocation only happen after the complete budget.
        let source = sample_rgba8_grid(
            decoded.config(),
            &captured_rgba,
            dimensions[0],
            dimensions[1],
        )?;
        // Transport time is already shared-frame-floored. The shared 1-tick grid
        // preserves it exactly, rather than quantizing with a different FPS.
        let job = CanvasReplayJob::new(
            decoded.config(),
            decoded.strokes(),
            &source,
            decoded.sampled_ticks(),
            120000,
            1,
        )?;
        Ok(Self {
            config: *decoded.config(),
            pass,
            dimensions,
            captured_rgba,
            job,
            budget,
        })
    }
    pub fn progress(&self) -> CanvasReplayProgress {
        self.job.progress()
    }
    pub fn minimum_step_work(&self) -> NonZeroU64 {
        self.job.minimum_step_work()
    }
    pub fn budget(&self) -> &CanvasPreparationBudget {
        &self.budget
    }
    pub fn memory_bytes(&self) -> Option<u64> {
        self.job
            .memory_bytes()?
            .checked_add(self.captured_rgba.capacity() as u64)?
            .checked_add(super::prepared_budget::pass_charge(&self.pass).ok()?)?
            .checked_add(
                (std::mem::size_of::<Self>() - std::mem::size_of::<CanvasReplayJob>()) as u64,
            )
    }
    pub fn advance(&mut self, quota: NonZeroU64) -> Result<CanvasReplayProgress, CanvasError> {
        self.job.advance(quota)
    }
    pub fn finish(self) -> Result<PreparedCanvasPass, CanvasError> {
        let state = self.job.finish()?;
        let payload = raster_payload(
            &self.config,
            &state,
            &self.captured_rgba,
            self.dimensions[0],
            self.dimensions[1],
        )?;
        Ok(PreparedCanvasPass {
            pass: self.pass,
            dimensions: self.dimensions,
            captured_rgba: self.captured_rgba,
            payload,
            budget: self.budget,
        })
    }
}

/// Immutable owned source/pass/dimensions/payload binding. A renderer descriptor,
/// texture owner and preceding-effect capture barrier must still be bound outside.
#[derive(Debug)]
pub struct PreparedCanvasPass {
    pass: EffectPass,
    dimensions: [u32; 2],
    captured_rgba: Vec<u8>,
    payload: CanvasRasterPayload,
    budget: CanvasPreparationBudget,
}
impl PreparedCanvasPass {
    pub fn pass(&self) -> &EffectPass {
        &self.pass
    }
    pub fn dimensions(&self) -> [u32; 2] {
        self.dimensions
    }
    pub fn source_rgba(&self) -> &[u8] {
        &self.captured_rgba
    }
    pub fn payload(&self) -> &CanvasRasterPayload {
        &self.payload
    }
    pub fn budget(&self) -> &CanvasPreparationBudget {
        &self.budget
    }
    /// Exact f32 transport bits and key set, not float equality or a digest.
    pub fn matches(&self, pass: &EffectPass, dimensions: [u32; 2]) -> bool {
        self.dimensions == dimensions
            && self.pass.shader == pass.shader
            && self.pass.uniforms.len() == pass.uniforms.len()
            && self.pass.uniforms.iter().all(|(key, value)| {
                pass.uniforms
                    .get(key)
                    .is_some_and(|other| match (value, other) {
                        (UniformValue::Number(a), UniformValue::Number(b)) => {
                            a.to_bits() == b.to_bits()
                        }
                        (UniformValue::Vector(a), UniformValue::Vector(b)) => {
                            a.len() == b.len()
                                && a.iter().zip(b).all(|(a, b)| a.to_bits() == b.to_bits())
                        }
                        _ => false,
                    })
            })
    }
    pub fn memory_bytes(&self) -> Option<u64> {
        super::prepared_budget::pass_charge(&self.pass)
            .ok()?
            .checked_add(self.captured_rgba.capacity() as u64)?
            .checked_add((self.payload.pigment_coverage.capacity() as u64).checked_mul(16)?)?
            .checked_add((self.payload.height_wetness.capacity() as u64).checked_mul(16)?)?
            .checked_add(std::mem::size_of::<Self>() as u64)
    }
}
