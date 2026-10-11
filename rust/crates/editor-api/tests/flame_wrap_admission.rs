use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(attached: bool, enabled: bool, forged_catalog: bool) -> Value {
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == "flame-wrap")
        .unwrap()["fields"]
        .as_array()
        .unwrap();
    let params: serde_json::Map<String, Value> = fields
        .iter()
        .map(|field| {
            (
                field["key"].as_str().unwrap().into(),
                field["default"].clone(),
            )
        })
        .collect();
    let definitions: Vec<Value> = fields
        .iter()
        .map(|field| {
            let mut field = field.clone();
            field["type"] = json!("number");
            if forged_catalog {
                field["min"] = json!(-1e20);
                field["max"] = json!(1e20);
                field["step"] = json!(0.0001);
                field["required"] = json!(false);
                field["keyframable"] = json!(true);
            }
            field
        })
        .collect();
    let editing = if attached {
        json!({"type":"text","params":{},"effects":[{"id":"fire","type":"flame-wrap","enabled":enabled,"params":params}]})
    } else {
        // Standalone visibility belongs to the track, outside this editing API.
        json!({"type":"effect","effectType":"flame-wrap","params":params})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if attached {"text"} else {"effect"},"hasMotionText":false,"hasAdjustment":false,"catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"flame-wrap":definitions}}})
}

fn params(input: &mut Value, attached: bool) -> &mut Value {
    if attached {
        &mut input["editing"]["effects"][0]["params"]
    } else {
        &mut input["editing"]["params"]
    }
}

fn issues(input: &Value) -> Vec<Value> {
    let frozen = input.to_string();
    let result = serde_json::from_str(&validate_clip_editing_json(frozen.clone())).unwrap();
    assert_eq!(input.to_string(), frozen, "validation altered caller input");
    result
}

#[test]
fn integer_seed_endpoints_are_admitted_for_attached_and_standalone_effect_layers() {
    for attached in [false, true] {
        for enabled in [false, true] {
            for forged in [false, true] {
                for seed in [0, 65535] {
                    let mut input = request(attached, enabled, forged);
                    params(&mut input, attached)["seed"] = json!(seed);
                    assert!(
                        issues(&input).is_empty(),
                        "rejected {attached}/{enabled}/{forged} seed={seed}: {:?}",
                        issues(&input)
                    );
                }
            }
        }
    }
}

#[test]
fn fractional_and_nonfinite_seed_are_rejected_even_when_disabled_neutral_or_catalog_is_forged() {
    for attached in [false, true] {
        for enabled in [false, true] {
            for forged in [false, true] {
                for neutral in [false, true] {
                    let mut input = request(attached, enabled, forged);
                    params(&mut input, attached)["seed"] = json!(0.5);
                    if neutral {
                        params(&mut input, attached)["amount"] = json!(0);
                    }
                    let result = issues(&input);
                    assert!(
                        result.iter().any(|issue| issue["path"]
                            .as_str()
                            .is_some_and(|path| path.ends_with(".seed"))
                            && issue["message"]
                                .as_str()
                                .is_some_and(|message| message.contains("integer"))),
                        "integer admission absent {attached}/{enabled}/{forged}/{neutral}: {result:?}"
                    );
                    // JSON cannot represent IEEE NaN/Infinity. Exercise real adapter
                    // schema rejection for overflow numeric literals, not json!(NaN)
                    // (which silently becomes null).
                    params(&mut input, attached)["seed"] = json!("nonfinite-marker");
                    for literal in ["1e999", "-1e999", "null", "\"NaN\"", "\"Infinity\""] {
                        let raw = input.to_string().replace("\"nonfinite-marker\"", literal);
                        let rejected: Vec<Value> =
                            serde_json::from_str(&validate_clip_editing_json(raw.clone())).unwrap();
                        assert!(
                            !rejected.is_empty(),
                            "nonfinite wire value admitted {literal}: {raw}"
                        );
                    }
                    params(&mut input, attached)["seed"] = json!(41);
                    assert!(
                        issues(&input).is_empty(),
                        "rejection contaminated a later valid request"
                    );
                }
            }
        }
    }
}

#[test]
fn seed_and_speed_remain_static_under_both_animation_paths_and_forged_flags() {
    for attached in [false, true] {
        for enabled in [false, true] {
            for (key, value) in [("seed", 1.0), ("speed", 0.5)] {
                let mut input = request(attached, enabled, true);
                let property = if attached {
                    format!("effects.fire.params.{key}")
                } else {
                    format!("params.{key}")
                };
                input["editing"]["animations"] = json!({property:{"keys":[{"id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"}]}});
                let result = issues(&input);
                assert!(
                    result.iter().any(|issue| issue["message"]
                        .as_str()
                        .is_some_and(|message| message.contains("keyframable"))),
                    "static field animated {attached}/{enabled}/{key}: {result:?}"
                );
            }
            let mut optical = request(attached, enabled, true);
            let property = if attached {
                "effects.fire.params.amount"
            } else {
                "params.amount"
            };
            optical["editing"]["animations"] = json!({property:{"keys":[{"id":"k0","time":0,"value":0.5,"segmentToNext":"linear","tangentMode":"auto"}]}});
            assert!(
                issues(&optical).is_empty(),
                "valid optical animation rejected: {:?}",
                issues(&optical)
            );
        }
    }
}
