use super::{
    MAX_FROST_TICKS, catalog, params, resolve,
    strokes::{Stroke, capsule_melt},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use time::FrameRate;

pub(super) fn authored(extra: &[(&str, f64)]) -> BTreeMap<String, f64> {
    let mut values = BTreeMap::from([
        ("strokeCount".into(), 1.0),
        ("stroke0TimeTicks".into(), 12000.0),
        ("stroke0FromX".into(), 0.25),
        ("stroke0FromY".into(), 0.5),
        ("stroke0ToX".into(), 0.75),
        ("stroke0ToY".into(), 0.5),
        ("stroke0Radius".into(), 0.1),
        ("stroke0Strength".into(), 0.8),
        ("holdTicks".into(), 8000.0),
        ("recoveryTicks".into(), 16000.0),
    ]);
    for (k, v) in extra {
        values.insert((*k).into(), *v);
    }
    values
}
pub(super) fn value_at(extra: &[(&str, f64)], ticks: i64) -> Value {
    resolve(&authored(extra), ticks, FrameRate::FPS_30).unwrap()
}
#[test]
fn frost_authored_melt_and_linear_recovery_use_manual_tick_expected_values() {
    for (time, strength) in [
        (8000, None),
        (12000, Some(0.8)),
        (20000, Some(0.8)),
        (24000, Some(0.6)),
        (28000, Some(0.4)),
        (32000, Some(0.2)),
        (36000, None),
    ] {
        let result = value_at(&[], time);
        let uniforms = &result["passes"][0]["uniforms"];
        if let Some(expected) = strength {
            assert!((uniforms["stroke0Strength"].as_f64().unwrap() - expected).abs() < 1e-12);
            assert_eq!(uniforms["strokeCount"].as_f64(), Some(1.0));
        } else {
            assert_eq!(uniforms["strokeCount"].as_f64(), Some(0.0));
            assert!(uniforms.get("stroke0Strength").is_none());
        }
    }
}
#[test]
fn frost_seek_permutations_and_reopen_reconstruct_immutable_absolute_state() {
    let encoded = serde_json::to_string(&authored(&[])).unwrap();
    for time in [32000, 8000, 36000, 12000, 28000, 20000, 32000] {
        let reopened: BTreeMap<String, f64> = serde_json::from_str(&encoded).unwrap();
        let expected = match time {
            32000 => 0.2,
            12000 | 20000 => 0.8,
            28000 => 0.4,
            _ => 0.0,
        };
        let result = resolve(&reopened, time, FrameRate::FPS_30).unwrap();
        let actual = result["passes"][0]["uniforms"]
            .get("stroke0Strength")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        assert!((actual - expected).abs() < 1e-12);
    }
}
#[test]
fn frost_frame_floor_never_activates_a_future_stamp_early() {
    for tick in [12000, 12001, 12003, 15999] {
        let result = value_at(&[("stroke0TimeTicks", 12001.0)], tick);
        assert_eq!(result["frameIndex"], 3);
        assert_eq!(
            result["passes"][0]["uniforms"]["strokeCount"].as_f64(),
            Some(0.0)
        );
    }
    let next = value_at(&[("stroke0TimeTicks", 12001.0)], 16000);
    assert_eq!(next["frameIndex"], 4);
    assert_eq!(next["passes"][0]["uniforms"]["stroke0Strength"], 0.8);
    assert_eq!(value_at(&[], 12003), value_at(&[], 12000));
}
#[test]
fn frost_negative_handles_bypass_but_validate_every_parameter_first() {
    for time in [-1, -4000, -(MAX_FROST_TICKS as i64)] {
        assert_eq!(value_at(&[], time)["passes"], json!([]));
    }
    for key in ["stroke0Radius", "recoveryTicks", "seed"] {
        let mut input = authored(&[]);
        input.insert(key.into(), -1.0);
        assert!(resolve(&input, -1, FrameRate::FPS_30).is_err());
    }
    assert!(resolve(&authored(&[]), i64::MIN, FrameRate::FPS_30).is_err());
}
#[test]
fn frost_neutral_parameters_are_exact_no_pass_not_near_zero() {
    for extra in [
        vec![("amount", 0.0)],
        vec![("coverage", 0.0)],
        vec![("blur", 0.0), ("refraction", 0.0), ("tintStrength", 0.0)],
    ] {
        assert_eq!(value_at(&extra, 24000)["passes"], json!([]));
        let mut bad = authored(&extra);
        bad.insert("stroke16TimeTicks".into(), 0.0);
        assert!(resolve(&bad, 24000, FrameRate::FPS_30).is_err());
    }
    assert_eq!(
        value_at(&[("amount", 0.00001)], 24000)["passes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn frost_capsule_local_profile_and_overlap_have_independent_geometry_values() {
    let sample = |p| capsule_melt(p, [0.25, 0.5], [0.75, 0.5], 0.1, 0.4);
    assert_eq!(sample([0.5, 0.5]), 0.4);
    assert_eq!(sample([0.25, 0.5]), 0.4);
    assert_eq!(sample([0.5, 0.65]), 0.0);
    assert_eq!(sample([0.1, 0.5]), 0.0);
    assert!((sample([0.5, 0.58]) - 0.2).abs() < 1e-12);
    assert_eq!(sample([0.5, 0.5]).max(sample([0.5, 0.5])), 0.4);
    assert_eq!(
        capsule_melt([0.5, 0.5], [0.5, 0.5], [0.5, 0.5], 0.1, 1.0),
        1.0
    );
}
#[test]
fn frost_second_later_stroke_refreezes_from_its_own_stamp_without_accumulation() {
    let first = Stroke {
        time: 12000,
        from: [0.25, 0.5],
        to: [0.75, 0.5],
        radius: 0.1,
        strength: 0.4,
    };
    let second = Stroke {
        time: 28000,
        ..first.clone()
    };
    assert_eq!(first.strength_at(36000, 8000, 16000), 0.0);
    assert_eq!(second.strength_at(36000, 8000, 16000), 0.4);
    assert_eq!(second.strength_at(52000, 8000, 16000), 0.0);
}
#[test]
fn frost_inactive_partial_unknown_fractional_and_nonfinite_inputs_are_rejected() {
    let original = authored(&[]);
    for key in catalog::STROKE_KEYS[0] {
        let mut p = original.clone();
        p.remove(key);
        assert!(params::prepare(&p).is_err(), "{key}");
    }
    for (key, value) in [
        ("stroke1FromX", 0.5),
        ("stroke17TimeTicks", 0.0),
        ("holdTicks", 1.5),
        ("recoveryTicks", 0.0),
        ("seed", 1.5),
        ("strokeCount", 16.1),
        ("strokeCount", 17.0),
        ("stroke0TimeTicks", -1.0),
        ("stroke0Radius", 0.004),
        ("coverage", 1.01),
    ] {
        let mut p = original.clone();
        p.insert(key.into(), value);
        assert!(params::prepare(&p).is_err(), "{key}={value}");
    }
    for key in original.keys() {
        for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut p = original.clone();
            p.insert(key.clone(), v);
            assert!(params::prepare(&p).is_err());
        }
    }
}
#[test]
fn frost_recovery_endpoints_are_checked_in_integer_space_before_sampling() {
    assert!(
        params::prepare(&authored(&[(
            "stroke0TimeTicks",
            (MAX_FROST_TICKS - 24000) as f64
        )]))
        .is_ok()
    );
    assert!(
        params::prepare(&authored(&[(
            "stroke0TimeTicks",
            (MAX_FROST_TICKS - 23999) as f64
        )]))
        .is_err()
    );
    assert!(params::prepare(&authored(&[("holdTicks", 3600001.0)])).is_err());
    assert!(params::prepare(&authored(&[("recoveryTicks", 3600001.0)])).is_err());
}
#[test]
fn frost_seed_is_exact_bounded_static_and_recovered_uniforms_match_unstamped_ice() {
    let recovered = value_at(&[("seed", 16777215.0)], 36000);
    let original = resolve(
        &BTreeMap::from([("seed".into(), 16777215.0)]),
        0,
        FrameRate::FPS_30,
    )
    .unwrap();
    assert_eq!(recovered["passes"], original["passes"]);
    assert_eq!(
        recovered["passes"][0]["uniforms"]["seed"].as_f64(),
        Some(16777215.0)
    );
    assert_ne!(
        value_at(&[("seed", 17.0)], 0)["passes"],
        value_at(&[("seed", 18.0)], 0)["passes"]
    );
    assert!(params::prepare(&authored(&[("seed", 16777216.0)])).is_err());
}
