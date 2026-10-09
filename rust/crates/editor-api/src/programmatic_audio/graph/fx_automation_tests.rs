use super::fx::parse_chain_json;
use super::fx_automation::{FxAutomationAdmission, admit_fx_automation};
use serde_json::{Value, json};

fn admit(nodes: Value, lanes: Value) -> Result<FxAutomationAdmission, String> {
    let chain = parse_chain_json(&json!({"version":1,"nodes":nodes}).to_string()).unwrap();
    admit_fx_automation(
        Some(&json!({"version":1,"lanes":lanes}).to_string()),
        &chain,
    )
}

fn lane(target: &str, points: Value) -> Value {
    json!({"target":target,"points":points})
}
fn ramp(target: &str, from: f64, to: f64) -> Value {
    lane(target, json!([{"t":0,"v":from},{"t":1,"v":to}]))
}
fn one(kind: &str, target: &str, from: f64, to: f64) -> FxAutomationAdmission {
    admit(
        json!([{"id":"n1","type":kind}]),
        json!([ramp(target, from, to)]),
    )
    .unwrap()
}

#[test]
fn fx_automation_preserves_knob_units_shape_identity_and_native_cleaning() {
    let result = admit(
        json!([{"id":"gain-id","type":"gain"}]),
        json!([lane(
            "fx.gain-id.gain",
            json!([
                {"t":2,"v":90,"curve":2,"viaX":-2,"viaY":2},
                {"t":"0x1","v":" -6 ","curve":-5,"viaX":0.7,"viaY":0.3},
                {"t":-1,"v":-900}, {"t":1,"v":"-12","curve":".5"},
                {"t":null,"v":0}, {"t":0,"v":[]}, null,
            ])
        )]),
    )
    .unwrap();
    let native = result.fx_automation.unwrap();
    assert_eq!(native["lanes"][0]["target"], "fx.gain-id.gain");
    assert_eq!(
        native["lanes"][0]["points"],
        json!([
            {"t":0.0,"v":-60.0}, {"t":1.0,"v":-12.0,"curve":0.5},
            {"t":2.0,"v":12.0,"curve":1.0,"viaX":0.001,"viaY":0.999}
        ])
    );
    assert_eq!(result.point_count, 3);
    assert_eq!(result.expanded_curve_values, 200);
    assert_eq!(result.scheduled_events, 2);
}

#[test]
fn fx_automation_all_exposed_native_knobs_have_correct_curve_budget() {
    // Actual builder exposure, not the UI automatable declaration alone.
    for (kind, key, from, to, curves, events) in [
        ("gain", "gain", -6.0, 6.0, 100, 1),
        ("peaking", "frequency", 200.0, 8000.0, 100, 1),
        ("peaking", "gain", -6.0, 6.0, 0, 2),
        ("peaking", "q", 0.1, 20.0, 100, 1),
        ("lowshelf", "frequency", 20.0, 2000.0, 100, 1),
        ("lowshelf", "gain", -6.0, 6.0, 0, 2),
        ("highshelf", "frequency", 500.0, 20000.0, 100, 1),
        ("highshelf", "gain", -6.0, 6.0, 0, 2),
        ("highpass", "frequency", 20.0, 20000.0, 100, 1),
        ("highpass", "q", 0.1, 20.0, 100, 1),
        ("lowpass", "frequency", 100.0, 20000.0, 100, 1),
        ("lowpass", "q", 0.1, 20.0, 100, 1),
        ("saturate", "output", -24.0, 24.0, 100, 1),
        ("delay", "time", 1.0, 1000.0, 100, 1),
        ("delay", "feedback", 0.01, 0.95, 0, 2),
        ("delay", "mix", 0.0, 1.0, 100, 3),
        ("chorus", "delay", 1.0, 100.0, 100, 1),
        ("chorus", "depth", 0.0, 10.0, 100, 1),
        ("chorus", "speed", 0.01, 10.0, 0, 2),
        ("chorus", "mix", 0.0, 1.0, 100, 3),
        ("phaser", "in_gain", 0.0, 1.0, 0, 2),
        ("phaser", "out_gain", 0.0, 2.0, 0, 2),
        ("phaser", "speed", 0.1, 2.0, 0, 2),
        ("reverb", "wet", 0.0, 1.0, 0, 2),
        ("reverb", "dry", 0.0, 1.0, 0, 2),
    ] {
        let target = format!("fx.n1.{key}");
        let result = one(kind, &target, from, to);
        assert_eq!(result.expanded_curve_values, curves, "{target} {kind}");
        assert_eq!(result.scheduled_events, events, "{target} {kind}");
        assert!(result.diagnostics.is_empty(), "{target} {kind}");
        assert_eq!(
            result.fx_automation.unwrap()["lanes"][0]["points"][1]["v"],
            to
        );
    }
}

