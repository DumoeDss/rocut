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
        .filter(|f| f["required"] != false)
        .map(|f| (f["key"].as_str().unwrap().into(), f["default"].clone()))
        .collect();
    let editing = if layer {
        json!({"type":"effect","effectType":kind,"params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"wave","type":kind,"enabled":true,"params":params}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{kind:definitions}}})
}

fn params(r: &mut Value, layer: bool) -> &mut Value {
    if layer {
        &mut r["editing"]["params"]
    } else {
        &mut r["editing"]["effects"][0]["params"]
    }
}

fn issues(r: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(r.to_string())).unwrap()
}

#[test]
fn active_slots_require_all_four_authored_fields_on_clips_and_layers() {
    for kind in ["ripple", "force-field"] {
        for layer in [false, true] {
            let mut r = request(kind, layer);
            assert!(issues(&r).is_empty(), "{:?}", issues(&r));
            params(&mut r, layer)["eventCount"] = json!(1);
            for (key, value) in [
                ("event0Time", 0.0),
                ("event0X", 0.3),
                ("event0Y", 0.7),
                ("event0Amplitude", 0.8),
            ] {
                assert!(
                    !issues(&r).is_empty(),
                    "accepted incomplete {kind} schedule"
                );
                params(&mut r, layer)[key] = json!(value);
            }
            assert!(issues(&r).is_empty(), "{:?}", issues(&r));
            for (key, value) in [
                ("eventCount", json!(1.5)),
                ("eventCount", json!(17)),
                ("event0Time", json!(0.5)),
                ("event0Time", json!(-1)),
                ("event0Time", json!(9007199254740992u64)),
                ("event0X", json!(3)),
                ("event0Y", json!("0.5")),
                ("event0Amplitude", Value::Null),
                ("event16Time", json!(0)),
            ] {
                let mut invalid = r.clone();
                params(&mut invalid, layer)[key] = value;
                assert!(!issues(&invalid).is_empty(), "accepted {kind} {key}");
            }
        }
    }
}

#[test]
fn event_slots_cannot_be_keyframed_but_global_controls_can() {
    let mut r = request("ripple", false);
    params(&mut r, false)["event0Time"] = json!(0);
    for (key, value, valid) in [
        ("event0Time", 4000, false),
        ("eventCount", 1, false),
        ("amount", 0, true),
    ] {
        r["editing"]["animations"] = json!({format!("effects.wave.params.{key}"):{"keys":[{
            "id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"
        }]}});
        assert_eq!(issues(&r).is_empty(), valid, "{key}: {:?}", issues(&r));
    }
}

#[test]
fn displacement_seed_requires_an_integer_without_rounding_author_input() {
    for layer in [false, true] {
        let mut r = request("displacement", layer);
        assert!(issues(&r).is_empty());
        params(&mut r, layer)["seed"] = json!(1.5);
        assert!(
            issues(&r)
                .iter()
                .any(|i| i["path"].as_str().unwrap().ends_with("seed"))
        );
    }
}
