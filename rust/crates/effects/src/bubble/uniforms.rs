use std::collections::BTreeMap;

use crate::{EffectPass, EffectsError, pipeline::read_number_uniform};

use super::{catalog, trajectory::MAX_BALLS};

pub(super) const CENTER_KEYS: [[&str; 2]; 24] = [
    ["center0X", "center0Y"],
    ["center1X", "center1Y"],
    ["center2X", "center2Y"],
    ["center3X", "center3Y"],
    ["center4X", "center4Y"],
    ["center5X", "center5Y"],
    ["center6X", "center6Y"],
    ["center7X", "center7Y"],
    ["center8X", "center8Y"],
    ["center9X", "center9Y"],
    ["center10X", "center10Y"],
    ["center11X", "center11Y"],
    ["center12X", "center12Y"],
    ["center13X", "center13Y"],
    ["center14X", "center14Y"],
    ["center15X", "center15Y"],
    ["center16X", "center16Y"],
    ["center17X", "center17Y"],
    ["center18X", "center18Y"],
    ["center19X", "center19Y"],
    ["center20X", "center20Y"],
    ["center21X", "center21Y"],
    ["center22X", "center22Y"],
    ["center23X", "center23Y"],
];

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct BubbleUniformBuffer {
    pub(super) geometry: [f32; 4],
    pub(super) field: [f32; 4],
    pub(super) optics: [f32; 4],
    pub(super) decoration: [f32; 4],
    pub(super) tint: [f32; 4],
    pub(super) color_a: [f32; 4],
    pub(super) color_b: [f32; 4],
    pub(super) bounds: [f32; 4],
    pub(super) centers: [[f32; 4]; 24],
}

#[derive(Debug, PartialEq)]
pub(super) struct WorkBudget {
    pub pixels: u64,
    pub field_terms: u64,
    pub bilinear_samples: u64,
    pub texel_loads: u64,
    pub target_bytes: u64,
}

fn budget_error(message: &str) -> EffectsError {
    EffectsError::BubbleWorkBudget {
        message: message.into(),
    }
}

pub(crate) fn validate_device_dimensions(
    width: u32,
    height: u32,
    maximum: u32,
) -> Result<(), EffectsError> {
    if width > maximum || height > maximum {
        return Err(budget_error(
            "Output dimensions exceed this device's max_texture_dimension_2d",
        ));
    }
    Ok(())
}

pub(super) fn work_budget(
    width: u32,
    height: u32,
    balls: u32,
    dispersion: bool,
    frost: bool,
) -> Result<WorkBudget, EffectsError> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err(budget_error(
            "Output width and height must each be in 1..8192",
        ));
    }
    if !(1..=MAX_BALLS).contains(&balls) {
        return Err(budget_error("Field requires 1..24 balls"));
    }
    let pixels = u64::from(width) * u64::from(height);
    let field_terms = pixels * u64::from(balls);
    let bilinear_samples = pixels * if dispersion { 3 } else { 1 } * if frost { 9 } else { 1 };
    if pixels > 8_388_608 {
        return Err(budget_error(
            "Output exceeds the 8388608-pixel / 32 MiB target limit",
        ));
    }
    if field_terms > 250_000_000 {
        return Err(budget_error("Output exceeds 250000000 field terms"));
    }
    if bilinear_samples > 240_000_000 {
        return Err(budget_error("Output exceeds 240000000 bilinear samples"));
    }
    Ok(WorkBudget {
        pixels,
        field_terms,
        bilinear_samples,
        texel_loads: bilinear_samples * 4,
        target_bytes: pixels * 4,
    })
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<BubbleUniformBuffer, EffectsError> {
    if pass.shader != "bubble" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    let fields = catalog::optical_fields();
    let mut values = BTreeMap::new();
    for field in &fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite() || !(field.min as f32..=field.max as f32).contains(&value) {
            return Err(invalid(field.key));
        }
        values.insert(field.key, value);
    }
    let phase = read_number_uniform(pass, "phase")?;
    if !phase.is_finite() || !(0.0..1.0).contains(&phase) {
        return Err(invalid("phase"));
    }
    let balls = read_number_uniform(pass, "ballCount")?;
    if !balls.is_finite() || !(1.0..=MAX_BALLS as f32).contains(&balls) || balls.fract() != 0.0 {
        return Err(invalid("ballCount"));
    }
    let count = balls as usize;
    for key in pass.uniforms.keys() {
        if key == "phase"
            || key == "ballCount"
            || fields.iter().any(|field| field.key == key)
            || CENTER_KEYS[..count]
                .iter()
                .flatten()
                .any(|candidate| *candidate == key)
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
        balls as u32,
        values["dispersion"] != 0.0,
        values["frost"] != 0.0,
    )?;
    let short = width.min(height) as f32;
    let mut centers = [[0.0; 4]; 24];
    let mut bounds = [
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    ];
    for (index, keys) in CENTER_KEYS[..count].iter().enumerate() {
        for (axis, key) in keys.iter().enumerate() {
            let value = read_number_uniform(pass, key)?;
            if !value.is_finite() || !(-1.0..=2.0).contains(&value) {
                return Err(invalid(key));
            }
            let scaled = value
                * if axis == 0 {
                    width as f32
                } else {
                    height as f32
                }
                / short;
            centers[index][axis] = scaled;
            bounds[axis] = bounds[axis].min(scaled);
            bounds[axis + 2] = bounds[axis + 2].max(scaled);
        }
    }
    let radius = values["radius"];
    let margin = radius + 2.0 / short;
    for axis in 0..2 {
        bounds[axis] -= margin;
        bounds[axis + 2] += margin;
    }
    let epsilon_squared = (0.02 * radius) * (0.02 * radius);
    Ok(BubbleUniformBuffer {
        geometry: [width as f32, height as f32, short, values["amount"]],
        field: [
            radius,
            1.0 + 7.0 * (values["blend"] - 1.0) / 23.0,
            epsilon_squared,
            radius * radius + epsilon_squared,
        ],
        optics: [
            values["refraction"] * short,
            values["ior"],
            values["dispersion"],
            0.03 * values["frost"] * short,
        ],
        decoration: [
            values["shine"],
            (0.45 * values["rim"]).min(0.95),
            values["iridescence"],
            values["intensity"],
        ],
        tint: [
            values["tintR"],
            values["tintG"],
            values["tintB"],
            values["tintStrength"],
        ],
        color_a: [
            values["colorAR"],
            values["colorAG"],
            values["colorAB"],
            phase,
        ],
        color_b: [
            values["colorBR"],
            values["colorBG"],
            values["colorBB"],
            balls,
        ],
        bounds,
        centers,
    })
}
