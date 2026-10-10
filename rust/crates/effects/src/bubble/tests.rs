use super::*;
use crate::{EffectPass, UniformValue};

pub(super) fn params(entries: &[(&str, f64)]) -> BTreeMap<String, f64> {
    let mut values = BTreeMap::from([
        ("point0Time".into(), 0.0),
        ("point0X".into(), 0.5),
        ("point0Y".into(), 0.5),
    ]);
    values.extend(entries.iter().map(|(key, value)| ((*key).into(), *value)));
    values
}

pub(super) fn pass_at(entries: &[(&str, f64)], ticks: i64) -> EffectPass {
    let value = resolve(&params(entries), ticks, FrameRate::FPS_30).unwrap();
    EffectPass {
        shader: "bubble".into(),
        uniforms: value["passes"][0]["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    UniformValue::Number(value.as_f64().unwrap() as f32),
                )
            })
            .collect(),
    }
}

#[test]
fn bubble_catalog_materializes_only_required_point_zero_and_all_static_schedule_controls() {
    let definition = definition();
    assert_eq!(definition.id, "bubble");
    assert_eq!(definition.version, 1);
    assert!(definition.animated);
    assert_eq!(definition.fields.len(), 76);
    assert_eq!(
        definition
            .fields
            .iter()
            .filter(|field| field.keyframable)
            .count(),
        21
    );
    for (index, keys) in catalog::POINT_KEYS.iter().enumerate() {
        for (axis, key) in keys.iter().enumerate() {
            let field = definition
                .fields
                .iter()
                .find(|field| field.key == *key)
                .unwrap();
            assert_eq!(field.required, Some(index == 0));
            assert!(!field.keyframable);
            assert_eq!(field.default, if axis == 0 { 0.0 } else { 0.5 });
        }
    }
    let defaults = definition
        .fields
        .iter()
        .filter(|field| field.required != Some(false))
        .map(|field| (field.key.into(), field.default))
        .collect();
    assert!(resolve(&defaults, 0, FrameRate::FPS_30).is_ok());
    assert!(
        resolve(&BTreeMap::new(), 0, FrameRate::FPS_30)
            .unwrap_err()
            .contains("Missing active")
    );
}

#[test]
fn bubble_slots_are_complete_active_only_strict_and_never_silently_filled() {
    for key in catalog::POINT_KEYS[0] {
        let mut values = params(&[]);
        values.remove(key);
        assert!(
            resolve(&values, 0, FrameRate::FPS_30)
                .unwrap_err()
                .contains("Missing active")
        );
    }
    for key in catalog::POINT_KEYS[1] {
        let mut values = params(&[
            ("pointCount", 2.0),
            ("point1Time", 120000.0),
            ("point1X", 1.0),
            ("point1Y", 1.0),
        ]);
        values.remove(key);
        assert!(resolve(&values, 0, FrameRate::FPS_30).is_err());
        let values = params(&[(key, 0.0)]);
        assert!(
            resolve(&values, 0, FrameRate::FPS_30)
                .unwrap_err()
                .contains("Inactive")
        );
    }
    for entries in [
        vec![("point16X", 0.0)],
        vec![
            ("pointCount", 2.0),
            ("point1Time", 0.0),
            ("point1X", 0.0),
            ("point1Y", 0.0),
        ],
        vec![
            ("pointCount", 2.0),
            ("point1Time", 240001.0),
            ("point1X", 0.0),
            ("point1Y", 0.0),
        ],
    ] {
        assert!(resolve(&params(&entries), 0, FrameRate::FPS_30).is_err());
    }
    let mut values = params(&[("pointCount", 3.0)]);
    for (index, ticks) in [(1, 80000.0), (2, 40000.0)] {
        for (axis, key) in catalog::POINT_KEYS[index].iter().enumerate() {
            values.insert((*key).into(), if axis == 0 { ticks } else { 0.5 });
        }
    }
    assert!(resolve(&values, 0, FrameRate::FPS_30).is_err());
}

