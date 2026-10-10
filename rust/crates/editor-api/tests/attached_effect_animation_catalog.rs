use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(kind: &str, key: &str, promoted: bool) -> Value {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let mut fields = if kind == "blur" {
        vec![
            json!({"key":"intensity","type":"number","default":15,"min":0,"max":100,"keyframable":true}),
        ]
    } else {
        catalog
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == kind)
            .unwrap()["fields"]
            .as_array()
            .unwrap()
            .clone()
    };
    let params: serde_json::Map<String, Value> = fields
        .iter()
        .filter(|f| f["required"] != false)
        .map(|f| (f["key"].as_str().unwrap().into(), f["default"].clone()))
        .collect();
    let field = fields.iter().find(|f| f["key"] == key).unwrap();
    let fallback = field["default"].clone();
    for f in &mut fields {
        f["type"] = json!("number");
        if promoted {
            f["keyframable"] = json!(true);
            f["min"] = json!(-1e10);
            f["max"] = json!(1e10);
        }
    }
    let mut params = params;
    params.insert(key.into(), fallback.clone());
    json!({"editing":{"type":"text","params":{},"effects":[{"id":"fx","type":kind,"enabled":true,"params":params}],
        "animations":{format!("effects.fx.params.{key}"):{"keys":[{"id":"k0","time":0,"value":fallback,"segmentToNext":"linear","tangentMode":"auto"}]} }},
        "duration":240000,"trackKind":"text","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{kind:fields}}})
}
fn issues(input: &Value) -> Value {
    serde_json::from_str(&validate_clip_editing_json(input.to_string())).unwrap()
}

#[test]
fn attached_bubble_schedule_cannot_be_promoted_by_caller_catalog() {
    for key in [
        "speed",
        "follow",
        "trail",
        "startTicks",
        "durationTicks",
        "pointCount",
        "point0Time",
        "point0X",
        "point0Y",
    ] {
        let input = request("bubble", key, true);
        let result = issues(&input);
        assert!(!result.as_array().unwrap().is_empty(), "{key} was promoted");
        assert!(result.as_array().unwrap().iter().any(|issue|issue["path"]==format!("editing.animations.effects.fx.params.{key}")));
    }
}
#[test]
fn every_stylized_static_field_remains_static_and_optics_remain_valid() {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    for entry in catalog.as_array().unwrap() {
        let kind = entry["id"].as_str().unwrap();
        for field in entry["fields"].as_array().unwrap() {
            let key = field["key"].as_str().unwrap();
            let input = request(kind, key, true);
            let result = issues(&input);
            if field["keyframable"] == true {
                assert_eq!(result, json!([]), "{kind}.{key}: {result}");
            } else {
                assert!(
                    !result.as_array().unwrap().is_empty(),
                    "promoted {kind}.{key}"
                );
            }
        }
    }
}
#[test]
fn caller_range_widening_cannot_animate_invalid_native_optics_or_blur() {
    for (kind, key) in [("bubble", "radius"), ("blur", "intensity")] {
        let mut input = request(kind, key, true);
        assert_eq!(issues(&input), json!([]));
        input["editing"]["animations"][format!("effects.fx.params.{key}")]["keys"][0]["value"] =
            json!(1e8);
        assert!(!issues(&input).as_array().unwrap().is_empty());
    }
}
