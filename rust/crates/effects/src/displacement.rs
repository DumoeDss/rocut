use crate::pipeline::{EffectUniformBuffer, read_number_uniform};
use crate::stylized_catalog::{Definition, Field};
use crate::stylized_uniforms::StylizedUniformBuffer;
use crate::{EffectPass, EffectsError};

fn field(
    key: &'static str,
    label: &'static str,
    min: f64,
    max: f64,
    step: f64,
    default: f64,
) -> Field {
    Field {
        key,
        label,
        min,
        max,
        step,
        default,
        keyframable: key != "seed",
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "displacement",
        version: 1,
        name: "Displacement",
        animated: false,
        fields: vec![
            field("amount", "Amount", 0.0, 1.0, 0.01, 1.0),
            field(
                "displacement",
                "Displacement (short-side fraction)",
                -0.25,
                0.25,
                0.001,
                0.04,
            ),
            field("cellSize", "Grid spacing (pixels)", 4.0, 256.0, 0.1, 32.0),
            field("dispersion", "Chromatic dispersion", 0.0, 0.1, 0.001, 0.0),
            field("seed", "Seed", 0.0, 65535.0, 1.0, 1.0),
            field(
                "centerX",
                "Center X (width fraction)",
                -1.0,
                2.0,
                0.001,
                0.5,
            ),
            field(
                "centerY",
                "Center Y (height fraction)",
                -1.0,
                2.0,
                0.001,
                0.5,
            ),
            field(
                "radius",
                "Radius (short-side fraction)",
                0.0,
                2.0,
                0.001,
                0.5,
            ),
            field(
                "feather",
                "Edge softness (radius fraction)",
                0.0,
                1.0,
                0.01,
                0.15,
            ),
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
            scalars: ["amount", "displacement", "cellSize", "dispersion"].map(|key| values[key]),
        },
        region: ["centerX", "centerY", "radius", "feather"].map(|key| values[key]),
        mode: [1.0, 0.0, 0.0, 0.0],
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn displacement_shader_naga_validation() {
        let source = format!(
            "{}\n{}\n{}",
            include_str!("shaders/spatial_region.wgsl"),
            include_str!("shaders/lens_sampling.wgsl"),
            include_str!("shaders/displacement.wgsl")
        );
        let module = wgpu::naga::front::wgsl::parse_str(&source).unwrap();
        wgpu::naga::valid::Validator::new(
            wgpu::naga::valid::ValidationFlags::all(),
            wgpu::naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap();
    }

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
            shader: "displacement".into(),
            uniforms,
        }
    }

    #[test]
    fn packs_continuous_grid_geometry_and_discrete_seed() {
        let mut p = pass();
        p.uniforms
            .insert("cellSize".into(), UniformValue::Number(8.5));
        p.uniforms
            .insert("displacement".into(), UniformValue::Number(-0.125));
        let packed = pack_uniforms(&p, 96, 64).unwrap();
        assert_eq!(packed.base.resolution, [96.0, 64.0]);
        assert_eq!(packed.base.direction, [0.0, 1.0]);
        assert_eq!(packed.base.scalars, [1.0, -0.125, 8.5, 0.0]);
        assert_eq!(packed.region, [0.5, 0.5, 0.5, 0.15]);
        assert_eq!(packed.mode, [1.0, 0.0, 0.0, 0.0]);
        assert_eq!(std::mem::size_of_val(&packed), 64);
    }

    #[test]
    fn raw_uniforms_reject_missing_mistyped_nonfinite_and_out_of_range_values() {
        for (key, value) in [
            ("amount", -0.1),
            ("amount", 1.1),
            ("displacement", -0.251),
            ("displacement", 0.251),
            ("cellSize", 3.9),
            ("cellSize", 256.1),
            ("dispersion", -0.001),
            ("dispersion", 0.101),
            ("seed", -1.0),
            ("seed", 65536.0),
            ("seed", 1.5),
            ("centerX", -1.1),
            ("centerY", 2.1),
            ("radius", -0.1),
            ("radius", 2.1),
            ("feather", -0.1),
            ("feather", 1.1),
            ("frame", -1.0),
            ("frame", 16777216.0),
            ("frame", 0.5),
        ] {
            let mut p = pass();
            p.uniforms.insert(key.into(), UniformValue::Number(value));
            assert!(
                matches!(
                    pack_uniforms(&p, 64, 64),
                    Err(EffectsError::InvalidNumberUniform { .. })
                ),
                "{key}: {value}"
            );
        }
        for field in definition().fields {
            for invalid in [
                UniformValue::Number(f32::NAN),
                UniformValue::Number(f32::INFINITY),
                UniformValue::Vector(vec![1.0]),
            ] {
                let mut p = pass();
                p.uniforms.insert(field.key.into(), invalid);
                assert!(pack_uniforms(&p, 64, 64).is_err(), "{}", field.key);
            }
            let mut p = pass();
            p.uniforms.remove(field.key);
            assert!(matches!(
                pack_uniforms(&p, 64, 64),
                Err(EffectsError::MissingUniform { .. })
            ));
        }
        let mut p = pass();
        p.uniforms.insert("typo".into(), UniformValue::Number(0.0));
        assert!(matches!(
            pack_uniforms(&p, 64, 64),
            Err(EffectsError::UnsupportedUniform { .. })
        ));
        let mut p = pass();
        p.uniforms.remove("frame");
        assert!(matches!(
            pack_uniforms(&p, 64, 64),
            Err(EffectsError::MissingUniform { .. })
        ));
        let mut p = pass();
        p.shader = "lens".into();
        assert!(matches!(
            pack_uniforms(&p, 64, 64),
            Err(EffectsError::UnknownEffectShader { .. })
        ));
    }
}