#[test]
fn fx_automation_no_audio_param_and_disabled_lanes_remain_explicit_native_noops() {
    for (kind, key) in [
        ("compressor", "threshold"),
        ("limiter", "limit"),
        ("gate", "range"),
        ("bitcrush", "bits"),
        ("pitchshift", "mix"),
        ("saturate", "threshold"),
        ("saturate", "oversample"),
        ("phaser", "delay"),
        ("phaser", "decay"),
        ("reverb", "size"),
        ("reverb", "damping"),
    ] {
        let result = one(kind, &format!("fx.n1.{key}"), 0.0, 1.0);
        assert!(result.fx_automation.is_some(), "{kind}.{key}");
        assert_eq!(
            (result.expanded_curve_values, result.scheduled_events),
            (0, 0)
        );
        assert!(result.diagnostics[0].contains("no enabled AudioParam"));
    }
    for node in [
        json!({"id":"n1","type":"lowpass","params":{"poles":"1"}}),
        json!({"id":"n1","type":"highpass","params":{"poles":"1"}}),
        json!({"id":"n1","type":"peaking","enabled":false}),
    ] {
        let result = admit(
            json!([node]),
            json!([ramp("fx.n1.frequency", 200.0, 8000.0)]),
        )
        .unwrap();
        assert_eq!(
            (result.expanded_curve_values, result.scheduled_events),
            (0, 0)
        );
        assert!(result.fx_automation.is_some());
    }
}

#[test]
fn fx_automation_preset_split_runs_include_both_wet_and_mapped_dry_params() {
    let nodes = json!([
        {"type":"gain","fromPreset":"radio"}, {"type":"gain","fromPreset":"radio"},
        {"type":"gain"}, {"type":"gain","fromPreset":"radio"},
        {"type":"gain","enabled":false}, {"type":"gain","fromPreset":"radio"}
    ]);
    let result = admit(nodes, json!([ramp("fx.preset.radio", 0.0, 1.0)])).unwrap();
    assert_eq!(
        (result.expanded_curve_values, result.scheduled_events),
        (200, 6)
    );
    let disabled = admit(
        json!([{"type":"gain","fromPreset":"radio","enabled":false}]),
        json!([ramp("fx.preset.radio", 0.0, 1.0)]),
    )
    .unwrap();
    assert_eq!(
        (disabled.expanded_curve_values, disabled.scheduled_events),
        (0, 0)
    );
    assert!(disabled.fx_automation.is_some());
}

