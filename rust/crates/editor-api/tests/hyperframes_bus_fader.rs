use editor_api::resolve_hyperframes_bus_fader_json;
use serde_json::{Value, json};

fn request(points: Value) -> Value {
    json!({"version":1,"rawVolume":"0.5suffix","automation":
        json!({"version":1,"lanes":[{"target":"volume","points":points}]}).to_string(),
        "scheduledAt":0,"elapsed":0,"rate":1})
}

fn prepare(input: Value) -> Value {
    let result: Value =
        serde_json::from_str(&resolve_hyperframes_bus_fader_json(input.to_string())).unwrap();
    assert!(result.get("error").is_none(), "{result}");
    result["plan"].clone()
}

#[test]
fn bus_static_volume_uses_native_parse_float_prefix_and_not_number_coercion() {
    for (raw, expected) in [
        ("0.5suffix", 0.5),
        ("0x10", 0.0),
        (".25e+1junk", 2.5),
        ("1e+oops", 1.0),
        ("\u{feff}-.5tail", 0.0),
        ("Infinity", 1.0),
        ("1e999", 1.0),
        ("", 1.0),
        ("NaN", 1.0),
        ("\u{0085}.5", 1.0),
    ] {
        let mut input = request(json!([]));
        input["rawVolume"] = json!(raw);
        let plan = prepare(input);
        assert_eq!(plan["staticGain"], expected, "{raw}");
        assert_eq!(plan["events"], json!([]));
        assert_eq!(plan["executionReady"], false);
    }
}

#[test]
fn native_linear_and_constant_lanes_emit_audio_param_events_not_track_fades() {
    let plan = prepare(request(json!([{"t":0,"v":0},{"t":1,"v":2}])));
    assert_eq!(plan["cancelFrom"], 0.0);
    assert_eq!(
        plan["events"],
        json!([{"kind":"set","time":0.0,"value":0.0},{"kind":"ramp","time":1.0,"value":2.0}])
    );
    let plan = prepare(request(json!([{"t":0,"v":2,"curve":1},{"t":1,"v":2}])));
    assert_eq!(
        plan["events"],
        json!([{"kind":"set","time":0.0,"value":2.0}])
    );
    let mut input = request(json!([{"t":0,"v":0},{"t":1,"v":2}]));
    input["scheduledAt"] = json!(2);
    input["elapsed"] = json!(0.5);
    input["rate"] = json!(2);
    assert_eq!(
        prepare(input)["events"],
        json!([
            {"kind":"set","time":2.0,"value":1.0},{"kind":"ramp","time":2.25,"value":2.0}
        ])
    );
}

#[test]
fn curved_events_match_pinned_native_float32_bits_and_drop_overlapping_seed() {
    // Recorded from unmodified scheduleParamLane + sampleAutomationCurve in
    // pinned 0.8.139 using a recording AudioParam, not from the Rust evaluator.
    let mut input = request(json!([{"t":0,"v":0,"curve":0.5},{"t":0.1,"v":1}]));
    let full = prepare(input.clone());
    assert_eq!(full["events"].as_array().unwrap().len(), 1);
    assert_eq!(full["events"][0]["kind"], "curve");
    assert_eq!(full["events"][0]["time"], 0.0);
    let bits: Vec<_> = full["events"][0]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| (value.as_f64().unwrap() as f32).to_bits())
        .collect();
    assert_eq!(
        bits,
        [
            0, 1011500424, 1028277640, 1038323257, 1045054856, 1050543698, 1055100473, 1058725180,
            1061832072, 1065353216
        ]
    );
    input["scheduledAt"] = json!(2);
    input["elapsed"] = json!(0.05);
    let partial = prepare(input);
    let bits: Vec<_> = partial["events"][0]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| (value.as_f64().unwrap() as f32).to_bits())
        .collect();
    assert_eq!(
        bits,
        [
            1048576000, 1051143941, 1054054275, 1057135804, 1058933363, 1060902118, 1063042069,
            1065353216
        ]
    );
    assert_eq!(partial["curveFailurePolicy"], "native-linear-ramp-fallback");
}

#[test]
fn bus_via_undershoot_is_not_clamped_like_a_track_and_curve_counts_are_bounded() {
    let plan = prepare(request(
        json!([{"t":0,"v":0,"viaX":0.5,"viaY":0.001},{"t":0.1,"v":1}]),
    ));
    let values = plan["events"][0]["values"].as_array().unwrap();
    assert!(values.iter().any(|value| value.as_f64().unwrap() < 0.0));
    assert_eq!(values.last().unwrap(), 1.0);
    for (duration, count) in [(0.0001, 8), (100.0, 4096)] {
        let plan = prepare(request(
            json!([{"t":0,"v":0,"curve":1},{"t":duration,"v":1}]),
        ));
        assert_eq!(plan["events"][0]["values"].as_array().unwrap().len(), count);
    }
}

#[test]
fn volume_normalization_keeps_native_first_surviving_lane_and_512_point_limit() {
    let mut input = request(json!([]));
    input["automation"] = json!(
        json!({"version":1,"lanes":[
            {"target":"volume","points":[{"t":0,"v":" "},{"t":0,"v":null}]},
            {"target":"volume","points":[{"t":-3,"v":1},{"t":0,"v":2}]},
            {"target":"volume","points":[{"t":0,"v":3}]}
        ]})
        .to_string()
    );
    assert_eq!(
        prepare(input)["events"],
        json!([{"kind":"set","time":0.0,"value":2.0}])
    );
    let points = json!(
        (0..513)
            .map(|i| json!({"t":i,"v":if i == 512 {2} else {1}}))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        prepare(request(points))["events"],
        json!([{"kind":"set","time":0.0,"value":1.0}])
    );
}

#[test]
fn expanded_curves_and_unsupported_lanes_fail_before_unbounded_event_allocation() {
    let points = json!(
        (0..66)
            .map(|i| json!({"t":i * 100,"v":i % 2,"curve":1}))
            .collect::<Vec<_>>()
    );
    let result: Value = serde_json::from_str(&resolve_hyperframes_bus_fader_json(
        request(points).to_string(),
    ))
    .unwrap();
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("expanded curve-value")
    );
    let mut input = request(json!([{"t":0,"v":1}]));
    input["automation"] =
        json!(r#"{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":1}]}]}"#);
    let result: Value =
        serde_json::from_str(&resolve_hyperframes_bus_fader_json(input.to_string())).unwrap();
    assert!(result["error"].as_str().unwrap().contains("only volume"));
}
