use std::collections::BTreeMap;

use time::FrameRate;

use super::uniforms::DropletsUniformBuffer;
use super::*;
use crate::{EffectPass, EffectsError, UniformValue};

fn params(entries: &[(&str, f64)]) -> BTreeMap<String, f64> {
    entries.iter().map(|(k, v)| ((*k).into(), *v)).collect()
}

fn pass_at(entries: &[(&str, f64)], ticks: i64) -> EffectPass {
    let value = resolve(&params(entries), ticks, FrameRate::FPS_30).unwrap();
    EffectPass {
        shader: "droplets".into(),
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

fn phase_at(ticks: i64, speed: f64, rate: FrameRate) -> f64 {
    resolve(&params(&[("speed", speed)]), ticks, rate).unwrap()["passes"][0]["uniforms"]["phase"]
        .as_f64()
        .unwrap()
}

#[test]
fn droplets_catalog_keeps_geometry_static_and_only_optics_keyframable() {
    let catalog = definition();
    assert_eq!(catalog.id, "droplets");
    assert!(catalog.animated);
    assert_eq!(catalog.fields.len(), 8);
    assert_eq!(
        catalog
            .fields
            .iter()
            .filter(|f| f.keyframable)
            .map(|f| f.key)
            .collect::<Vec<_>>(),
        ["amount", "refraction", "highlight"]
    );
}

#[test]
fn droplets_resolver_rejects_invalid_fields_before_noop_elision() {
    for field in definition().fields {
        for bad in [field.min - 1.0, field.max + 1.0, f64::NAN, f64::INFINITY] {
            for disabled in ["amount", "count"] {
                let mut values = params(&[(disabled, 0.0)]);
                values.insert(field.key.into(), bad);
                assert!(
                    resolve(&values, 0, FrameRate::FPS_30).is_err(),
                    "{}={bad}",
                    field.key
                );
            }
        }
    }
    for entries in [
        vec![("count", 0.5)],
        vec![("seed", 1.5)],
        vec![("phase", 0.0)],
        vec![("typo", 1.0), ("amount", 0.0)],
        vec![("speed", -f64::MIN_POSITIVE)],
    ] {
        assert!(resolve(&params(&entries), 0, FrameRate::FPS_30).is_err());
    }
    for disabled in ["amount", "count"] {
        let result = resolve(&params(&[(disabled, 0.0)]), 0, FrameRate::FPS_30).unwrap();
        assert!(result["passes"].as_array().unwrap().is_empty());
    }
}

#[test]
fn droplets_signed_rational_frame_floor_and_random_access_are_stable() {
    let rate = FrameRate::FPS_29_97;
    let a = resolve(&BTreeMap::new(), -1, rate).unwrap();
    assert_eq!(a["frameIndex"], -1);
    assert_eq!(a, resolve(&BTreeMap::new(), -4004, rate).unwrap());
    let b = resolve(&BTreeMap::new(), 8008, rate).unwrap();
    assert_eq!(b["frameIndex"], 2);
    assert_eq!(b, resolve(&BTreeMap::new(), 12011, rate).unwrap());
    assert_ne!(a["passes"], b["passes"]);
    assert_eq!(a, resolve(&BTreeMap::new(), -1, rate).unwrap());
    for rate in [
        FrameRate::new(0, 1),
        FrameRate::new(30, 0),
        FrameRate::new(7, 3),
        FrameRate::new(240000, 2),
        FrameRate::new(120000, 1002),
    ] {
        assert!(resolve(&BTreeMap::new(), 0, rate).is_err());
    }
    for ticks in [
        9_007_199_254_740_992,
        -9_007_199_254_740_992,
        i64::MIN,
        i64::MAX,
    ] {
        assert!(resolve(&BTreeMap::new(), ticks, FrameRate::FPS_30).is_err());
    }
}

#[test]
fn droplets_large_tick_phase_matches_independent_binary_rational_vectors() {
    // Vectors computed with JS BigInt IEEE754 decomposition and Euclidean modulo.
    for (ticks, speed, expected) in [
        (9_007_199_254_740_991, 0.35, 0.32499831914901733),
        (-9_007_199_254_740_991, 0.35, 0.6633350253105164),
        (9_007_199_254_740_991, 4.0, 0.0),
        (-1, 0.5, 0.9833333492279053),
        (239999, 0.5, 0.9833333492279053),
    ] {
        assert_eq!(phase_at(ticks, speed, FrameRate::FPS_30), expected);
        pack_uniforms(&pass_at(&[("speed", speed)], ticks), 96, 64).unwrap();
    }
}

#[test]
fn droplets_subnormal_static_and_rounded_cycle_endpoint_are_valid() {
    let rate = FrameRate::new(120000, 1);
    for speed in [0.0, f64::from_bits(1), f64::MIN_POSITIVE] {
        for ticks in [0, 1, -1, 9_007_199_254_740_991, -9_007_199_254_740_991] {
            assert_eq!(phase_at(ticks, speed, rate), 0.0);
        }
    }
    assert_eq!(
        phase_at(120000, f64::from_bits(1.0_f64.to_bits() - 1), rate),
        0.0
    );
    assert_eq!(phase_at(120000, 0.99999999, rate), 0.0);
    let a = pack_uniforms(&pass_at(&[("speed", 0.0)], 0), 96, 64).unwrap();
    let b = pack_uniforms(&pass_at(&[("speed", 0.0)], -9_007_199_254_740_991), 96, 64).unwrap();
    assert_eq!(bytemuck::bytes_of(&a), bytemuck::bytes_of(&b));
}

#[test]
fn droplets_geometry_matches_independent_hash_vectors_and_budget_layout() {
    let buffer = pack_uniforms(&pass_at(&[("count", 64.0), ("speed", 0.0)], 0), 96, 64).unwrap();
    assert_eq!(std::mem::size_of::<DropletsUniformBuffer>(), 32 + 64 * 16);
    assert_eq!(buffer.resolution_count, [96.0, 64.0, 64.0, 0.0]);
    assert_eq!(buffer.controls, [1.0, 0.018, 0.15, 0.0]);
    for (i, x, phase, scale) in [
        (0, 0.3577302098274231, 0.8493951559066772, 1.114522099494934),
        (
            1,
            0.4342139959335327,
            0.7467885613441467,
            0.8406193852424622,
        ),
        (
            63,
            0.7225860953330994,
            0.5197930932044983,
            0.7652951776981354,
        ),
    ] {
        assert_eq!(
            buffer.drops[i],
            [
                x as f32,
                phase as f32,
                (f64::from(0.035_f32) * scale) as f32,
                1.8
            ]
        );
    }
    let smaller = pack_uniforms(&pass_at(&[("count", 1.0), ("speed", 0.0)], 0), 96, 64).unwrap();
    assert_eq!(buffer.drops[0], smaller.drops[0]);
    assert!(smaller.drops[1..].iter().all(|drop| *drop == [0.0; 4]));
    let other_seed = pack_uniforms(&pass_at(&[("seed", 2.0), ("speed", 0.0)], 0), 96, 64).unwrap();
    assert_ne!(buffer.drops[0], other_seed.drops[0]);
    assert!(include_str!("../shaders/droplets.wgsl").contains("drops: array<vec4f, 64>"));
}

#[test]
fn droplets_raw_uniforms_reject_malformed_input_even_when_inactive() {
    for field in definition().fields {
        for bad in [
            field.min as f32 - 1.0,
            field.max as f32 + 1.0,
            f32::NAN,
            f32::INFINITY,
        ] {
            let mut pass = pass_at(&[], 0);
            pass.uniforms
                .insert("amount".into(), UniformValue::Number(0.0));
            pass.uniforms
                .insert(field.key.into(), UniformValue::Number(bad));
            assert!(pack_uniforms(&pass, 96, 64).is_err(), "{}={bad}", field.key);
        }
    }
    for key in [
        "amount",
        "count",
        "radius",
        "speed",
        "elongation",
        "refraction",
        "highlight",
        "seed",
        "phase",
    ] {
        let mut pass = pass_at(&[], 0);
        pass.uniforms
            .insert(key.into(), UniformValue::Vector(vec![0.0]));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
        pass.uniforms.remove(key);
        assert!(matches!(
            pack_uniforms(&pass, 96, 64),
            Err(EffectsError::MissingUniform { .. })
        ));
    }
    for (key, value) in [
        ("count", 0.5),
        ("seed", 1.5),
        ("phase", -0.1),
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("phase", f32::INFINITY),
        ("typo", 1.0),
    ] {
        let mut pass = pass_at(&[], 0);
        pass.uniforms
            .insert(key.into(), UniformValue::Number(value));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
    }
    let mut wrong_shader = pass_at(&[], 0);
    wrong_shader.shader = "ripple".into();
    assert!(pack_uniforms(&wrong_shader, 96, 64).is_err());
    assert!(pack_uniforms(&pass_at(&[], 0), 0, 64).is_err());
    assert!(pack_uniforms(&pass_at(&[], 0), 96, 0).is_err());
    let mut boundary = pass_at(&[], 0);
    boundary.uniforms.insert(
        "phase".into(),
        UniformValue::Number(f32::from_bits(1.0_f32.to_bits() - 1)),
    );
    pack_uniforms(&boundary, 96, 64).unwrap();
}
