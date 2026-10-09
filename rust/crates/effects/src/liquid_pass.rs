use std::collections::BTreeMap;

use crate::liquid_catalog::{EVENT_KEYS, MAX_EVENTS, fields};
use crate::liquid_params::Parameters;
use crate::pipeline::read_number_uniform;
use crate::{EffectPass, EffectsError, UniformValue};

pub(crate) struct LiquidPass {
    pub parameters: Parameters,
    pub elapsed: u64,
}

pub(crate) fn parse(pass: &EffectPass) -> Result<LiquidPass, EffectsError> {
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    if pass.shader != "liquid" {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let fields = fields();
    for key in pass.uniforms.keys() {
        if key != "events"
            && key != "elapsedTicks"
            && !fields.iter().any(|f| f.key == key && key != "startTicks")
        {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    let mut values = BTreeMap::new();
    for field in fields.iter().filter(|f| f.key != "startTicks") {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite()
            || value < field.min as f32
            || value > field.max as f32
            || (field.step == 1.0 && value.fract() != 0.0)
        {
            return Err(invalid(field.key));
        }
        // Authoring validation precedes the float32 rendering transport. Recover
        // a metadata endpoint rounded outward by that transport, not bad authorship.
        values.insert(
            field.key.into(),
            f64::from(value).clamp(field.min, field.max),
        );
    }
    let elapsed = read_number_uniform(pass, "elapsedTicks")?;
    if !elapsed.is_finite()
        || elapsed < 0.0
        || elapsed > values["durationTicks"] as f32
        || elapsed.fract() != 0.0
    {
        return Err(invalid("elapsedTicks"));
    }
    let count = values["eventCount"] as usize;
    let vector_error = || EffectsError::InvalidVectorUniform {
        shader: pass.shader.clone(),
        uniform: "events".into(),
        expected_length: count * 7,
    };
    let Some(UniformValue::Vector(events)) = pass.uniforms.get("events") else {
        return Err(vector_error());
    };
    if count > MAX_EVENTS || events.len() != count * 7 {
        return Err(vector_error());
    }
    let definition = crate::liquid_catalog::definition();
    for (keys, event) in EVENT_KEYS.iter().zip(events.chunks_exact(7)) {
        for (key, value) in keys.iter().zip(event) {
            let field = definition
                .fields
                .iter()
                .find(|field| field.key == *key)
                .expect("declared event slot");
            if !value.is_finite()
                || *value < field.min as f32
                || *value > field.max as f32
                || (field.step == 1.0 && value.fract() != 0.0)
            {
                return Err(vector_error());
            }
            values.insert((*key).into(), f64::from(*value).clamp(field.min, field.max));
        }
    }
    let parameters = crate::liquid_params::parse(&values)
        .map_err(|message| EffectsError::LiquidSimulation { message })?;
    crate::liquid_replay::validate_budget(&parameters.config, count, parameters.duration_ticks)
        .map_err(|message| EffectsError::LiquidSimulation { message })?;
    Ok(LiquidPass {
        parameters,
        elapsed: elapsed as u64,
    })
}
