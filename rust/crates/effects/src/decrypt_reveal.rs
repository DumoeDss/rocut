use crate::pipeline::{EffectUniformBuffer, read_number_uniform};
use crate::stylized_catalog::{Definition, Field};
use crate::stylized_uniforms::StylizedUniformBuffer;
use crate::{EffectPass, EffectsError};

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: key != "seed",
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "decrypt-reveal",
        version: 1,
        name: "Decrypt Reveal",
        animated: false,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field("progress", "Decrypt progress", [0.0, 1.0, 0.01, 0.5]),
            field(
                "cellSize",
                "Character width (pixels)",
                [6.0, 64.0, 0.1, 12.0],
            ),
            field(
                "contrast",
                "Density contrast (negative inverts)",
                [-2.0, 2.0, 0.01, 1.0],
            ),
            field("seed", "Seed", [0.0, 65535.0, 1.0, 1.0]),
            field(
                "centerX",
                "Center X (width fraction)",
                [-1.0, 2.0, 0.001, 0.5],
            ),
            field(
                "centerY",
                "Center Y (height fraction)",
                [-1.0, 2.0, 0.001, 0.5],
            ),
            field(
                "radius",
                "Radius (short-side fraction)",
                [0.0, 2.0, 0.001, 0.5],
            ),
            field(
                "feather",
                "Edge softness (radius fraction)",
                [0.0, 1.0, 0.01, 0.15],
            ),
            field("colorR", "Character red", [0.0, 1.0, 0.01, 0.2]),
            field("colorG", "Character green", [0.0, 1.0, 0.01, 1.0]),
            field("colorB", "Character blue", [0.0, 1.0, 0.01, 0.55]),
        ],
    }
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<StylizedUniformBuffer, EffectsError> {
    let definition = definition();
    if pass.shader != definition.id {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let mut values = std::collections::BTreeMap::new();
    for field in &definition.fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite()
            || value < field.min as f32
            || value > field.max as f32
            || (field.key == "seed" && value.fract() != 0.0)
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
        if key != "frame" && !definition.fields.iter().any(|field| field.key == key) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    Ok(StylizedUniformBuffer {
        base: EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [frame, values["seed"]],
            scalars: ["amount", "progress", "cellSize", "contrast"].map(|key| values[key]),
        },
        region: ["centerX", "centerY", "radius", "feather"].map(|key| values[key]),
        mode: [values["colorR"], values["colorG"], values["colorB"], 0.0],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::UniformValue;

    fn pass() -> EffectPass {
        let mut uniforms = definition()
            .fields
            .into_iter()
            .map(|field| (field.key.into(), UniformValue::Number(field.default as f32)))
            .collect::<std::collections::HashMap<_, _>>();
        uniforms.insert("frame".into(), UniformValue::Number(0.0));
        EffectPass {
            shader: "decrypt-reveal".into(),
            uniforms,
        }
    }

    #[test]
    fn packs_continuous_cell_geometry_color_and_fixed_seed() {
        let mut p = pass();
        p.uniforms
            .insert("cellSize".into(), UniformValue::Number(8.125));
        p.uniforms
            .insert("colorR".into(), UniformValue::Number(0.0));
        let packed = pack_uniforms(&p, 96, 64).unwrap();
        assert_eq!(packed.base.resolution, [96.0, 64.0]);
        assert_eq!(packed.base.direction, [0.0, 1.0]);
        assert_eq!(packed.base.scalars, [1.0, 0.5, 8.125, 1.0]);
        assert_eq!(packed.region, [0.5, 0.5, 0.5, 0.15]);
        assert_eq!(packed.mode, [0.0, 1.0, 0.55, 0.0]);
        assert_eq!(std::mem::size_of_val(&packed), 64);
    }

    #[test]
    fn rejects_invalid_missing_and_unknown_raw_uniforms() {
        for field in definition().fields {
            for invalid in [
                UniformValue::Number(f32::NAN),
                UniformValue::Number(f32::INFINITY),
                UniformValue::Number(field.min as f32 - 1.0),
                UniformValue::Number(field.max as f32 + 1.0),
                UniformValue::Vector(vec![1.0]),
            ] {
                let mut p = pass();
                p.uniforms.insert(field.key.into(), invalid);
                assert!(pack_uniforms(&p, 96, 64).is_err(), "{}", field.key);
            }
            let mut p = pass();
            p.uniforms.remove(field.key);
            assert!(matches!(
                pack_uniforms(&p, 96, 64),
                Err(EffectsError::MissingUniform { .. })
            ));
        }
        for (key, value) in [
            ("seed", 1.5),
            ("frame", -1.0),
            ("frame", 0.5),
            ("frame", 16_777_216.0),
        ] {
            let mut p = pass();
            p.uniforms.insert(key.into(), UniformValue::Number(value));
            assert!(matches!(
                pack_uniforms(&p, 96, 64),
                Err(EffectsError::InvalidNumberUniform { .. })
            ));
        }
        let mut p = pass();
        p.uniforms.insert("typo".into(), UniformValue::Number(0.0));
        assert!(matches!(
            pack_uniforms(&p, 96, 64),
            Err(EffectsError::UnsupportedUniform { .. })
        ));
        let mut p = pass();
        p.uniforms.remove("frame");
        assert!(matches!(
            pack_uniforms(&p, 96, 64),
            Err(EffectsError::MissingUniform { .. })
        ));
        let mut p = pass();
        p.shader = "ascii".into();
        assert!(matches!(
            pack_uniforms(&p, 96, 64),
            Err(EffectsError::UnknownEffectShader { .. })
        ));
    }
}