#[test]
fn bubble_validation_precedes_inactive_amount_zero_and_neutral_elision() {
    for (neutral, time) in [
        (vec![("amount", 0.0)], 0),
        (vec![], -1),
        (
            vec![
                ("refraction", 0.0),
                ("frost", 0.0),
                ("shine", 0.0),
                ("rim", 0.0),
                ("iridescence", 0.0),
                ("tintStrength", 0.0),
            ],
            0,
        ),
    ] {
        assert_eq!(
            resolve(&params(&neutral), time, FrameRate::FPS_30).unwrap()["passes"],
            json!([])
        );
        for field in definition().fields.iter().filter(|field| {
            !field.key.starts_with("point")
                || field.key == "pointCount"
                || field.key.starts_with("point0")
        }) {
            for value in [
                field.min - 1.0,
                field.max + 1.0,
                f64::NAN,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ] {
                let mut values = params(&neutral);
                values.insert(field.key.into(), value);
                assert!(
                    resolve(&values, time, FrameRate::FPS_30).is_err(),
                    "{}={value}",
                    field.key
                );
            }
        }
        for key in ["phase", "ballCount", "center0X", "width", "history", "seed"] {
            let mut values = params(&neutral);
            values.insert(key.into(), 0.0);
            assert!(resolve(&values, time, FrameRate::FPS_30).is_err());
        }
    }
    for key in [
        "pointCount",
        "trail",
        "trailDurationTicks",
        "startTicks",
        "durationTicks",
        "point0Time",
    ] {
        let mut values = params(&[]);
        let default = definition()
            .fields
            .iter()
            .find(|field| field.key == key)
            .unwrap()
            .default;
        values.insert(key.into(), default + 0.5);
        assert!(resolve(&values, 0, FrameRate::FPS_30).is_err(), "{key}");
    }
}

