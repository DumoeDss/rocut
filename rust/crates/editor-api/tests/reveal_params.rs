use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(kind: &str, layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog.iter().find(|d| d["id"] == kind).unwrap()["fields"]
        .as_array()
        .unwrap();
    let definitions: Vec<_> = fields
        .iter()
        .map(|field| {
            let mut p = field.clone();
            p["type"] = json!("number");
            p
        })
        .collect();
    let params: serde_json::Map<String, Value> = fields
        .iter()
        .map(|f| (f["key"].as_str().unwrap().into(), f["default"].clone()))
        .collect();
    let editing = if layer {
        json!({"type":"effect","effectType":kind,"params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"reveal","type":kind,"enabled":true,"params":params}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{kind:definitions}}})
}

fn issues(r: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(r.to_string())).unwrap()
}

#[test]
fn discrete_reveal_controls_reject_fractional_authoring_on_clips_and_layers() {
    for (kind, key) in [("laser", "direction"), ("decrypt-reveal", "seed")] {
        for layer in [false, true] {
            let mut r = request(kind, layer);
            assert!(issues(&r).is_empty(), "{:?}", issues(&r));
            let params = if layer {
                &mut r["editing"]["params"]
            } else {
                &mut r["editing"]["effects"][0]["params"]
            };
            params[key] = json!(1.5);
            assert!(
                issues(&r)
                    .iter()
                    .any(|issue| issue["path"].as_str().unwrap().ends_with(key)),
                "{kind}"
            );
        }
    }
}

#[test]
fn progress_is_keyframable_but_discrete_controls_are_not() {
    for (kind, discrete) in [("laser", "direction"), ("decrypt-reveal", "seed")] {
        let mut r = request(kind, false);
        for (key, valid) in [("progress", true), (discrete, false)] {
            r["editing"]["animations"] = json!({format!("effects.reveal.params.{key}"):{"keys":[{
                "id":"k0","time":0,"value":0,"segmentToNext":"linear","tangentMode":"auto"
            }]}});
            assert_eq!(
                issues(&r).is_empty(),
                valid,
                "{kind}/{key}: {:?}",
                issues(&r)
            );
        }
    }
}

#[test]
fn continuous_reveal_geometry_is_not_rounded_in_authoring() {
    for (kind, key, value) in [
        ("laser", "width", 0.0255),
        ("decrypt-reveal", "cellSize", 12.5),
    ] {
        let mut r = request(kind, false);
        r["editing"]["effects"][0]["params"][key] = json!(value);
        assert!(issues(&r).is_empty(), "{kind}/{key}: {:?}", issues(&r));
        for invalid in [json!(-100), json!(100000), Value::Null, json!("0.5")] {
            r["editing"]["effects"][0]["params"][key] = invalid;
            assert!(!issues(&r).is_empty(), "{kind}/{key}");
        }
    }
}
