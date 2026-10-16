use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request() -> Value {
    json!({
        "editing": {"type":"text", "params":{"opacity":0.5}},
        "duration":240000, "trackKind":"text", "hasMotionText":false, "hasAdjustment":false,
        "catalog": {
            "elements": {"text":[{"key":"opacity","type":"number","min":0,"max":1}, {"key":"content","type":"text","keyframable":false}]},
            "graphics":{}, "effects":{}, "masks":{}
        }
    })
}
fn issues(value: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(value.to_string())).unwrap()
}

#[test]
fn known_params_and_display_units() {
    let mut r = request();
    assert!(issues(&r).is_empty());
    r["catalog"]["elements"]["text"][0]["min"] = json!(1);
    r["catalog"]["elements"]["text"][0]["max"] = json!(100);
    r["catalog"]["elements"]["text"][0]["displayMultiplier"] = json!(100);
    assert!(issues(&r).is_empty());
    r["editing"]["params"]["opacity"] = json!(2);
    let invalid = issues(&r);
    assert_eq!(invalid[0]["path"], "editing.params.opacity");
    let message = invalid[0]["message"].as_str().unwrap();
    assert!(message.contains("stored units, range [0.01, 1]"));
    assert!(message.contains("stored value * 100"));
    assert!(message.contains("display units [1, 100]"));
}

#[test]
fn mask_centers_report_normalized_storage_units_without_relaxing_validation() {
    let mut r = request();
    r["editing"]["type"] = json!("graphic");
    r["editing"]["definitionId"] = json!("rectangle");
    r["editing"]["params"] = json!({});
    r["trackKind"] = json!("graphic");
    r["catalog"]["graphics"]["rectangle"] = json!([]);
    r["catalog"]["masks"]["rectangle"] = json!({
        "params":[{"key":"centerX","type":"number","min":-100,"max":100,"displayMultiplier":100}],
        "required":["centerX"]
    });
    r["editing"]["masks"] = json!([{"id":"mask", "type":"rectangle", "params":{"centerX":16}}]);
    let invalid = issues(&r);
    assert_eq!(invalid[0]["path"], "editing.masks.mask.params.centerX");
    assert!(
        invalid[0]["message"]
            .as_str()
            .unwrap()
            .contains("stored units, range [-1, 1]")
    );
    r["editing"]["masks"][0]["params"]["centerX"] = json!(0.16);
    assert!(issues(&r).is_empty());
}

#[test]
fn rejects_unknown_fields_and_incompatible_lanes() {
    let mut r = request();
    r["editing"]["params"]["prototype"] = json!(1);
    assert!(!issues(&r).is_empty());
    r = request();
    r["trackKind"] = json!("audio");
    assert!(!issues(&r).is_empty());
    r = request();
    r["editing"]["unvalidated"] = json!({"anything":1});
    assert!(!issues(&r).is_empty());
}

#[test]
fn validates_curves_identity_order_and_animatable_properties() {
    let mut r = request();
    let key = json!({"id":"a","time":0,"value":0.5,"segmentToNext":"bezier","tangentMode":"broken","leftHandle":{"dt":-4000,"dv":0}});
    r["editing"]["animations"] = json!({"opacity":{"keys":[key.clone()]}});
    assert!(issues(&r).is_empty());
    r["editing"]["animations"]["opacity"]["keys"] = json!([key.clone(), key]);
    assert!(!issues(&r).is_empty());
    r["editing"]["animations"] = json!({"content":{"keys":[]}});
    assert!(!issues(&r).is_empty());
}

#[test]
fn rejects_freeform_point_shape_and_missing_mask_defaults() {
    let mut r = request();
    r["editing"]["type"] = json!("graphic");
    r["editing"]["definitionId"] = json!("rectangle");
    r["editing"]["params"] = json!({});
    r["trackKind"] = json!("graphic");
    r["catalog"]["graphics"]["rectangle"] = json!([]);
    r["catalog"]["masks"]["freeform"] = json!({"params":[],"required":["path"]});
    r["editing"]["masks"] = json!([{"id":"mask", "type":"freeform", "params":{"path":[]}}]);
    assert!(issues(&r).is_empty());
    r["editing"]["masks"][0]["params"]["path"] = json!([{"id":"point","x":0}]);
    assert!(!issues(&r).is_empty());
}

#[test]
fn rejects_incomplete_effects_and_unsafe_curve_handles() {
    let mut r = request();
    r["catalog"]["effects"]["blur"] = json!([{"key":"intensity","type":"number","min":0}]);
    r["editing"]["effects"] = json!([{"id":"blur1","type":"blur","enabled":true,"params":{}}]);
    assert!(!issues(&r).is_empty());
    r["editing"]["effects"][0]["params"]["intensity"] = json!(10);
    assert!(issues(&r).is_empty());
    r["editing"]["animations"] = json!({"opacity":{"keys":[{
        "id":"a","time":0,"value":0.5,"segmentToNext":"bezier","tangentMode":"broken",
        "rightHandle":{"dt":9007199254740992i64,"dv":0}
    }]}});
    assert!(!issues(&r).is_empty());
}