#[test]
fn bubble_safe_time_ranges_and_half_open_activity_are_explicit() {
    let values = params(&[("startTicks", 4000.0), ("durationTicks", 8000.0)]);
    for time in [
        -1,
        0,
        3999,
        12000,
        16000,
        -(trajectory::MAX_SAFE_TICKS as i64),
    ] {
        assert_eq!(
            resolve(&values, time, FrameRate::FPS_30).unwrap()["passes"],
            json!([])
        );
    }
    for time in [4000, 7999, 8000, 11999] {
        assert_eq!(
            resolve(&values, time, FrameRate::FPS_30).unwrap()["passes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    assert!(
        resolve(
            &params(&[("startTicks", trajectory::MAX_SAFE_TICKS as f64)]),
            0,
            FrameRate::FPS_30
        )
        .is_err()
    );
    for time in [i64::MIN, i64::MAX, trajectory::MAX_SAFE_TICKS as i64 + 1] {
        assert!(resolve(&params(&[]), time, FrameRate::FPS_30).is_err());
    }
    for rate in [
        FrameRate::new(0, 1),
        FrameRate::new(30, 0),
        FrameRate::new(7, 3),
        FrameRate::new(240000, 2),
        FrameRate::new(120000, 1002),
    ] {
        assert!(resolve(&params(&[("amount", 0.0)]), 0, rate).is_err());
    }
}

#[test]
fn bubble_frame_floor_matches_wide_integer_clock_and_equivalent_rational_rates() {
    let values = params(&[
        ("follow", 1.0),
        ("trail", 1.0),
        ("pointCount", 2.0),
        ("point1Time", 120000.0),
        ("point1X", 1.0),
        ("point1Y", 1.0),
    ]);
    for rate in [
        FrameRate::FPS_24,
        FrameRate::FPS_25,
        FrameRate::FPS_30,
        FrameRate::FPS_60,
        FrameRate::FPS_120,
        FrameRate::FPS_23_976,
        FrameRate::FPS_29_97,
        FrameRate::FPS_59_94,
    ] {
        for time in [-1, 0, 4999, 60061, 239999] {
            let period = 120000_i128 * i128::from(rate.denominator) / i128::from(rate.numerator);
            let frame = i128::from(time).div_euclid(period);
            let output = resolve(&values, time, rate).unwrap();
            assert_eq!(output["frameIndex"], frame as i64);
            assert_eq!(
                output,
                resolve(&values, (frame * period) as i64, rate).unwrap()
            );
        }
    }
    for (time, rates) in [
        (
            20000,
            [FrameRate::FPS_24, FrameRate::FPS_30, FrameRate::FPS_60],
        ),
        (
            20020,
            [
                FrameRate::FPS_23_976,
                FrameRate::FPS_29_97,
                FrameRate::FPS_59_94,
            ],
        ),
    ] {
        let expected = resolve(&values, time, rates[0]).unwrap()["passes"].clone();
        for rate in rates {
            assert_eq!(resolve(&values, time, rate).unwrap()["passes"], expected);
        }
    }
}

#[test]
fn bubble_prepared_pass_preserves_fractional_lags_and_has_no_schedule_or_frame_history() {
    let values = params(&[
        ("follow", 1.0),
        ("trail", 4.0),
        ("trailDurationTicks", 10.0),
        ("pointCount", 2.0),
        ("point1Time", 120000.0),
        ("point1X", 1.0),
        ("point1Y", 0.5),
    ]);
    let output = resolve(&values, 6000, FrameRate::FPS_120).unwrap();
    let uniforms = &output["passes"][0]["uniforms"];
    assert_eq!(uniforms["ballCount"], 4.0);
    assert_eq!(uniforms.as_object().unwrap().len(), 21 + 2 + 8);
    for index in 0..4 {
        let expected = 0.5 + 0.5 * (18000.0 - index as f64 * 10.0) / 360000.0;
        assert!(
            (uniforms[uniforms::CENTER_KEYS[index][0]].as_f64().unwrap() - expected).abs() < 1e-15
        );
    }
    for key in [
        "startTicks",
        "durationTicks",
        "speed",
        "follow",
        "pointCount",
        "point0Time",
        "frame",
        "center4X",
    ] {
        assert!(uniforms.get(key).is_none());
    }
    for time in [6000, 120000, 0, 6000, 240000, 6000] {
        let result = resolve(&values, time, FrameRate::FPS_120).unwrap();
        if time == 6000 {
            assert_eq!(output, result);
        }
    }
}

#[test]
fn bubble_follow_endpoints_pool_correctly_and_size_edits_do_not_rewrite_centers() {
    let entries = [
        ("follow", 1.0),
        ("pointCount", 2.0),
        ("point1Time", 12000.0),
        ("point1X", 0.9),
        ("point1Y", 0.1),
    ];
    let output = resolve(&params(&entries), 60000, FrameRate::FPS_30).unwrap();
    for keys in uniforms::CENTER_KEYS {
        assert_eq!(output["passes"][0]["uniforms"][keys[0]], 0.9);
        assert_eq!(output["passes"][0]["uniforms"][keys[1]], 0.1);
    }
    let mut values = params(&entries);
    values.insert("follow".into(), 0.0);
    let fixed = resolve(&values, 60000, FrameRate::FPS_30).unwrap();
    for keys in uniforms::CENTER_KEYS {
        assert_eq!(fixed["passes"][0]["uniforms"][keys[0]], 0.5);
    }
    let mut values = params(&entries);
    values.insert("radius".into(), 0.1);
    values.insert("blend".into(), 24.0);
    let resized = resolve(&values, 60000, FrameRate::FPS_30).unwrap();
    for keys in uniforms::CENTER_KEYS {
        for key in keys {
            assert_eq!(
                resized["passes"][0]["uniforms"][key],
                output["passes"][0]["uniforms"][key]
            );
        }
    }
}

#[test]
fn bubble_phase_is_elapsed_local_time_and_speed_zero_does_not_stop_trajectory() {
    let base = params(&[
        ("follow", 1.0),
        ("speed", 0.0),
        ("pointCount", 2.0),
        ("point1Time", 120000.0),
        ("point1X", 0.9),
        ("point1Y", 0.1),
    ]);
    let epoch = 8_000_000_000_000_000_u64;
    let mut shifted = base.clone();
    shifted.insert("startTicks".into(), epoch as f64);
    for time in [0, 4000, 24000, 120000] {
        let original = resolve(&base, time, FrameRate::FPS_30).unwrap();
        assert_eq!(
            original["passes"],
            resolve(&shifted, epoch as i64 + time, FrameRate::FPS_30).unwrap()["passes"]
        );
        assert_eq!(original["passes"][0]["uniforms"]["phase"], 0.0);
    }
    assert_ne!(
        resolve(&base, 0, FrameRate::FPS_30).unwrap()["passes"],
        resolve(&base, 24000, FrameRate::FPS_30).unwrap()["passes"]
    );
}

#[test]
fn bubble_shader_validates_on_cpu_and_uniform_struct_matches_rust_layout() {
    let source = include_str!("../shaders/bubble.wgsl");
    let module = wgpu::naga::front::wgsl::parse_str(source).unwrap();
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
    let layout = module
        .types
        .iter()
        .find_map(|(_, item)| {
            if item.name.as_deref() != Some("BubbleUniforms") {
                return None;
            }
            match &item.inner {
                wgpu::naga::TypeInner::Struct { members, span } => Some((members, *span)),
                _ => None,
            }
        })
        .unwrap();
    assert_eq!(
        layout.1,
        std::mem::size_of::<uniforms::BubbleUniformBuffer>() as u32
    );
    assert_eq!(
        layout
            .0
            .iter()
            .map(|member| member.offset)
            .collect::<Vec<_>>(),
        [0, 16, 32, 48, 64, 80, 96, 112, 128]
    );
    let centers = &module.types[layout.0[8].ty];
    match centers.inner {
        wgpu::naga::TypeInner::Array {
            size: wgpu::naga::ArraySize::Constant(size),
            stride,
            ..
        } => {
            assert_eq!(size.get(), 24);
            assert_eq!(stride, 16);
        }
        _ => panic!("Expected 24 packed vec4 centers"),
    }
    assert!(!source.contains("textureSample("));
    assert!(source.contains("textureLoad(source, pixel, 0)"));
}
