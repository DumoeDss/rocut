use editor_api::resolve_effect_layer_params_json;
use serde_json::{Value, json};

fn request(kind: &str) -> Value {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == kind)
        .unwrap()["fields"]
        .as_array()
        .unwrap();
    let params: serde_json::Map<String, Value> = fields
        .iter()
        .filter(|f| f["required"] != false)
        .map(|f| (f["key"].as_str().unwrap().into(), f["default"].clone()))
        .collect();
    json!({"version":1,"effectType":kind,"params":params,"animations":{},"localTicks":12000})
}
fn channel(a: f64, b: f64, segment: &str) -> Value {
    json!({"keys":[{"id":"a","time":0,"value":a,"segmentToNext":segment,"tangentMode":"auto"},
        {"id":"b","time":24000,"value":b,"segmentToNext":"linear","tangentMode":"auto"}]})
}
fn resolve(input: &Value) -> Value {
    serde_json::from_str(&resolve_effect_layer_params_json(input.to_string())).unwrap()
}

#[test]
fn bubble_all_twenty_one_optical_fields_sample_native_linear_and_keep_fallbacks() {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "bubble")
        .unwrap()["fields"]
        .as_array()
        .unwrap();
    let mut count = 0;
    for field in fields.iter().filter(|f| f["keyframable"] == true) {
        count += 1;
        let key = field["key"].as_str().unwrap();
        let a = field["min"].as_f64().unwrap();
        let b = field["max"].as_f64().unwrap();
        let mut input = request("bubble");
        input["animations"][format!("params.{key}")] = channel(a, b, "linear");
        let result = resolve(&input);
        assert!(result.get("error").is_none(), "{key}: {result}");
        assert_eq!(result["params"][key].as_f64().unwrap(), a + (b - a) * 0.5);
        assert_eq!(
            result["params"]["point0Time"],
            input["params"]["point0Time"]
        );
        assert_eq!(input["params"][key], field["default"]);
    }
    assert_eq!(count, 21);
}
#[test]
fn step_hold_bezier_defaults_and_fractional_local_ticks_use_native_sampler() {
    for (segment, want) in [("step", 0.1), ("linear", 0.3), ("bezier", 0.3)] {
        let mut input = request("bubble");
        input["animations"]["params.radius"] = channel(0.1, 0.5, segment);
        let value = resolve(&input)["params"]["radius"].as_f64().unwrap();
        assert!((value - want).abs() < 0.00001, "{segment}: {value}");
        input["localTicks"] = json!(24000.5);
        assert_eq!(resolve(&input)["params"]["radius"], 0.5);
    }
}
#[test]
fn nonkeyframable_unknown_paths_missing_fallback_and_bad_schedule_reject() {
    for key in [
        "startTicks",
        "durationTicks",
        "pointCount",
        "point0Time",
        "speed",
        "follow",
        "trail",
    ] {
        let mut input = request("bubble");
        input["animations"][format!("params.{key}")] = channel(0.0, 1.0, "linear");
        assert!(resolve(&input).get("error").is_some(), "{key}");
    }
    for path in [
        "refraction",
        "effects.lens.params.refraction",
        "params.unknown",
    ] {
        let mut input = request("bubble");
        input["animations"][path] = channel(0.1, 0.2, "linear");
        assert!(resolve(&input).get("error").is_some());
    }
    let mut input = request("bubble");
    input["animations"]["params.radius"] = channel(0.1, 0.2, "linear");
    input["params"].as_object_mut().unwrap().remove("radius");
    assert!(resolve(&input).get("error").is_some());
    let mut input = request("bubble");
    input["params"]["pointCount"] = json!(2);
    input["params"]["point1Time"] = json!(0);
    input["params"]["point1X"] = json!(0.4);
    input["params"]["point1Y"] = json!(0.5);
    assert!(resolve(&input).get("error").is_some());
}
#[test]
fn malformed_keys_local_time_version_and_unknown_fields_reject_atomically() {
    for time in [json!(-1), json!(9007199254740992_u64), json!("NaN")] {
        let mut input = request("bubble");
        input["localTicks"] = time;
        assert!(resolve(&input).get("error").is_some());
    }
    for change in 0..6 {
        let mut input = request("bubble");
        input["animations"]["params.radius"] = channel(0.1, 0.5, "linear");
        match change {
            0 => input["animations"]["params.radius"]["keys"][1]["time"] = json!(0),
            1 => input["animations"]["params.radius"]["keys"][1]["id"] = json!("a"),
            2 => input["animations"]["params.radius"]["keys"][0]["value"] = json!("NaN"),
            3 => {
                input["animations"]["params.radius"]["keys"][0]["rightHandle"] =
                    json!({"dt":-1,"dv":0})
            }
            4 => input["version"] = json!(2),
            _ => input["extra"] = json!(true),
        }
        let result = resolve(&input);
        assert!(result.get("error").is_some());
        assert!(result.get("params").is_none());
    }
}
#[test]
fn actual_native_catalog_generalizes_without_bubble_specific_interpolation() {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    for entry in catalog.as_array().unwrap() {
        let kind = entry["id"].as_str().unwrap();
        let mut input = request(kind);
        for field in entry["fields"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["keyframable"] == true)
        {
            let key = field["key"].as_str().unwrap();
            let value = field["default"].as_f64().unwrap();
            input["params"][key] = json!(value);
            input["animations"][format!("params.{key}")] = channel(value, value, "linear");
        }
        let result = resolve(&input);
        assert!(result.get("error").is_none(), "{kind}: {result}");
    }
}

