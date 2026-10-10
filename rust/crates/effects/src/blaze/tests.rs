use std::collections::BTreeMap;

use time::FrameRate;

use super::*;
use crate::{EffectPass, UniformValue};

pub(super) fn params(entries: &[(&str, f64)]) -> BTreeMap<String, f64> {
    entries
        .iter()
        .map(|(key, value)| ((*key).into(), *value))
        .collect()
}

pub(super) fn pass_at(entries: &[(&str, f64)], ticks: i64) -> EffectPass {
    let value = resolve(&params(entries), ticks, FrameRate::FPS_30).unwrap();
    EffectPass {
        shader: "blaze".into(),
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
fn blaze_catalog_has_ten_fields_and_seven_independent_animation_controls() {
    let catalog = definition();
    assert_eq!(catalog.id, "blaze");
    assert_eq!(catalog.version, 1);
    assert!(catalog.animated);
    assert_eq!(catalog.fields.len(), 10);
    assert_eq!(
        catalog
            .fields
            .iter()
            .map(|f| (f.key, f.min, f.max, f.step, f.default))
            .collect::<Vec<_>>(),
        vec![
            ("amount", 0.0, 1.0, 0.01, 1.0),
            ("flameOpacity", 0.0, 1.0, 0.01, 0.8),
            ("sparkOpacity", 0.0, 1.0, 0.01, 0.6),
            ("smokeOpacity", 0.0, 1.0, 0.01, 0.25),
            ("refraction", 0.0, 0.08, 0.001, 0.015),
            ("height", 0.1, 1.5, 0.001, 0.65),
            ("scale", 0.025, 0.5, 0.001, 0.15),
            ("speed", 0.0, 4.0, 0.01, 0.4),
            ("wind", -1.0, 1.0, 0.001, 0.0),
            ("seed", 0.0, 65535.0, 1.0, 1.0),
        ]
    );
    assert_eq!(
        catalog
            .fields
            .iter()
            .filter(|f| f.keyframable)
            .map(|f| f.key)
            .collect::<Vec<_>>(),
        [
            "amount",
            "flameOpacity",
            "sparkOpacity",
            "smokeOpacity",
            "refraction",
            "height",
            "wind"
        ]
    );
    let value = resolve(
        &params(&[("wind", -0.123456789), ("height", 0.123456789)]),
        0,
        FrameRate::FPS_30,
    )
    .unwrap();
    assert_eq!(value["passes"][0]["uniforms"]["wind"], -0.123456789);
    assert_eq!(value["passes"][0]["uniforms"]["height"], 0.123456789);
}

#[test]
fn blaze_strict_validation_precedes_any_neutral_elision() {
    for neutral in [
        vec![("amount", 0.0)],
        vec![
            ("flameOpacity", 0.0),
            ("sparkOpacity", 0.0),
            ("smokeOpacity", 0.0),
            ("refraction", 0.0),
        ],
    ] {
        assert_eq!(
            resolve(&params(&neutral), 0, FrameRate::FPS_30).unwrap()["passes"],
            json!([])
        );
        for field in definition().fields {
            for bad in [
                field.min - 1.0,
                field.max + 1.0,
                f64::NAN,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ] {
                let mut values = params(&neutral);
                values.insert(field.key.into(), bad);
                assert!(
                    resolve(&values, 0, FrameRate::FPS_30).is_err(),
                    "{}={bad}",
                    field.key
                );
            }
        }
        for (key, value) in [
            ("seed", 0.5),
            ("phase", 0.0),
            ("frame", 1.0),
            ("count", 24.0),
            ("enabled", 0.0),
            ("speed", -f64::MIN_POSITIVE),
        ] {
            let mut values = params(&neutral);
            values.insert(key.into(), value);
            assert!(resolve(&values, 0, FrameRate::FPS_30).is_err());
        }
    }
    for field in definition().fields {
        for value in [field.min, field.max] {
            assert!(resolve(&params(&[(field.key, value)]), 0, FrameRate::FPS_30).is_ok());
        }
    }
}

#[test]
fn blaze_four_contributions_can_each_resolve_with_the_other_three_off() {
    for selected in ["flameOpacity", "sparkOpacity", "smokeOpacity", "refraction"] {
        let mut values = params(&[
            ("flameOpacity", 0.0),
            ("sparkOpacity", 0.0),
            ("smokeOpacity", 0.0),
            ("refraction", 0.0),
        ]);
        values.insert(
            selected.into(),
            if selected == "refraction" { 0.04 } else { 1.0 },
        );
        let result = resolve(&values, 48000, FrameRate::FPS_30).unwrap();
        assert_eq!(result["passes"].as_array().unwrap().len(), 1, "{selected}");
        for key in ["flameOpacity", "sparkOpacity", "smokeOpacity", "refraction"] {
            assert_eq!(result["passes"][0]["uniforms"][key], values[key]);
        }
    }
}

#[test]
fn blaze_signed_local_frame_grid_is_bounded_and_random_access() {
    let rate = FrameRate::FPS_29_97;
    let first = resolve(&BTreeMap::new(), -1, rate).unwrap();
    assert_eq!(first["frameIndex"], -1);
    assert_eq!(first, resolve(&BTreeMap::new(), -4004, rate).unwrap());
    let later = resolve(&BTreeMap::new(), 8008, rate).unwrap();
    assert_eq!(later["frameIndex"], 2);
    assert_eq!(later, resolve(&BTreeMap::new(), 12011, rate).unwrap());
    assert_ne!(first["passes"], later["passes"]);
    assert_eq!(first, resolve(&BTreeMap::new(), -1, rate).unwrap());
    for ticks in [
        i64::MIN,
        i64::MAX,
        9_007_199_254_740_992,
        -9_007_199_254_740_992,
    ] {
        assert!(resolve(&params(&[("amount", 0.0)]), ticks, FrameRate::FPS_30).is_err());
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
fn blaze_phase_matches_independent_binary_rational_golden_vectors() {
    for (ticks, expected) in [
        (2_400_000, 4.440892098500626e-16),
        (9_007_199_254_740_000, 0.8000016808509827),
        (-9_007_199_254_744_000, 0.18666499853134155),
        (9_007_199_254_737_684, 0.7922816872596741),
        (-4004, 0.9866533279418945),
    ] {
        assert_eq!(clock::phase(ticks, 0.4), expected as f32);
    }
    for speed in [0.0, f64::from_bits(1), f64::MIN_POSITIVE] {
        for ticks in [0, 1, -1, 9_007_199_254_740_991, -9_007_199_254_740_991] {
            assert_eq!(clock::phase(ticks, speed), 0.0);
        }
    }
    assert_eq!(clock::phase(120000, 0.99999999), 0.0);
    assert_eq!(clock::phase(120000, 0.5), 0.5);
    assert_eq!(clock::phase(240000, 0.5), 0.0);
}

#[test]
fn blaze_seed_lattice_matches_independent_u32_bigint_golden_vectors() {
    for (seed, index, expected) in [
        (0, 0, 0.29059529304504395),
        (1, 0, 0.9285773634910583),
        (1, 63, 0.4071630835533142),
        (1, 64, 0.925229549407959),
        (1, 255, 0.7583556771278381),
        (31415, 17, 0.49599093198776245),
        (65535, 255, 0.2589930295944214),
    ] {
        let lattice = field::lattice(seed);
        assert_eq!(lattice[index / 4][index % 4], expected as f32);
        assert!(
            lattice
                .iter()
                .flatten()
                .all(|value| (0.0..1.0).contains(value))
        );
    }
    assert_ne!(field::lattice(0), field::lattice(65535));
}

#[test]
fn blaze_sparks_have_fixed_finite_budget_and_random_access() {
    assert_eq!(field::SPARKS, 24);
    for seed in [0, 1, 31415, 65535] {
        let zero = field::sparks(seed, 0.0);
        assert_eq!(zero, field::sparks(seed, 0.0));
        assert_ne!(zero, field::sparks(seed, 0.25));
        assert_eq!(zero, field::sparks(seed, 0.0));
        for phase in [0.0, 0.25, 0.5, f32::from_bits(1.0_f32.to_bits() - 1)] {
            for spark in field::sparks(seed, phase) {
                assert!((0.0..1.0).contains(&spark[0]));
                assert!((0.0..1.0).contains(&spark[1]));
                assert!((0.003..=0.007).contains(&spark[2]));
                assert!((-1.0..=1.0).contains(&spark[3]));
            }
        }
    }
}

#[test]
fn blaze_shader_passes_cpu_wgsl_validation() {
    let module = wgpu::naga::front::wgsl::parse_str(include_str!("../shaders/blaze.wgsl")).unwrap();
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
}
