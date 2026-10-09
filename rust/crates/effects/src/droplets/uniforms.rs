use crate::pipeline::read_number_uniform;
use crate::{EffectPass, EffectsError};

use super::{MAX_DROPLETS, definition, geometry};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct DropletsUniformBuffer {
    pub(super) resolution_count: [f32; 4],
    pub(super) controls: [f32; 4],
    pub(super) drops: [[f32; 4]; MAX_DROPLETS],
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<DropletsUniformBuffer, EffectsError> {
    if pass.shader != "droplets" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    if width == 0 || height == 0 {
        return Err(invalid("resolution"));
    }
    let fields = definition().fields;
    let mut values = std::collections::BTreeMap::new();
    for field in &fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite()
            || !(field.min as f32..=field.max as f32).contains(&value)
            || (matches!(field.key, "count" | "seed") && value.fract() != 0.0)
        {
            return Err(invalid(field.key));
        }
        values.insert(field.key, value);
    }
    let phase = read_number_uniform(pass, "phase")?;
    if !phase.is_finite() || !(0.0..1.0).contains(&phase) {
        return Err(invalid("phase"));
    }
    for key in pass.uniforms.keys() {
        if key != "phase" && !fields.iter().any(|field| field.key == key) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    Ok(DropletsUniformBuffer {
        resolution_count: [width as f32, height as f32, values["count"], 0.0],
        controls: [
            values["amount"],
            values["refraction"],
            values["highlight"],
            0.0,
        ],
        drops: geometry::drops(
            values["count"] as usize,
            values["seed"] as u32,
            values["radius"],
            values["elongation"],
            phase,
        ),
    })
}
