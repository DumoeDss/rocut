use crate::pipeline::{EffectUniformBuffer, read_number_uniform};
use crate::{EffectPass, EffectsError};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct StylizedUniformBuffer {
    // Existing shaders consume this unchanged 32-byte prefix.
    pub(crate) base: EffectUniformBuffer,
    pub(crate) region: [f32; 4],
    pub(crate) mode: [f32; 4],
}

pub(crate) fn pack_stylized_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<StylizedUniformBuffer, EffectsError> {
    let definition = crate::stylized_catalog::definitions()
        .into_iter()
        .find(|d| d.id == pass.shader)
        .ok_or_else(|| EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        })?;
    let mut values = std::collections::BTreeMap::new();
    for field in &definition.fields {
        // Older raw ASCII/dither passes predate the optional local region.
        // Required controls remain strict; only additive region fields default.
        let value = if matches!(pass.shader.as_str(), "ascii" | "retro-dither")
            && matches!(
                field.key,
                "local" | "centerX" | "centerY" | "radius" | "feather"
            )
            && !pass.uniforms.contains_key(field.key)
        {
            field.default as f32
        } else {
            read_number_uniform(pass, field.key)?
        };
        if !value.is_finite()
            || value < field.min as f32
            || value > field.max as f32
            || (field.step == 1.0 && value.fract() != 0.0)
        {
            return Err(EffectsError::InvalidNumberUniform {
                shader: pass.shader.clone(),
                uniform: field.key.into(),
            });
        }
        values.insert(field.key, value);
    }
    let frame = read_number_uniform(pass, "frame")?;
    if !frame.is_finite() || !(0.0..16_777_216.0).contains(&frame) || frame.fract() != 0.0 {
        return Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: "frame".into(),
        });
    }
    for key in pass.uniforms.keys() {
        if key != "frame" && !definition.fields.iter().any(|f| f.key == key) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    let controls = std::array::from_fn(|i| values[definition.fields[i].key]);
    let region = ["centerX", "centerY", "radius", "feather"]
        .map(|key| values.get(key).copied().unwrap_or(0.0));
    Ok(StylizedUniformBuffer {
        base: EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [frame, values.get("seed").copied().unwrap_or(0.0)],
            scalars: controls,
        },
        region,
        mode: [
            if matches!(pass.shader.as_str(), "lens" | "magnify") {
                1.0
            } else {
                values.get("local").copied().unwrap_or(0.0)
            },
            values.get("hud").copied().unwrap_or(0.0),
            values.get("pulse").copied().unwrap_or(0.0),
            values.get("lineWidth").copied().unwrap_or(0.0),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::UniformValue;

    fn pass() -> EffectPass {
        EffectPass {
            shader: "vhs".into(),
            uniforms: [
                ("frame", 15.0),
                ("seed", 2.0),
                ("amount", 0.5),
                ("noise", 0.1),
                ("scanlines", 0.2),
                ("bleed", 2.0),
            ]
            .into_iter()
            .map(|(k, v)| (k.into(), UniformValue::Number(v)))
            .collect(),
        }
    }

    #[test]
    fn packs_exact_f32_clock_seed_and_controls() {
        let packed = pack_stylized_uniforms(&pass(), 64, 32).unwrap();
        assert_eq!(packed.base.resolution, [64.0, 32.0]);
        assert_eq!(packed.base.direction, [15.0, 2.0]);
        assert_eq!(packed.base.scalars, [0.5, 0.1, 0.2, 2.0]);
        assert_eq!(packed.mode, [0.0; 4]);
        assert_eq!(std::mem::size_of::<StylizedUniformBuffer>(), 64);
    }

    #[test]
    fn rejects_malformed_raw_compositor_uniforms() {
        for (key, value) in [
            ("frame", f32::NAN),
            ("frame", 16777216.0),
            ("frame", -1.0),
            ("seed", 0.5),
            ("noise", f32::INFINITY),
            ("amount", 2.0),
            ("typo", 0.0),
        ] {
            let mut p = pass();
            p.uniforms.insert(key.into(), UniformValue::Number(value));
            assert!(pack_stylized_uniforms(&p, 64, 32).is_err());
        }
        let mut missing = pass();
        missing.uniforms.remove("frame");
        assert!(pack_stylized_uniforms(&missing, 64, 32).is_err());
        let mut vector = pass();
        vector
            .uniforms
            .insert("seed".into(), UniformValue::Vector(vec![1.0]));
        assert!(pack_stylized_uniforms(&vector, 64, 32).is_err());
    }
}
