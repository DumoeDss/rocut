use std::num::NonZeroU64;

use crate::liquid_pass::LiquidPass;
use crate::liquid_replay::{LiquidReplayError, LiquidReplayJob, estimate_memory_bytes};
use crate::{EffectPass, EffectsError, UniformValue};

pub const LIQUID_REQUEST_MEMORY_LIMIT: u64 = 8 * 1024 * 1024;

fn replay_error(error: LiquidReplayError) -> EffectsError {
    if error.is_cancelled() {
        EffectsError::Cancelled
    } else {
        EffectsError::LiquidSimulation {
            message: format!("{error:?}"),
        }
    }
}

/// CPU-only, request-local preparation. No GPU handles or checkpoint cache.
pub struct LiquidPreparation {
    input: LiquidPass,
    pass: EffectPass,
    dimensions: [u32; 2],
    job: LiquidReplayJob,
    executed: u64,
}

pub struct PreparedLiquidPass {
    pass: EffectPass,
    dimensions: [u32; 2],
    pub(crate) grid: [u32; 2],
    pub(crate) cells: Vec<[f32; 4]>,
    pub(crate) optics: [f32; 4],
    pub(crate) color: [f32; 4],
}

impl LiquidPreparation {
    /// Conservative aggregate admission includes replay peak, retained raster,
    /// parsed parameters and both copies of the bounded pass transport.
    pub fn memory_budget(pass: &EffectPass) -> Result<u64, EffectsError> {
        let input = crate::liquid_pass::parse(pass)?;
        let config = &input.parameters.config;
        let replay =
            estimate_memory_bytes(config, input.parameters.events.len()).map_err(replay_error)?;
        let cells = u64::from(config.columns) * u64::from(config.rows) * 16;
        Ok(replay + cells + 32 * 1024)
    }

    pub fn new(pass: EffectPass, dimensions: [u32; 2]) -> Result<Self, EffectsError> {
        let input = crate::liquid_pass::parse(&pass)?;
        let job = LiquidReplayJob::new(
            &input.parameters.config,
            &input.parameters.events,
            dimensions,
            input.elapsed,
            input.parameters.duration_ticks,
            || false,
        )
        .map_err(replay_error)?;
        Ok(Self {
            input,
            pass,
            dimensions,
            job,
            executed: 0,
        })
    }

    pub fn advance(&mut self, steps: NonZeroU64) -> Result<(bool, u64), EffectsError> {
        let progress = self.job.advance(steps, || false).map_err(replay_error)?;
        let executed = progress
            .executed_steps
            .checked_sub(self.executed)
            .ok_or(EffectsError::InvalidPreparedLiquid)?;
        self.executed = progress.executed_steps;
        Ok((progress.is_complete(), executed))
    }

    pub fn finish(self) -> Result<PreparedLiquidPass, EffectsError> {
        let state = self.job.finish(|| false).map_err(replay_error)?;
        let nx = state.columns() as usize;
        let ny = state.rows() as usize;
        let mut cells = Vec::with_capacity(nx * ny);
        for y in 0..ny {
            for x in 0..nx {
                let values = [
                    (state.u()[y * (nx + 1) + x] + state.u()[y * (nx + 1) + x + 1]) * 0.5,
                    (state.v()[y * nx + x] + state.v()[(y + 1) * nx + x]) * 0.5,
                    state.dye()[y * nx + x],
                    0.0,
                ]
                .map(|value| value as f32);
                if !values.iter().all(|value| value.is_finite()) {
                    return Err(EffectsError::LiquidSimulation {
                        message: "Liquid state exceeds float32 raster precision".into(),
                    });
                }
                cells.push(values);
            }
        }
        let values = &self.input.parameters.values;
        Ok(PreparedLiquidPass {
            pass: self.pass,
            dimensions: self.dimensions,
            grid: [nx as u32, ny as u32],
            cells,
            optics: [
                values["amount"] as f32,
                values["refraction"] as f32,
                values["dyeOpacity"] as f32,
                0.0,
            ],
            color: [
                values["colorR"] as f32,
                values["colorG"] as f32,
                values["colorB"] as f32,
                0.0,
            ],
        })
    }

    pub fn complete(mut self) -> Result<PreparedLiquidPass, EffectsError> {
        while !self.advance(NonZeroU64::new(1).unwrap())?.0 {}
        self.finish()
    }
}

impl PreparedLiquidPass {
    pub fn matches(&self, pass: &EffectPass, dimensions: [u32; 2]) -> bool {
        self.dimensions == dimensions
            && self.pass.shader == pass.shader
            && self.pass.uniforms.len() == pass.uniforms.len()
            && self
                .pass
                .uniforms
                .iter()
                .all(|(key, value)| match (value, pass.uniforms.get(key)) {
                    (UniformValue::Number(a), Some(UniformValue::Number(b))) => {
                        a.to_bits() == b.to_bits()
                    }
                    (UniformValue::Vector(a), Some(UniformValue::Vector(b))) => {
                        a.len() == b.len()
                            && a.iter().zip(b).all(|(a, b)| a.to_bits() == b.to_bits())
                    }
                    _ => false,
                })
    }
}
