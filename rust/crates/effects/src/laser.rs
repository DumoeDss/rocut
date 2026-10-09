use crate::pipeline::read_number_uniform;
use crate::stylized_catalog::{Definition, Field};
use crate::{EffectPass, EffectsError};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct LaserUniformBuffer {
    resolution_direction: [f32; 4],
    controls: [f32; 4],
    color_glow: [f32; 4],
    padding: [f32; 4],
}

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: key != "direction",
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "laser",
        version: 1,
        name: "Laser",
        animated: false,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field("progress", "Reveal progress", [0.0, 1.0, 0.001, 0.0]),
            field(
                "direction",
                "Direction (left/right/top/bottom)",
                [0.0, 3.0, 1.0, 0.0],
            ),
            field(
                "width",
                "Laser width (short-side fraction)",
                [0.0, 0.25, 0.001, 0.015],
            ),
            field(
                "feather",
                "Reveal softness (laser width fraction)",
                [0.0, 1.0, 0.01, 0.25],
            ),
            field("glow", "Laser glow", [0.0, 1.0, 0.01, 0.65]),
            field("colorR", "Laser red", [0.0, 1.0, 0.01, 0.2]),
            field("colorG", "Laser green", [0.0, 1.0, 0.01, 0.85]),
            field("colorB", "Laser blue", [0.0, 1.0, 0.01, 1.0]),
        ],
    }
}

pub(crate) fn pack_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<LaserUniformBuffer, EffectsError> {
    if pass.shader != "laser" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let definition = definition();
    let mut values = std::collections::BTreeMap::new();
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    for field in &definition.fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite()
            || value < field.min as f32
            || value > field.max as f32
            || (field.key == "direction" && value.fract() != 0.0)
        {
            return Err(invalid(field.key));
        }
        values.insert(field.key, value);
    }
    let frame = read_number_uniform(pass, "frame")?;
    if !frame.is_finite() || !(0.0..16_777_216.0).contains(&frame) || frame.fract() != 0.0 {
        return Err(invalid("frame"));
    }
    for key in pass.uniforms.keys() {
        if key != "frame" && !definition.fields.iter().any(|field| field.key == key) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    Ok(LaserUniformBuffer {
        resolution_direction: [width as f32, height as f32, values["direction"], 0.0],
        controls: ["amount", "progress", "width", "feather"].map(|key| values[key]),
        color_glow: ["colorR", "colorG", "colorB", "glow"].map(|key| values[key]),
        padding: [0.0; 4],
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
            shader: "laser".into(),
            uniforms,
        }
    }

    #[test]
    fn packs_the_exact_laser_layout_and_does_not_pack_the_clock() {
        let mut p = pass();
        p.uniforms
            .insert("direction".into(), UniformValue::Number(3.0));
        p.uniforms
            .insert("progress".into(), UniformValue::Number(0.425));
        let packed = pack_uniforms(&p, 64, 32).unwrap();
        assert_eq!(std::mem::size_of::<LaserUniformBuffer>(), 64);
        assert_eq!(packed.resolution_direction, [64.0, 32.0, 3.0, 0.0]);
        assert_eq!(packed.controls, [1.0, 0.425, 0.015, 0.25]);
        assert_eq!(packed.color_glow, [0.2, 0.85, 1.0, 0.65]);
        assert_eq!(packed.padding, [0.0; 4]);
        p.uniforms
            .insert("frame".into(), UniformValue::Number(16777215.0));
        assert_eq!(
            bytemuck::bytes_of(&packed),
            bytemuck::bytes_of(&pack_uniforms(&p, 64, 32).unwrap())
        );
    }

    #[test]
    fn rejects_malformed_direction_fields_and_raw_uniforms() {
        for field in definition().fields {
            for value in [
                field.min as f32 - 1.0,
                field.max as f32 + 1.0,
                f32::NAN,
                f32::INFINITY,
            ] {
                let mut p = pass();
                p.uniforms
                    .insert(field.key.into(), UniformValue::Number(value));
                assert!(
                    matches!(
                        pack_uniforms(&p, 32, 16),
                        Err(EffectsError::InvalidNumberUniform { .. })
                    ),
                    "{}={value}",
                    field.key
                );
            }
            let mut p = pass();
            p.uniforms
                .insert(field.key.into(), UniformValue::Vector(vec![0.0]));
            assert!(pack_uniforms(&p, 32, 16).is_err());
            p.uniforms.remove(field.key);
            assert!(matches!(
                pack_uniforms(&p, 32, 16),
                Err(EffectsError::MissingUniform { .. })
            ));
        }
        for (key, value) in [
            ("direction", 1.5),
            ("frame", -1.0),
            ("frame", 0.5),
            ("frame", 16777216.0),
            ("frame", f32::NAN),
            ("frame", f32::INFINITY),
        ] {
            let mut p = pass();
            p.uniforms.insert(key.into(), UniformValue::Number(value));
            assert!(pack_uniforms(&p, 32, 16).is_err(), "{key}={value}");
        }
        let mut missing = pass();
        missing.uniforms.remove("frame");
        assert!(matches!(
            pack_uniforms(&missing, 32, 16),
            Err(EffectsError::MissingUniform { .. })
        ));
        let mut unknown = pass();
        unknown
            .uniforms
            .insert("typo".into(), UniformValue::Number(1.0));
        assert!(matches!(
            pack_uniforms(&unknown, 32, 16),
            Err(EffectsError::UnsupportedUniform { .. })
        ));
        let mut other = pass();
        other.shader = "lens".into();
        assert!(matches!(
            pack_uniforms(&other, 32, 16),
            Err(EffectsError::UnknownEffectShader { .. })
        ));
    }
}
