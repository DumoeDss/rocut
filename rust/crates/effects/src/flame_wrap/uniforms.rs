use super::{definition, model};
use crate::pipeline::read_number_uniform;
use crate::{EffectPass, EffectsError};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct FlameWrapUniformBuffer {
    pub(crate) geometry: [f32; 4],
    pub(crate) controls: [f32; 4],
    pub(crate) motion: [f32; 4],
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<FlameWrapUniformBuffer, EffectsError> {
    if pass.shader != "flame_wrap" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    let fields = definition().fields;
    let mut values = std::collections::BTreeMap::new();
    for field in &fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite()
            || !(field.min as f32..=field.max as f32).contains(&value)
            || (field.key == "seed" && value.fract() != 0.0)
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
    model::preflight(
        width,
        height,
        values["boundaryWidth"],
        values["flameHeight"],
    )
    .map_err(|_| invalid("resolution/workBudget"))?;
    Ok(FlameWrapUniformBuffer {
        geometry: [
            width as f32,
            height as f32,
            values["boundaryWidth"],
            values["flameHeight"],
        ],
        controls: [
            values["amount"],
            values["flameOpacity"],
            values["sparkOpacity"],
            values["refraction"],
        ],
        motion: [phase, values["wind"], values["seed"], 0.0],
    })
}
