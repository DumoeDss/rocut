use crate::pipeline::read_number_uniform;
use crate::{EffectPass, EffectsError};

use super::{definition, field};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct BlazeUniformBuffer {
    pub(super) geometry: [f32; 4],
    pub(super) controls: [f32; 4],
    pub(super) motion: [f32; 4],
    pub(super) lattice: [[f32; 4]; field::FIELD_VECTORS],
    pub(super) sparks: [[f32; 4]; field::SPARKS],
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<BlazeUniformBuffer, EffectsError> {
    if pass.shader != "blaze" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 16_777_216
    {
        return Err(invalid("resolution"));
    }
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
    Ok(BlazeUniformBuffer {
        geometry: [
            width as f32,
            height as f32,
            values["height"],
            values["scale"],
        ],
        controls: [
            values["amount"],
            values["flameOpacity"],
            values["sparkOpacity"],
            values["smokeOpacity"],
        ],
        motion: [phase, values["wind"], values["refraction"], 0.0],
        lattice: field::lattice(values["seed"] as u32),
        sparks: field::sparks(values["seed"] as u32, phase),
    })
}
