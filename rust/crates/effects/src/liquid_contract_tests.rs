use std::collections::BTreeMap;

use time::FrameRate;

use crate::liquid_catalog::{self, EVENT_KEYS, MAX_SAFE_TICKS, MAX_TICKS};
use crate::{EffectPass, EffectsError, UniformValue, liquid_params, liquid_pass};

fn params(entries: &[(&str, f64)]) -> BTreeMap<String, f64> {
    entries
        .iter()
        .map(|(key, value)| ((*key).into(), *value))
        .collect()
}

fn event(values: &mut BTreeMap<String, f64>, slot: usize, at: f64) {
    for (key, value) in EVENT_KEYS[slot]
        .iter()
        .zip([at, 0.4, 0.6, 0.2, 0.8, -0.3, 0.7])
    {
        values.insert((*key).into(), value);
    }
}

fn raw_pass() -> EffectPass {
    let mut uniforms = liquid_catalog::fields()
        .into_iter()
        .filter(|field| field.key != "startTicks")
        .map(|field| (field.key.into(), UniformValue::Number(field.default as f32)))
        .collect::<std::collections::HashMap<_, _>>();
    uniforms.insert("elapsedTicks".into(), UniformValue::Number(0.0));
    uniforms.insert("events".into(), UniformValue::Vector(Vec::new()));
    EffectPass {
        shader: "liquid".into(),
        uniforms,
    }
}

fn raw_event(pass: &mut EffectPass, values: Vec<f32>) {
    pass.uniforms
        .insert("eventCount".into(), UniformValue::Number(1.0));
    pass.uniforms
        .insert("events".into(), UniformValue::Vector(values));
}

#[test]
fn authoring_defaults_are_complete_and_unknown_names_are_rejected() {
    let parsed = liquid_params::parse(&BTreeMap::new()).unwrap();
    assert_eq!((parsed.config.columns, parsed.config.rows), (16, 12));
    assert_eq!(parsed.duration_ticks, 240_000);
    assert_eq!(parsed.start_ticks, 0);
    assert!(parsed.events.is_empty());
    for key in ["seed", "event16X", "elapsedTicks", "Columns", "duration"] {
        let error = liquid_params::parse(&params(&[(key, 1.0)])).err().unwrap();
        assert!(error.contains("Unknown Liquid parameter") && error.contains(key));
    }
}

#[test]
fn every_supplied_authoring_field_rejects_nonfinite_and_out_of_range_values() {
    for field in liquid_catalog::definition().fields {
        for invalid in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            field.min - 1.0,
            field.max + 1.0,
        ] {
            assert!(
                liquid_params::parse(&params(&[(field.key, invalid)])).is_err(),
                "{} accepted {invalid}",
                field.key
            );
        }
        if field.step == 1.0 {
            assert!(
                liquid_params::parse(&params(&[(field.key, field.min + 0.5)])).is_err(),
                "{} accepted a fractional integer",
                field.key
            );
        }
    }
    assert!(liquid_params::parse(&params(&[("viscosity", 0.001337)])).is_ok());
}

#[test]
fn every_active_event_component_is_required_and_inactive_events_do_not_fire() {
    let mut values = params(&[("eventCount", 1.0)]);
    event(&mut values, 0, 0.0);
    for key in EVENT_KEYS[0] {
        let mut missing = values.clone();
        missing.remove(key);
        let error = liquid_params::parse(&missing).err().unwrap();
        assert!(error.contains(key), "missing {key}: {error}");
    }
    values.insert("eventCount".into(), 0.0);
    assert!(liquid_params::parse(&values).unwrap().events.is_empty());
    values.insert("event0Radius".into(), 0.0);
    assert!(liquid_params::parse(&values).is_err());
}

#[test]
fn authoring_events_keep_same_tick_order_and_enforce_strict_duration_boundary() {
    let mut values = params(&[("eventCount", 2.0), ("durationTicks", 2_000.0)]);
    event(&mut values, 0, 1_999.0);
    event(&mut values, 1, 1_999.0);
    values.insert("event1VelocityX".into(), -1.0);
    let parsed = liquid_params::parse(&values).unwrap();
    assert_eq!(parsed.events[0].velocity[0], 0.8);
    assert_eq!(parsed.events[1].velocity[0], -1.0);
    values.insert("event1Time".into(), 2_000.0);
    assert!(liquid_params::parse(&values).is_err());
    values.insert("event1Time".into(), 0.0);
    assert!(liquid_params::parse(&values).is_err());
    values.insert("event1Time".into(), 1_999.5);
    assert!(liquid_params::parse(&values).is_err());
}

