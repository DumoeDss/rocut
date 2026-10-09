use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":192,"height":108,
    "frameRate":{"numerator":30,"denominator":1},"durationFrames":60,"seed":7,
    "recipe":{"version":1,"root":"mix","songStartSeconds":0,"outputRoles":["foreground"],"nodes":[
        {"id":"a","scene":{"kind":"solid","role":"foreground","color":[1,0,0,0.7]}},
        {"id":"b","scene":{"kind":"solid","role":"foreground","color":[0,0,1,0.4]}},
        {"id":"mix","scene":{"kind":"transition","from":"a","to":"b","span":{"startFrame":6,"durationFrames":30},
            "easing":"linear","style":{"kind":"peel","direction":"left","curl":0.17,"segments":24,"shading":0.6,"perspective":0.5}}}
    ]}})
}
fn frame(s: &Value, index: u64) -> Value {
    let time = (index * 120000 * s["frameRate"]["denominator"].as_u64().unwrap())
        .div_ceil(s["frameRate"]["numerator"].as_u64().unwrap());
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,
        "clipDuration":240000,"trimStart":0,"timelineTime":time})
        .to_string(),
    ))
    .unwrap()
}
fn root(v: &Value) -> &Value {
    &v["frame"]["recipePlan"]["root"]
}
fn valid(s: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}

#[test]
fn peel_keeps_exact_ab_handles_and_bends_real_outgoing_uvs() {
    let s = source();
    assert!(valid(&s));
    for i in [0, 5, 6] {
        assert_eq!(root(&frame(&s, i))["color"], json!([1.0, 0.0, 0.0, 0.7]));
    }
    for i in [36, 37, 59] {
        assert_eq!(root(&frame(&s, i))["color"], json!([0.0, 0.0, 1.0, 0.4]));
    }
    let middle = frame(&s, 21);
    let commands = root(&middle)["commands"].as_array().unwrap();
    assert!(commands.len() <= 50);
    assert_eq!(commands[0]["input"], "to");
    assert!(commands[0]["clip"].is_object()); // B only under the exposed sheet.
    let surfaces: Vec<_> = commands.iter().filter(|o| o["kind"] == "surface").collect();
    assert!(surfaces.len() >= 40);
    let mut front = false;
    let mut back = false;
    for surface in &surfaces {
        assert_eq!(surface["input"], "from");
        assert_eq!(surface["clip"]["points"][0].as_array().unwrap().len(), 3);
        let t: Vec<f64> = surface["transform"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        assert!(t.iter().all(|x| x.is_finite()));
        let determinant = t[0] * t[3] - t[1] * t[2];
        front |= determinant > 0.0;
        back |= determinant < 0.0;
        assert!((0.4..=1.0).contains(&surface["brightness"].as_f64().unwrap()));
    }
    assert!(
        front && back,
        "A must have front and flipped-back texture geometry, not just a mask"
    );
    assert_ne!(
        surfaces.first().unwrap()["transform"],
        surfaces.last().unwrap()["transform"]
    );
}

#[test]
fn peel_is_directional_parameterized_and_history_independent() {
    let original = source();
    let expected = frame(&original, 21);
    for index in [30, 8, 21, 6, 21] {
        let result = frame(&original, index);
        assert!(result["error"].is_null());
    }
    assert_eq!(expected, frame(&original, 21));
    for (field, value) in [
        ("direction", json!("right")),
        ("direction", json!("up")),
        ("direction", json!("down")),
        ("curl", json!(0.3)),
        ("perspective", json!(0.0)),
        ("shading", json!(0.0)),
        ("segments", json!(48)),
    ] {
        let mut changed = source();
        changed["recipe"]["nodes"][2]["scene"]["style"][field] = value;
        assert!(valid(&changed));
        assert_ne!(
            root(&frame(&changed, 21))["commands"],
            root(&expected)["commands"]
        );
    }
    let mut fractional = source();
    fractional["frameRate"] = json!({"numerator":24000,"denominator":1001});
    assert_eq!(
        root(&frame(&fractional, 21))["commands"],
        root(&expected)["commands"]
    );
    let mut reference = source();
    reference["recipe"]["root"] = json!("ref");
    reference["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"ref","scene":{"kind":"ref","input":"mix",
        "timeMap":[{"atFrame":0,"sourceFrame":21}]}}));
    assert_eq!(root(&frame(&reference, 0))["input"], *root(&expected));
}

#[test]
fn peel_bounds_are_checked_before_editing_and_rendering() {
    let mut oversized = source();
    oversized["width"] = json!(3200);
    oversized["height"] = json!(2000);
    assert!(!valid(&oversized));
    assert!(
        frame(&oversized, 21)["error"]
            .as_str()
            .unwrap()
            .contains("surface budget")
    );
    for (field, value) in [
        ("curl", json!(0.0)),
        ("curl", json!(0.41)),
        ("segments", json!(7)),
        ("segments", json!(65)),
        ("shading", json!(1.0)),
        ("perspective", json!(1.0)),
        ("direction", json!("diagonal")),
        ("commands", json!([])),
    ] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"]["style"][field] = value;
        assert!(!valid(&s));
        assert!(frame(&s, 21)["error"].is_string());
    }
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"]["style"]["segments"] = json!(64);
    assert!(valid(&s));
    let mut outer = s["recipe"]["nodes"][2].clone();
    outer["id"] = json!("outer");
    outer["scene"]["from"] = json!("mix");
    s["recipe"]["nodes"].as_array_mut().unwrap().push(outer);
    s["recipe"]["root"] = json!("outer");
    assert!(!valid(&s));
    assert!(frame(&s, 21)["error"].as_str().unwrap().contains("256"));
}
