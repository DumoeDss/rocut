use crate::pipeline::read_number_uniform;
use crate::{EffectPass, EffectsError};

use super::{definition, field};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct CloudsUniformBuffer {
    pub(super) geometry: [f32; 4],
    pub(super) optics: [f32; 4],
    pub(super) wind_color: [f32; 4],
    pub(super) color_reserved: [f32; 4],
    pub(super) lattice: [[f32; 4]; field::FIELD_VECTORS],
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<CloudsUniformBuffer, EffectsError> {
    if pass.shader != "clouds" {
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
    Ok(CloudsUniformBuffer {
        geometry: [width as f32, height as f32, values["scale"], phase],
        optics: [
            values["amount"],
            values["density"],
            values["refraction"],
            values["fogOpacity"],
        ],
        wind_color: [
            values["windX"],
            values["windY"],
            values["colorR"],
            values["colorG"],
        ],
        color_reserved: [values["colorB"], 0.0, 0.0, 0.0],
        lattice: field::lattice(values["seed"] as u32),
    })
}