#[test]
fn resolver_floors_clip_local_frame_before_start_offset_and_freezes_at_duration() {
    let values = params(&[("startTicks", 1_500.0), ("durationTicks", 9_000.0)]);
    for (local, frame, elapsed) in [
        (-1, -1, 0),
        (3_999, 0, 0),
        (4_000, 1, 2_500),
        (7_999, 1, 2_500),
        (8_000, 2, 6_500),
        (12_000, 3, 9_000),
        (200_000, 50, 9_000),
    ] {
        let resolved = liquid_params::resolve(&values, local, FrameRate::FPS_30).unwrap();
        assert_eq!(resolved["frameIndex"].as_i64(), Some(frame));
        assert_eq!(
            resolved["passes"][0]["uniforms"]["elapsedTicks"].as_u64(),
            Some(elapsed)
        );
        assert!(
            resolved["passes"][0]["uniforms"]
                .get("startTicks")
                .is_none()
        );
    }
    let values = params(&[("durationTicks", 10_000.0)]);
    for (local, frame, elapsed) in [(4_003, 0, 0), (4_004, 1, 4_004)] {
        let resolved = liquid_params::resolve(&values, local, FrameRate::FPS_29_97).unwrap();
        assert_eq!(resolved["frameIndex"].as_i64(), Some(frame));
        assert_eq!(
            resolved["passes"][0]["uniforms"]["elapsedTicks"].as_u64(),
            Some(elapsed)
        );
    }
}

#[test]
fn resolver_rejects_unsafe_ticks_and_invalid_or_unbounded_frame_rates() {
    let values = BTreeMap::new();
    for time in [
        i64::MIN,
        i64::MAX,
        MAX_SAFE_TICKS as i64 + 1,
        -(MAX_SAFE_TICKS as i64) - 1,
    ] {
        assert!(liquid_params::resolve(&values, time, FrameRate::FPS_30).is_err());
    }
    for rate in [
        FrameRate::new(0, 1),
        FrameRate::new(1, 0),
        FrameRate::new(7, 3),
        FrameRate::new(120_001, 1),
        FrameRate::new(1, 1_002),
    ] {
        assert!(liquid_params::resolve(&values, 0, rate).is_err());
    }
}

#[test]
fn zero_amount_still_validates_entire_schedule_and_full_duration_budget() {
    let mut values = params(&[("amount", 0.0)]);
    let resolved = liquid_params::resolve(&values, 0, FrameRate::FPS_30).unwrap();
    assert!(resolved["passes"].as_array().unwrap().is_empty());
    values.insert("eventCount".into(), 1.0);
    assert!(liquid_params::resolve(&values, 0, FrameRate::FPS_30).is_err());
    event(&mut values, 0, 0.0);
    for (key, value) in [
        ("columns", 64.0),
        ("rows", 64.0),
        ("pressureIterations", 80.0),
        ("diffusionIterations", 24.0),
        ("viscosity", 0.02),
        ("vorticity", 4.0),
        ("durationTicks", MAX_TICKS as f64),
    ] {
        values.insert(key.into(), value);
    }
    assert!(liquid_params::parse(&values).is_ok());
    assert!(
        liquid_params::validate_liquid_schedule(&values)
            .unwrap_err()
            .contains("work budget")
    );
    assert!(
        liquid_params::resolve(&values, -1, FrameRate::FPS_30)
            .unwrap_err()
            .contains("work budget")
    );
}

#[test]
fn raw_pass_requires_every_scalar_and_rejects_unknown_names_and_types() {
    let valid = raw_pass();
    assert!(liquid_pass::parse(&valid).is_ok());
    for key in valid.uniforms.keys().filter(|key| *key != "events") {
        let mut pass = valid.clone();
        pass.uniforms.remove(key);
        assert!(
            matches!(liquid_pass::parse(&pass), Err(EffectsError::MissingUniform { uniform, .. }) if uniform == *key)
        );
        pass.uniforms
            .insert(key.clone(), UniformValue::Vector(vec![0.0]));
        assert!(
            matches!(liquid_pass::parse(&pass), Err(EffectsError::InvalidNumberUniform { uniform, .. }) if uniform == *key)
        );
    }
    for key in ["startTicks", "seed", "event0X", "unknown"] {
        let mut pass = valid.clone();
        pass.uniforms.insert(key.into(), UniformValue::Number(0.0));
        assert!(
            matches!(liquid_pass::parse(&pass), Err(EffectsError::UnsupportedUniform { uniform, .. }) if uniform == key)
        );
    }
    let mut pass = valid;
    pass.shader = "liquid-ish".into();
    assert!(matches!(
        liquid_pass::parse(&pass),
        Err(EffectsError::UnknownEffectShader { .. })
    ));
}

