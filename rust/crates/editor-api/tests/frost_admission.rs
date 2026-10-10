use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(params: Value, attached: bool, enabled: bool) -> Value {
    // Caller catalog deliberately widens ranges and makes every field optional.
    // Native schedule admission must still reject malformed authored data.
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let mut fields = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "frost")
        .unwrap()["fields"]
        .clone();
    for field in fields.as_array_mut().unwrap() {
        field["required"] = json!(false);
        field["type"] = json!("number");
        field["min"] = json!(-1e20);
        field["max"] = json!(1e20);
    }
    let editing = if attached {
        json!({"type":"text","params":{},"effects":[{"id":"ice","type":"frost","enabled":enabled,"params":params}]})
    } else {
        json!({"type":"effect","effectType":"frost","params":params})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if attached {"text"} else {"effect"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"frost":fields}}})
}
fn issues(params: Value, attached: bool, enabled: bool) -> Value {
    serde_json::from_str(&validate_clip_editing_json(
        request(params, attached, enabled).to_string(),
    ))
    .unwrap()
}
fn stroke() -> Value {
    json!({"strokeCount":1,"stroke0TimeTicks":12001,"stroke0FromX":0.2,"stroke0FromY":0.3,
        "stroke0ToX":0.8,"stroke0ToY":0.7,"stroke0Radius":0.1,"stroke0Strength":1})
}

#[test]
fn native_defaults_and_complete_authored_strokes_are_admitted() {
    for attached in [false, true] {
        for enabled in [false, true] {
            assert_eq!(issues(json!({}), attached, enabled), json!([]));
            assert_eq!(issues(stroke(), attached, enabled), json!([]));
        }
    }
}

#[test]
fn malformed_schedules_cannot_bypass_admission_when_disabled_or_neutral() {
    let mut invalid = vec![
        json!({"strokeCount":1}),
        json!({"stroke0Radius":0.1}),
        json!({"seed":1.5}),
        json!({"coverage":2}),
        json!({"unexpected":1}),
        json!({"strokeCount":"1"}),
        json!({"blur":null}),
        json!({"recoveryTicks":0}),
    ];
    let mut partial = stroke();
    partial.as_object_mut().unwrap().remove("stroke0ToY");
    invalid.push(partial);
    let mut endpoint = stroke();
    endpoint["stroke0TimeTicks"] = json!(9007199254740991_u64);
    invalid.push(endpoint);
    for params in invalid {
        for attached in [false, true] {
            for enabled in [false, true] {
                for neutral in [false, true] {
                    let mut input = params.clone();
                    if neutral {
                        input["amount"] = json!(0);
                    }
                    let result = issues(input.clone(), attached, enabled);
                    assert!(
                        !result.as_array().unwrap().is_empty(),
                        "unchecked {input}: {attached}/{enabled}"
                    );
                    assert!(
                        result
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|issue| issue["message"].as_str().unwrap().contains("Frost")),
                        "native admission absent: {result}"
                    );
                }
            }
        }
    }
}
