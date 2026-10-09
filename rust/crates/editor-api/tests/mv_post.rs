use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn effects() -> Vec<Value> {
    vec![
        json!({"kind":"lineBoil","amount":2.0,"cellSize":34.0,"fps":30}),
        json!({"kind":"glitch","amount":0.5,"bands":38,"fps":30}),
        json!({"kind":"chromaticAberration","amount":4.0,"center":[0.25,0.75]}),
        json!({"kind":"zoomBlur","amount":0.2,"center":[0.25,0.75]}),
        json!({"kind":"bloom","amount":0.5,"threshold":0.72,"radius":4.0,"alpha":"expand"}),
    ]
}
fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":32,
        "frameRate":{"numerator":60,"denominator":1},"durationFrames":1000,"seed":3,
        "recipe":{"version":1,"root":"solid","songStartSeconds":0.3,"outputRoles":["foreground"],
        "nodes":[{"id":"solid","scene":{"kind":"solid","role":"foreground","color":[1,0,0,0.5]}}],
        "post":[{"roles":["foreground"],"effects":effects()}]}})
}
fn resolve(s: &Value, frame: u64) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,
        "clipStart":0,"clipDuration":2000000,"trimStart":0,"timelineTime":frame*2000})
        .to_string(),
    ))
    .unwrap()
}
fn issues(s: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":2000000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap()
}
#[test]
fn spatial_effects_persist_and_integer_sampling_is_shared_across_roles() {
    let s = source();
    assert!(issues(&s).is_empty());
    let plans = resolve(&s, 246)["frame"]["recipePlan"]["post"][0]["effects"].clone();
    assert_eq!(plans[0]["seed"], 135); // (0.3 + 246/60)*30 + 3
    assert_eq!(plans[1]["seed"], 135);
    assert_eq!(plans[2]["seed"], 3);
    for (i, e) in effects().iter().enumerate() {
        assert_eq!(&plans[i]["effect"], e);
    }
    assert_eq!(
        plans,
        resolve(&s, 247)["frame"]["recipePlan"]["post"][0]["effects"]
    );
    assert_eq!(
        resolve(&s, 248)["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"],
        136
    );
    let mut s = s;
    s["recipe"]["post"][0]["roles"] = json!(["background", "subject", "foreground"]);
    let mut other = s["recipe"]["post"][0].clone();
    other["roles"] = json!(["graphics"]);
    s["recipe"]["post"].as_array_mut().unwrap().push(other);
    let p = resolve(&s, 246);
    assert_eq!(
        p["frame"]["recipePlan"]["post"][0]["effects"],
        p["frame"]["recipePlan"]["post"][1]["effects"]
    );
}
#[test]
fn reject_bad_spatial_parameters_both_at_persistence_and_render() {
    for (index, key, value) in [
        (0, "amount", json!(-1)),
        (0, "cellSize", json!(0)),
        (0, "fps", json!(121)),
        (1, "bands", json!(1)),
        (1, "bands", json!(257)),
        (1, "fps", json!(0)),
        (2, "amount", json!(65)),
        (2, "center", json!([0, -1])),
        (3, "amount", json!(1.01)),
        (3, "center", json!([0, 0, 0])),
        (4, "radius", json!(0)),
        (4, "threshold", json!(-0.1)),
        (4, "alpha", json!("flatten")),
        (4, "typo", json!(1)),
    ] {
        let mut s = source();
        s["recipe"]["post"][0]["effects"][index][key] = value;
        assert!(!issues(&s).is_empty(), "accepted bad {key}: {s}");
        assert!(resolve(&s, 0)["error"].is_string());
    }
}
#[test]
fn bounds_spatial_scratch_and_role_weighted_bloom_work() {
    let mut s = source();
    s["width"] = json!(3840);
    s["height"] = json!(2160);
    assert!(!issues(&s).is_empty()); // Existing raster byte cap, not a silent downscale.
    s["width"] = json!(1920);
    s["height"] = json!(1080);
    assert!(issues(&s).is_empty());
    s["recipe"]["post"][0]["roles"] = json!(["background", "subject", "graphics", "foreground"]);
    s["recipe"]["post"][0]["effects"] = json!(vec![effects()[4].clone(); 3]); // 120
    assert!(issues(&s).is_empty());
    s["recipe"]["post"][0]["effects"]
        .as_array_mut()
        .unwrap()
        .push(effects()[4].clone()); // 160
    assert!(!issues(&s).is_empty());
    assert!(resolve(&s, 0)["error"].is_string());
}