#[test]
fn raw_pass_rejects_nonfinite_scalars_and_fractional_integer_fields() {
    for field in liquid_catalog::fields()
        .into_iter()
        .filter(|field| field.key != "startTicks")
    {
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut pass = raw_pass();
            pass.uniforms
                .insert(field.key.into(), UniformValue::Number(value));
            assert!(
                liquid_pass::parse(&pass).is_err(),
                "{} accepted {value}",
                field.key
            );
        }
        if field.step == 1.0 {
            let mut pass = raw_pass();
            pass.uniforms.insert(
                field.key.into(),
                UniformValue::Number(field.min as f32 + 0.5),
            );
            assert!(liquid_pass::parse(&pass).is_err());
        }
    }
    for elapsed in [-1.0, 0.5, 240_001.0, f32::NAN, f32::INFINITY] {
        let mut pass = raw_pass();
        pass.uniforms
            .insert("elapsedTicks".into(), UniformValue::Number(elapsed));
        assert!(liquid_pass::parse(&pass).is_err());
    }
}

#[test]
fn raw_event_vectors_require_exact_type_count_length_and_finite_components() {
    let mut pass = raw_pass();
    pass.uniforms.remove("events");
    assert!(matches!(
        liquid_pass::parse(&pass),
        Err(EffectsError::InvalidVectorUniform {
            expected_length: 0,
            ..
        })
    ));
    pass.uniforms
        .insert("events".into(), UniformValue::Number(0.0));
    assert!(liquid_pass::parse(&pass).is_err());
    for values in [vec![], vec![0.0; 6], vec![0.0; 8], vec![0.0; 112]] {
        raw_event(&mut pass, values);
        assert!(matches!(
            liquid_pass::parse(&pass),
            Err(EffectsError::InvalidVectorUniform {
                expected_length: 7,
                ..
            })
        ));
    }
    let valid = [0.0, 0.4, 0.6, 0.2, 0.8, -0.3, 0.7];
    for index in 0..7 {
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut values = valid.to_vec();
            values[index] = value;
            raw_event(&mut pass, values);
            assert!(liquid_pass::parse(&pass).is_err());
        }
    }
    raw_event(&mut pass, valid.to_vec());
    assert!(liquid_pass::parse(&pass).is_ok());
    pass.uniforms
        .insert("eventCount".into(), UniformValue::Number(0.0));
    assert!(liquid_pass::parse(&pass).is_err());
}

#[test]
fn float32_transport_endpoints_are_recovered_but_neighboring_invalid_values_are_rejected() {
    let mut pass = raw_pass();
    raw_event(&mut pass, vec![0.0, 0.0, 1.0, 0.01_f32, -3.0, 3.0, 1.0]);
    pass.uniforms
        .insert("viscosity".into(), UniformValue::Number(0.02_f32));
    let parsed = liquid_pass::parse(&pass).unwrap();
    assert_eq!(parsed.parameters.events[0].radius, 0.01);
    assert!(parsed.parameters.config.viscosity <= 0.02);
    raw_event(
        &mut pass,
        vec![
            0.0,
            0.0,
            1.0,
            f32::from_bits(0.01_f32.to_bits() - 1),
            -3.0,
            3.0,
            1.0,
        ],
    );
    assert!(liquid_pass::parse(&pass).is_err());
    raw_event(&mut pass, vec![0.0, 0.0, 1.0, 2.0, -3.0, 3.0, 1.0]);
    pass.uniforms.insert(
        "viscosity".into(),
        UniformValue::Number(f32::from_bits(0.02_f32.to_bits() + 1)),
    );
    assert!(liquid_pass::parse(&pass).is_err());
    let mut authored = params(&[("eventCount", 1.0)]);
    event(&mut authored, 0, 0.0);
    authored.insert("event0Radius".into(), f64::from(0.01_f32));
    assert!(liquid_params::parse(&authored).is_err());
}

#[test]
fn raw_pass_enforces_event_order_duration_and_full_budget_before_replay() {
    let mut pass = raw_pass();
    raw_event(&mut pass, vec![240_000.0, 0.5, 0.5, 0.2, 0.0, 0.0, 1.0]);
    assert!(liquid_pass::parse(&pass).is_err());
    raw_event(&mut pass, vec![0.5, 0.5, 0.5, 0.2, 0.0, 0.0, 1.0]);
    assert!(liquid_pass::parse(&pass).is_err());
    pass.uniforms
        .insert("eventCount".into(), UniformValue::Number(2.0));
    pass.uniforms.insert(
        "events".into(),
        UniformValue::Vector(vec![
            1.0, 0.5, 0.5, 0.2, 0.0, 0.0, 1.0, 0.0, 0.5, 0.5, 0.2, 0.0, 0.0, 1.0,
        ]),
    );
    assert!(liquid_pass::parse(&pass).is_err());
    pass = raw_pass();
    for (key, value) in [
        ("amount", 0.0),
        ("columns", 64.0),
        ("rows", 64.0),
        ("pressureIterations", 80.0),
        ("durationTicks", MAX_TICKS as f32),
    ] {
        pass.uniforms
            .insert(key.into(), UniformValue::Number(value));
    }
    assert!(
        matches!(liquid_pass::parse(&pass), Err(EffectsError::LiquidSimulation { message }) if message.contains("work budget"))
    );
}