#[test]
fn fx_automation_volume_projection_keeps_native_first_lane_and_no_fx_budget() {
    let result = admit(
        json!([{"id":"n1","type":"gain"}]),
        json!([
            ramp("volume", 0.0, 2.0),
            ramp("fx.n1.gain", -6.0, 6.0),
            ramp("volume", 1.0, 0.0)
        ]),
    )
    .unwrap();
    assert_eq!(result.point_count, 6);
    assert_eq!(result.expanded_curve_values, 100);
    assert_eq!(result.scheduled_events, 1);
    assert_eq!(result.volume_points.unwrap()[1].v, 2.0);
    let volume: Value = serde_json::from_str(&result.volume_automation.unwrap()).unwrap();
    assert_eq!(volume["lanes"].as_array().unwrap().len(), 2);
    assert_eq!(
        result.fx_automation.unwrap()["lanes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn fx_automation_rate_is_separate_from_fx_and_orphan_enum_drops_are_diagnosed() {
    for points in [json!([]), json!([{"t":0,"v":1}])] {
        let result = admit(json!([]), json!([lane("rate", points.clone())])).unwrap();
        assert!(result.fx_automation.is_none());
        assert_eq!(
            result.rate_points.is_some(),
            !points.as_array().unwrap().is_empty()
        );
        assert_eq!(result.scheduled_events, 0);
    }
    let result = admit(
        json!([{"id":"n1","type":"lowpass"}]),
        json!([
            ramp("fx.missing.gain", 0.0, 1.0),
            ramp("fx.n1.poles", 1.0, 2.0),
            ramp("fx.preset.gone", 0.0, 1.0)
        ]),
    )
    .unwrap();
    assert!(result.fx_automation.is_none());
    assert_eq!(result.diagnostics.len(), 3);
    for target in ["", "other", "fx.n1", "fx..gain", "fx.n1.gain.extra"] {
        assert!(admit(json!([]), json!([ramp(target, 0.0, 1.0)])).is_err());
    }
}

#[test]
fn fx_automation_duplicate_ids_use_first_range_but_last_enabled_handle() {
    let result = admit(
        json!([
            {"id":"same","type":"gain"}, {"id":"same","type":"peaking"}
        ]),
        json!([ramp("fx.same.gain", -100.0, 100.0)]),
    )
    .unwrap();
    let native = result.fx_automation.unwrap();
    assert_eq!(native["lanes"][0]["points"][0]["v"], -60.0);
    assert_eq!(native["lanes"][0]["points"][1]["v"], 12.0);
    assert_eq!(
        (result.expanded_curve_values, result.scheduled_events),
        (0, 2)
    );
    let result = admit(
        json!([
            {"id":"same","type":"peaking"}, {"id":"same","type":"gain"}
        ]),
        json!([ramp("fx.same.gain", -100.0, 100.0)]),
    )
    .unwrap();
    assert_eq!(
        result.fx_automation.unwrap()["lanes"][0]["points"][1]["v"],
        40.0
    );
    assert_eq!(result.expanded_curve_values, 100);
}

#[test]
fn fx_automation_duplicate_lanes_schedule_all_but_tail_uses_first_lane() {
    let result = admit(
        json!([{"id":"n1","type":"delay","params":{"time":5000,"feedback":0,"mix":1}}]),
        json!([
            lane("fx.n1.time", json!([{"t":0,"v":20}])),
            lane("fx.n1.time", json!([{"t":0,"v":200}]))
        ]),
    )
    .unwrap();
    assert!((result.tail_seconds - 0.04).abs() < 1e-12);
    assert_eq!(result.scheduled_events, 2);
    assert_eq!(
        result.fx_automation.unwrap()["lanes"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(
        result
            .diagnostics
            .iter()
            .any(|text| text.contains("duplicate"))
    );
}

#[test]
fn fx_automation_native_tail_uses_lane_max_instead_of_static_fallback_even_for_noop_knob() {
    let result = admit(
        json!([{"id":"r","type":"reverb","params":{"size":1,"wet":1}}]),
        json!([lane("fx.r.size", json!([{"t":0,"v":0}]))]),
    )
    .unwrap();
    assert!((result.tail_seconds - 0.73).abs() < 1e-12);
    assert_eq!(result.scheduled_events, 0);
    let result = admit(
        json!([{"id":"d","type":"delay","params":{"time":1,"feedback":0.01,"mix":0}}]),
        json!([
            ramp("fx.d.mix", 0.0, 1.0),
            ramp("fx.d.time", 1.0, 5000.0),
            ramp("fx.d.feedback", 0.01, 0.95)
        ]),
    )
    .unwrap();
    assert_eq!(result.tail_seconds, 5.0);
    let result = admit(
        json!([
            {"type":"reverb","params":{"size":1,"wet":1}},
            {"type":"reverb","params":{"size":1,"wet":1}}
        ]),
        json!([]),
    )
    .unwrap();
    assert_eq!(result.tail_seconds, 5.0);
}

#[test]
fn fx_automation_constant_clamped_and_empty_lanes_match_scheduler_shortcuts() {
    let result = admit(
        json!([{"id":"n1","type":"gain"}]),
        json!([lane(
            "fx.n1.gain",
            json!([{"t":0,"v":90,"curve":1},{"t":86000,"v":99}])
        )]),
    )
    .unwrap();
    assert_eq!(
        (result.expanded_curve_values, result.scheduled_events),
        (0, 1)
    );
    let result = admit(
        json!([{"id":"n1","type":"gain"}]),
        json!([lane("fx.n1.gain", json!([{"t":null,"v":2},{"t":1,"v":""}]))]),
    )
    .unwrap();
    assert!(result.fx_automation.is_none());
    assert_eq!(result.point_count, 0);
}

#[test]
fn fx_automation_curve_values_include_via_and_native_minimum_cap_and_seed() {
    for (start, end, expected, events) in [
        (0.0, 0.001, 8, 1),
        (2.0, 2.001, 8, 2),
        (0.0, 100.0, 4096, 1),
    ] {
        let result = admit(
            json!([{"id":"n1","type":"peaking"}]),
            json!([lane(
                "fx.n1.gain",
                json!([{"t":start,"v":0,"viaX":0.2,"viaY":0.8},{"t":end,"v":1}])
            )]),
        )
        .unwrap();
        assert_eq!(
            (result.expanded_curve_values, result.scheduled_events),
            (expected, events)
        );
    }
}

#[test]
fn fx_automation_bounds_validate_before_native_truncation_and_outside_crop() {
    let points: Vec<_> = (0..513).map(|i| json!({"t":i,"v":i%2})).collect();
    let result = admit(
        json!([{"id":"n1","type":"peaking"}]),
        json!([lane("fx.n1.gain", json!(points))]),
    )
    .unwrap();
    assert_eq!(result.point_count, 512);
    let mut bad = points;
    bad.push(json!({"t":86401,"v":1}));
    assert!(
        admit(
            json!([{"id":"n1","type":"gain"}]),
            json!([lane("fx.n1.gain", json!(bad))])
        )
        .unwrap_err()
        .contains("time")
    );
    assert!(
        admit(
            json!([]),
            json!([lane("fx.missing.gain", json!([{"t":86401,"v":1}]))])
        )
        .unwrap_err()
        .contains("time")
    );
    let excessive: Vec<_> = (0..4097).map(|_| json!({"t":0,"v":1})).collect();
    assert!(
        admit(json!([]), json!([lane("volume", json!(excessive))]))
            .unwrap_err()
            .contains("raw point")
    );
    assert!(
        admit(
            json!([]),
            json!(
                (0..33)
                    .map(|_| ramp("volume", 0.0, 1.0))
                    .collect::<Vec<_>>()
            )
        )
        .unwrap_err()
        .contains("lane limit")
    );
}

#[test]
fn fx_automation_stage_expanded_curve_boundary_is_exact_and_not_truncated() {
    // Every 50-second mapped segment expands to the native maximum 4096.
    for (segments, ok) in [(64, true), (65, false)] {
        let points: Vec<_> = (0..=segments).map(|i| json!({"t":i*50,"v":i%2})).collect();
        let result = admit(
            json!([{"id":"n1","type":"gain"}]),
            json!([lane("fx.n1.gain", json!(points))]),
        );
        if ok {
            assert_eq!(result.unwrap().expanded_curve_values, 262144);
        } else {
            assert!(result.unwrap_err().contains("expanded curve"));
        }
    }
}

#[test]
fn fx_automation_absence_uses_static_tail_and_raw_payload_safety_stays_bounded() {
    let chain = parse_chain_json(r#"{"version":1,"nodes":[{"type":"chorus"}]}"#).unwrap();
    let empty = admit_fx_automation(None, &chain).unwrap();
    assert_eq!(empty.tail_seconds, 0.007);
    assert!(empty.fx_automation.is_none());
    for raw in [
        "[]",
        "null",
        r#"{"version":2,"lanes":[]}"#,
        r#"{"version":1,"lanes":[null]}"#,
        r#"{"version":1,"lanes":[{"target":"volume","points":"bad"}]}"#,
        r#"{"version":1,"lanes":[],"extra":"\ud800"}"#,
    ] {
        assert!(admit_fx_automation(Some(raw), &chain).is_err(), "{raw}");
    }
    assert!(
        admit_fx_automation(Some(&" ".repeat(131073)), &chain)
            .unwrap_err()
            .contains("byte safety")
    );
    let mut deep = json!(0);
    for _ in 0..10 {
        deep = json!([deep]);
    }
    let raw = json!({"version":1,"lanes":[],"extra":deep}).to_string();
    assert!(
        admit_fx_automation(Some(&raw), &chain)
            .unwrap_err()
            .contains("depth/value")
    );
}
