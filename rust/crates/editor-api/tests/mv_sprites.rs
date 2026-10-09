use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};
#[path = "support/image_facts.rs"]
mod image_facts;

fn source() -> Value {
    let pose = json!({"x":0.5,"y":0.5,"height":0.5,"rotation":0,"opacity":1});
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "resources":[{"id":"cutout.png","kind":"image","mimeType":"image/png","byteLength":1,
            "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}],
        "recipe":{"version":1,"root":"a","songStartSeconds":0,"outputRoles":["foreground"],
            "nodes":[{"id":"a","scene":{"kind":"illust","motion":{"startFrame":0,"durationFrames":24},
                "easing":"linear","sprites":[{"image":"cutout.png","role":"foreground",
                    "from":pose,"to":pose,"anchor":[0.5,0.5]}]}}]}})
}
fn sprite(s: &mut Value) -> &mut Value {
    &mut s["recipe"]["nodes"][0]["scene"]["sprites"][0]
}
fn resolve(s: &Value, frame: u64) -> Value {
    image_facts::resolve_with_image_facts(json!({"source":s,
        "clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":frame*5000}))
}
fn plan(s: &Value, frame: u64) -> Value {
    resolve(s, frame)["frame"]["recipePlan"]["root"]["sprites"][0].clone()
}
fn valid(s: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}
fn reject(s: &Value) {
    assert!(!valid(s));
    assert!(resolve(s, 0)["error"].is_string());
}
fn near(v: &Value, expected: f64) {
    assert!(
        (v.as_f64().unwrap() - expected).abs() < 1e-10,
        "{v} != {expected}"
    );
}
fn entrance(start: u32) -> Value {
    json!({"span":{"startFrame":start,"durationFrames":4},"easing":"linear",
        "offset":[-0.25,0.125],"scale":0.5,"rotation":0.4,"opacity":0})
}
fn wave() -> Value {
    json!({"amplitude":0.25,"from":0,"cycles":0,"frequency":1,"phase":std::f64::consts::FRAC_PI_2,"strips":4})
}
#[test]
fn entry_and_exit_have_exact_endpoints_and_compose_with_base_pose() {
    let mut s = source();
    sprite(&mut s)["enter"] = entrance(0);
    sprite(&mut s)["exit"] = entrance(16);
    assert!(valid(&s));
    for (f, x, y, height, rotation, opacity) in [
        (0, 0.25, 0.625, 0.25, 0.4, 0.0),
        (2, 0.375, 0.5625, 0.375, 0.2, 0.5),
        (4, 0.5, 0.5, 0.5, 0.0, 1.0),
        (16, 0.5, 0.5, 0.5, 0.0, 1.0),
        (18, 0.375, 0.5625, 0.375, 0.2, 0.5),
        (20, 0.25, 0.625, 0.25, 0.4, 0.0),
    ] {
        let p = plan(&s, f);
        for (key, expected) in [
            ("x", x),
            ("y", y),
            ("height", height),
            ("rotation", rotation),
            ("opacity", opacity),
        ] {
            near(&p["pose"][key], expected);
        }
    }
    sprite(&mut s)["drawingFps"] = json!(12);
    assert_eq!(plan(&s, 0), plan(&s, 1));
    assert_eq!(plan(&s, 2), plan(&s, 3));
}
#[test]
fn wave_is_a_sampled_local_space_plan_with_song_and_reference_clocks() {
    let mut s = source();
    sprite(&mut s)["wave"] = wave();
    assert!(valid(&s));
    let p = plan(&s, 0);
    for (i, expected) in [0.0, 0.015625, 0.0625, 0.140625].into_iter().enumerate() {
        near(&p["slices"][i]["offset"], expected);
        near(&p["slices"][i]["start"], i as f64 / 4.0);
        near(&p["slices"][i]["end"], (i + 1) as f64 / 4.0);
        near(&plan(&s, 6)["slices"][i]["offset"], 0.0);
    }
    let before = plan(&s, 8);
    assert_ne!(before, p);
    assert_eq!(plan(&s, 0), p);
    s["recipe"]["songStartSeconds"] = json!(0.25);
    near(&plan(&s, 0)["slices"][3]["offset"], 0.0);
    let held = plan(&s, 8);
    s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"freeze","scene":{"kind":"ref","input":"a","timeMap":[{"atFrame":0,"sourceFrame":8}]}}));
    s["recipe"]["root"] = json!("freeze");
    assert_eq!(
        resolve(&s, 20)["frame"]["recipePlan"]["root"]["input"]["sprites"][0],
        held
    );
}
#[test]
fn style_validation_applies_before_both_persistence_and_rendering() {
    for (key, value) in [
        ("enter", entrance(22)),
        ("exit", entrance(24)),
        (
            "shadow",
            json!({"color":[0,0,0,1],"offset":[0,0],"blur":0.1}),
        ),
        ("rim", json!({"color":[1,1,1,2],"offset":[0,0],"blur":0})),
        ("silhouette", json!([1, 0, 0])),
        ("glow", json!({"color":[1,1,1,1],"offset":[0,0],"radius":0})),
    ] {
        let mut s = source();
        sprite(&mut s)[key] = value;
        reject(&s);
    }
    for (key, value) in [
        ("strips", json!(129)),
        ("strips", json!(0)),
        ("amplitude", json!(0.3)),
        ("from", json!(1)),
        ("frequency", json!(-1)),
        ("cycles", json!(17)),
        ("typo", json!(1)),
    ] {
        let mut s = source();
        let mut w = wave();
        w[key] = value;
        sprite(&mut s)["wave"] = w;
        reject(&s);
    }
    let mut s = source();
    sprite(&mut s)["enter"] = entrance(4);
    sprite(&mut s)["exit"] = entrance(6);
    reject(&s);
    sprite(&mut s)["exit"] = entrance(8);
    assert!(valid(&s));
    sprite(&mut s)["enter"]["scale"] = json!(0);
    reject(&s);
}
#[test]
fn strips_underlays_and_scratch_are_included_in_existing_budgets() {
    let mut s = source();
    sprite(&mut s)["wave"] = wave();
    sprite(&mut s)["wave"]["strips"] = json!(128);
    let tint = json!({"color":[1,1,1,1],"offset":[0,0],"blur":0});
    sprite(&mut s)["rim"] = tint.clone();
    reject(&s); // 256 draws plus tint/group overhead
    sprite(&mut s)["wave"]["strips"] = json!(32);
    sprite(&mut s)["shadow"] = tint;
    assert!(valid(&s));
    s["width"] = json!(2800);
    s["height"] = json!(2800);
    reject(&s);
    sprite(&mut s).as_object_mut().unwrap().remove("rim");
    sprite(&mut s).as_object_mut().unwrap().remove("shadow");
    sprite(&mut s).as_object_mut().unwrap().remove("wave");
    assert!(valid(&s));
}
