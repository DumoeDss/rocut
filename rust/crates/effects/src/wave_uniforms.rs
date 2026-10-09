use crate::pipeline::read_number_uniform;
use crate::wave_catalog::{MAX_WAVE_EVENTS, global_fields};
use crate::{EffectPass, EffectsError, UniformValue};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct WaveUniformBuffer {
    resolution_count: [f32; 4],
    controls: [f32; 4],
    timing: [f32; 4],
    color_glow: [f32; 4],
    events: [[f32; 4]; MAX_WAVE_EVENTS],
}

pub(crate) fn pack_wave_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<WaveUniformBuffer, EffectsError> {
    if !matches!(pass.shader.as_str(), "ripple" | "force-field") {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let invalid = |key: &str| EffectsError::InvalidNumberUniform {
        shader: pass.shader.clone(),
        uniform: key.into(),
    };
    let fields = global_fields(pass.shader == "force-field");
    let mut values = std::collections::BTreeMap::new();
    for field in &fields {
        let value = read_number_uniform(pass, field.key)?;
        if !value.is_finite() || value < field.min as f32 || value > field.max as f32 {
            return Err(invalid(field.key));
        }
        values.insert(field.key, value);
    }
    let count = read_number_uniform(pass, "eventCount")?;
    if !count.is_finite()
        || !(0.0..=MAX_WAVE_EVENTS as f32).contains(&count)
        || count.fract() != 0.0
    {
        return Err(invalid("eventCount"));
    }
    let vector_error = || EffectsError::InvalidVectorUniform {
        shader: pass.shader.clone(),
        uniform: "events".into(),
        expected_length: count as usize * 4,
    };
    let Some(UniformValue::Vector(events)) = pass.uniforms.get("events") else {
        return Err(vector_error());
    };
    if events.len() != count as usize * 4 {
        return Err(vector_error());
    }
    let mut packed_events = [[0.0; 4]; MAX_WAVE_EVENTS];
    for (packed, event) in packed_events.iter_mut().zip(events.chunks_exact(4)) {
        if !event.iter().all(|v| v.is_finite())
            || !(-1.0..=2.0).contains(&event[0])
            || !(-1.0..=2.0).contains(&event[1])
            || !(-1.0..=values["lifetime"]).contains(&event[2])
            || !(-1.0..=1.0).contains(&event[3])
        {
            return Err(vector_error());
        }
        packed.copy_from_slice(event);
    }
    for key in pass.uniforms.keys() {
        if key != "eventCount" && key != "events" && !fields.iter().any(|f| f.key == key) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: key.clone(),
            });
        }
    }
    Ok(WaveUniformBuffer {
        resolution_count: [width as f32, height as f32, count, 0.0],
        controls: ["amount", "speed", "wavelength", "width"].map(|key| values[key]),
        timing: [
            values["refraction"],
            values["decay"],
            values["lifetime"],
            values.get("ringOpacity").copied().unwrap_or(0.0),
        ],
        color_glow: ["colorR", "colorG", "colorB", "glow"]
            .map(|key| values.get(key).copied().unwrap_or(0.0)),
        events: packed_events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass() -> EffectPass {
        let mut uniforms = global_fields(false)
            .into_iter()
            .map(|field| (field.key.into(), UniformValue::Number(field.default as f32)))
            .collect::<std::collections::HashMap<_, _>>();
        uniforms.insert("eventCount".into(), UniformValue::Number(1.0));
        uniforms.insert(
            "events".into(),
            UniformValue::Vector(vec![0.5, 0.4, 0.5, -0.8]),
        );
        EffectPass {
            shader: "ripple".into(),
            uniforms,
        }
    }

    #[test]
    fn wave_buffer_layout_and_event_budget_match_shader() {
        let buffer = pack_wave_uniforms(&pass(), 64, 32).unwrap();
        assert_eq!(
            std::mem::size_of::<WaveUniformBuffer>(),
            64 + MAX_WAVE_EVENTS * 16
        );
        assert_eq!(buffer.resolution_count, [64.0, 32.0, 1.0, 0.0]);
        assert_eq!(buffer.events[0], [0.5, 0.4, 0.5, -0.8]);
        assert!(buffer.events[1..].iter().all(|event| *event == [0.0; 4]));
        assert!(
            include_str!("shaders/wave_common.wgsl")
                .contains(&format!("events: array<vec4f, {MAX_WAVE_EVENTS}>"))
        );
    }

    #[test]
    fn wave_raw_compositor_rejects_wrong_types_lengths_and_nonfinite_values() {
        for (key, value) in [
            ("eventCount", UniformValue::Number(17.0)),
            ("eventCount", UniformValue::Number(0.5)),
            ("eventCount", UniformValue::Number(f32::NAN)),
            ("events", UniformValue::Number(1.0)),
            ("events", UniformValue::Vector(vec![0.5, 0.5, 0.5])),
            (
                "events",
                UniformValue::Vector(vec![0.5, 0.5, f32::INFINITY, 1.0]),
            ),
            ("events", UniformValue::Vector(vec![0.5, 0.5, 61.0, 1.0])),
            ("events", UniformValue::Vector(vec![0.5, 0.5, -1.1, 1.0])),
            ("events", UniformValue::Vector(vec![2.1, 0.5, 0.5, 1.0])),
            ("events", UniformValue::Vector(vec![0.5, 0.5, 0.5, 1.1])),
            ("speed", UniformValue::Number(f32::NAN)),
            ("lifetime", UniformValue::Number(0.0)),
            ("typo", UniformValue::Number(0.0)),
        ] {
            let mut invalid = pass();
            invalid.uniforms.insert(key.into(), value);
            assert!(
                pack_wave_uniforms(&invalid, 64, 32).is_err(),
                "accepted {key}"
            );
        }
        let mut missing = pass();
        missing.uniforms.remove("events");
        assert!(pack_wave_uniforms(&missing, 64, 32).is_err());
    }
}
