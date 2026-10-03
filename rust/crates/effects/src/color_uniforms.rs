use crate::pipeline::{EffectUniformBuffer, read_number_uniform};
use crate::{ColorAdjustment, EffectPass, EffectsError, normalize_color_adjustment};

pub(crate) fn pack_color_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let params = normalize_color_adjustment(ColorAdjustment {
        exposure: read_number_uniform(pass, "exposure")?,
        contrast: read_number_uniform(pass, "contrast")?,
        saturation: read_number_uniform(pass, "saturation")?,
        temperature: read_number_uniform(pass, "temperature")?,
        tint: read_number_uniform(pass, "tint")?,
    });
    for uniform in pass.uniforms.keys() {
        if !["exposure", "contrast", "saturation", "temperature", "tint"]
            .contains(&uniform.as_str())
        {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: uniform.clone(),
            });
        }
    }
    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction: [params.tint, 0.0],
        scalars: [
            params.exposure,
            params.contrast,
            params.saturation,
            params.temperature,
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::UniformValue;

    fn pass() -> EffectPass {
        EffectPass {
            shader: "color-adjustment".into(),
            uniforms: [
                ("exposure", 1.0),
                ("contrast", 20.0),
                ("saturation", -50.0),
                ("temperature", 30.0),
                ("tint", -10.0),
            ]
            .into_iter()
            .map(|(key, value)| (key.into(), UniformValue::Number(value)))
            .collect(),
        }
    }
    #[test]
    fn packs_the_shader_layout_without_losing_tint() {
        let packed = pack_color_uniforms(&pass(), 320, 240).unwrap();
        assert_eq!(std::mem::size_of::<EffectUniformBuffer>(), 32);
        assert_eq!(packed.resolution, [320.0, 240.0]);
        assert_eq!(packed.direction, [-10.0, 0.0]);
        assert_eq!(packed.scalars, [1.0, 20.0, -50.0, 30.0]);
    }
    #[test]
    fn rejects_missing_unknown_and_vector_parameters() {
        let mut missing = pass();
        missing.uniforms.remove("tint");
        assert!(matches!(
            pack_color_uniforms(&missing, 1, 1),
            Err(EffectsError::MissingUniform { .. })
        ));
        let mut unknown = pass();
        unknown
            .uniforms
            .insert("typo".into(), UniformValue::Number(0.0));
        assert!(matches!(
            pack_color_uniforms(&unknown, 1, 1),
            Err(EffectsError::UnsupportedUniform { .. })
        ));
        let mut vector = pass();
        vector
            .uniforms
            .insert("tint".into(), UniformValue::Vector(vec![1.0, 2.0]));
        assert!(matches!(
            pack_color_uniforms(&vector, 1, 1),
            Err(EffectsError::InvalidNumberUniform { .. })
        ));
    }
}