#[test]
fn invalid_curves_and_out_of_domain_samples_never_publish_partial_params() {
    for change in 0..5 {
        let mut input = request("bubble");
        input["animations"]["params.radius"] = channel(0.1, 0.5, "bezier");
        input["animations"]["params.refraction"] = channel(0.1, 0.2, "linear");
        match change {
            0 => {
                input["animations"]["params.radius"]["extrapolation"] =
                    json!({"before":"hold","after":"invalid"})
            }
            1 => input["animations"]["params.radius"]["keys"][0]["time"] = json!(0.5),
            2 => input["animations"]["params.radius"]["keys"][0]["unexpected"] = json!(true),
            3 => {
                input["animations"]["params.radius"]["extrapolation"] =
                    json!({"before":"hold","after":"linear"});
                input["localTicks"] = json!(120000);
            }
            _ => {
                input["animations"]["params.radius"]["keys"][0]["rightHandle"] =
                    json!({"dt":1.5,"dv":0})
            }
        }
        let result = resolve(&input);
        assert!(result.get("error").is_some(), "{result}");
        assert!(result.get("params").is_none());
    }
}

#[test]
fn supplied_local_tick_is_not_offset_or_trim_adjusted_and_zero_amount_is_not_a_bypass() {
    let mut input = request("bubble");
    input["params"]["amount"] = json!(0);
    input["animations"]["params.radius"] = channel(0.1, 0.5, "linear");
    for (ticks, want) in [(0.0, 0.1), (6000.0, 0.2), (12000.0, 0.3), (24000.0, 0.5)] {
        input["localTicks"] = json!(ticks);
        assert!((resolve(&input)["params"]["radius"].as_f64().unwrap() - want).abs() < 1e-10);
    }
    input["animations"]["params.point0Time"] = channel(0.0, 1.0, "linear");
    assert!(resolve(&input).get("error").is_some());
}

#[test]
fn legacy_blur_scalar_is_native_owned_and_adjustment_animation_remains_unsupported() {
    let input = json!({"version":1,"effectType":"blur","params":{"intensity":15},
        "animations":{"params.intensity":channel(0.0,100.0,"linear")},"localTicks":12000});
    assert_eq!(resolve(&input)["params"]["intensity"], 50.0);
    let mut bad = input.clone();
    bad["params"]["intensity"] = json!(101);
    assert!(resolve(&bad).get("error").is_some());
    for value in [json!(-1), json!("NaN"), json!(null)] {
        let mut bad = input.clone();
        bad["params"]["intensity"] = value;
        assert!(resolve(&bad).get("error").is_some());
    }
    let mut bad = input.clone();
    bad["animations"]["params.unknown"] = channel(0.0, 1.0, "linear");
    assert!(resolve(&bad).get("error").is_some());
    let mut static_input = input.clone();
    static_input["animations"] = json!({});
    assert_eq!(resolve(&static_input)["params"], json!({"intensity":15}));
    let mut bad = input;
    bad["effectType"] = json!("color-adjustment");
    assert!(resolve(&bad).get("error").is_some());
}
