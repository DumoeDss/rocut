use super::catalog;
use crate::{EffectPass, EffectsError, pipeline::read_number_uniform};

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct FrostUniformBuffer {
    pub geometry: [f32; 4],
    pub optics: [f32; 4],
    pub tint: [f32; 4],
    pub metadata: [u32; 4],
    pub endpoints: [[f32; 4]; 16],
    pub states: [[f32; 4]; 16],
}
#[derive(Debug, PartialEq)]
pub(super) struct WorkBudget {
    pub pixels: u64,
    pub stroke_terms: u64,
    pub crystal_terms: u64,
    pub bilinear_samples: u64,
    pub texel_loads: u64,
    pub target_bytes: u64,
}
fn budget_error(message: &str) -> EffectsError {
    EffectsError::FrostWorkBudget {
        message: message.into(),
    }
}
pub(super) fn work_budget(
    width: u32,
    height: u32,
    count: u32,
    blur: bool,
    refraction: bool,
) -> Result<WorkBudget, EffectsError> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 || count > 16 {
        return Err(budget_error(
            "Frost dimensions must be 1..8192 and strokes 0..16",
        ));
    }
    let pixels = u64::from(width) * u64::from(height);
    let stroke_terms = pixels * u64::from(count);
    // Nine crystal feature cells times three needle axes. Input base is one
    // exact texel load. Each manual bilinear sample adds exactly four loads.
    let crystal_terms = pixels * 27;
    let bilinear_samples = pixels
        * if blur {
            9
        } else if refraction {
            1
        } else {
            0
        };
    if pixels > 8_388_608 {
        return Err(budget_error("Frost exceeds 8388608 pixels / 32 MiB target"));
    }
    if stroke_terms > 64_000_000 {
        return Err(budget_error("Frost exceeds 64000000 capsule evaluations"));
    }
    if bilinear_samples > 100_000_000 {
        return Err(budget_error("Frost exceeds 100000000 bilinear samples"));
    }
    Ok(WorkBudget {
        pixels,
        stroke_terms,
        crystal_terms,
        bilinear_samples,
        texel_loads: pixels + bilinear_samples * 4,
        target_bytes: pixels * 4,
    })
}
pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<FrostUniformBuffer, EffectsError> {
    if pass.shader != "frost" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    let fields = catalog::optical_fields();
    let mut values = std::collections::BTreeMap::new();
    for f in &fields {
        let value = read_number_uniform(pass, f.key)?;
        if !value.is_finite()
            || !(f.min as f32..=f.max as f32).contains(&value)
            || (f.step == 1.0 && value.fract() != 0.0)
        {
            return Err(invalid(f.key));
        }
        values.insert(f.key, value);
    }
    let count = read_number_uniform(pass, "strokeCount")?;
    if !count.is_finite() || !(0.0..=16.0).contains(&count) || count.fract() != 0.0 {
        return Err(invalid("strokeCount"));
    }
    let count = count as usize;
    for key in pass.uniforms.keys() {
        if key == "strokeCount"
            || fields.iter().any(|f| f.key == key)
            || catalog::STROKE_KEYS[..count]
                .iter()
                .any(|slot| slot[1..].contains(&key.as_str()))
        {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: pass.shader.clone(),
            uniform: key.clone(),
        });
    }
    work_budget(
        width,
        height,
        count as u32,
        values["blur"] != 0.0,
        values["refraction"] != 0.0,
    )?;
    let short = width.min(height) as f32;
    let mut endpoints = [[0.0; 4]; 16];
    let mut states = [[0.0; 4]; 16];
    for (index, keys) in catalog::STROKE_KEYS[..count].iter().enumerate() {
        for (component, key) in keys[1..].iter().enumerate() {
            let value = read_number_uniform(pass, key)?;
            let range = match component {
                0..=3 => -1.0..=2.0,
                4 => 0.005..=0.5,
                _ => 0.0..=1.0,
            };
            if !value.is_finite() || !range.contains(&value) {
                return Err(invalid(key));
            }
            if component < 4 {
                endpoints[index][component] = value
                    * if component % 2 == 0 {
                        width as f32 / short
                    } else {
                        height as f32 / short
                    };
            } else {
                states[index][component - 4] = value;
            }
        }
    }
    Ok(FrostUniformBuffer {
        geometry: [width as f32, height as f32, short, values["amount"]],
        optics: [
            values["coverage"],
            values["scale"],
            values["blur"] * short,
            values["refraction"] * short,
        ],
        tint: [
            values["tintR"],
            values["tintG"],
            values["tintB"],
            values["tintStrength"],
        ],
        metadata: [values["seed"] as u32, count as u32, 0, 0],
        endpoints,
        states,
    })
}
