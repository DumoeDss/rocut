use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};
#[path = "support/image_facts.rs"]
mod image_facts;

fn recipe() -> Value {
    json!({"version":1,"root":"mix","songStartSeconds":12.25,
        "outputRoles":["foreground","background","subject"],
        "nodes":[
            {"id":"a","scene":{"kind":"solid","role":"background","color":[1,0,0,1]}},
            {"id":"b","scene":{"kind":"solid","role":"foreground","color":[0,0,1,0.5]}},
            {"id":"mix","scene":{"kind":"transition","from":"a","to":"b",
                "span":{"startFrame":4,"durationFrames":8},"easing":"linear","style":{"kind":"xfade"}}}
        ],"post":[{"roles":["background"],"effects":[{"kind":"grain","amount":0.1,"fps":12}]}]})
}
fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":32,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":3,"recipe":recipe()})
}
fn resolve(s: &Value, i: u64) -> Value {
    image_facts::resolve_with_image_facts(json!({
        "source":s,"clipStart":120000,"clipDuration":120000,"trimStart":0,"timelineTime":120000+i*5000
    }))
}
fn valid(s: &Value) -> bool {
    let r = json!({"editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}});
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(r.to_string()))
        .unwrap()
        .is_empty()
}
fn reject(s: &Value) {
    assert!(!valid(s), "invalid source persisted: {s}");
    assert!(
        resolve(s, 0)["error"].is_string(),
        "invalid source rendered: {s}"
    );
}
#[test]
fn transition_handles_half_open_endpoints_and_song_clock_are_shared() {
    let s = source();
    assert!(valid(&s));
    assert_eq!(
        resolve(&s, 4)["frame"]["recipePlan"]["root"]["color"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
    assert_eq!(
        resolve(&s, 12)["frame"]["recipePlan"]["root"]["color"],
        json!([0.0, 0.0, 1.0, 0.5])
    );
    let f = resolve(&s, 8);
    assert_eq!(f["frame"]["recipePlan"]["root"]["progress"], 0.5);
    assert_eq!(
        f["frame"]["recipePlan"]["outputRoles"],
        json!(["background", "subject", "foreground"])
    );
    assert!(
        (f["frame"]["recipePlan"]["songSeconds"].as_f64().unwrap() - (12.25 + 8.0 / 24.0)).abs()
            < 1e-10
    );
    assert!(resolve(&s, 24)["frame"].is_null());
    for i in [11, 0, 8, 4, 12, 8] {
        assert_eq!(resolve(&s, i), resolve(&s, i));
    }
}
#[test]
fn recipe_is_exclusive_and_unknown_fields_are_not_silently_ignored() {
    for (key, value) in [
        ("code", json!("throw Error('must not run')")),
        ("runtime", json!("html-document")),
        ("recipe", Value::Null),
        ("documentId", json!("other.html")),
        ("width", json!(u32::MAX)),
    ] {
        let mut s = source();
        s[key] = value;
        reject(&s);
    }
    for (key, value) in [
        ("version", json!(2)),
        ("songStartSeconds", json!(-1)),
        ("root", json!("missing")),
        ("outputRoles", json!(["lyrics"])),
        ("outputRoles", json!(["background", "background"])),
        ("arbitrary", json!("code")),
    ] {
        let mut s = source();
        s["recipe"][key] = value;
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][0]["scene"]["typo"] = json!(1);
    reject(&s);
}
#[test]
fn cycles_missing_inputs_duplicate_nodes_and_expansion_are_rejected() {
    for name in ["mix", "missing"] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"]["from"] = json!(name);
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][1]["id"] = json!("a");
    reject(&s);
    let mut s = source();
    s["recipe"]["root"] = json!("a");
    s["recipe"]["nodes"][2]["scene"]["to"] = json!("mix");
    reject(&s); // unused cycles too
    let mut s = source();
    let mut nodes = vec![s["recipe"]["nodes"][0].clone()];
    let mut last = "a".to_string();
    for i in 0..7 {
        let id = format!("n{i}");
        nodes.push(json!({"id":id,"scene":{"kind":"transition","from":last,"to":last,
            "span":{"startFrame":0,"durationFrames":24},"easing":"linear","style":{"kind":"xfade"}}}));
        last = id;
    }
    s["recipe"]["nodes"] = json!(nodes);
    s["recipe"]["root"] = json!(last);
    reject(&s);
    let mut s = source();
    s["width"] = json!(4096);
    s["height"] = json!(4096);
    reject(&s);
}
#[test]
fn post_and_transition_policy_reject_invalid_or_unimplemented_features() {
    for effect in [
        json!({"kind":"grain","amount":2,"fps":12}),
        json!({"kind":"grain","amount":0.2,"fps":0}),
        json!({"kind":"palette","colors":[[0,0,0,1]],"mix":1}),
        json!({"kind":"bloom","amount":1}),
    ] {
        let mut s = source();
        s["recipe"]["post"][0]["effects"] = json!([effect]);
        reject(&s);
    }
    for style in [
        json!({"kind":"wipe","angle":4}),
        json!({"kind":"iris","center":[-1,0]}),
        json!({"kind":"shatter"}),
    ] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"]["style"] = style;
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"]["span"]["durationFrames"] = json!(21);
    reject(&s);
}
fn illust_source() -> Value {
    let mut s = source();
    s["resources"] = json!([{"id":"image.png","kind":"image","mimeType":"image/png","byteLength":100,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}]);
    let pose = json!({"x":0,"y":1,"height":0.5,"rotation":0,"opacity":1});
    let mut to = pose.clone();
    to["x"] = json!(1);
    s["recipe"]["nodes"] = json!([{"id":"illust","scene":{"kind":"illust",
        "motion":{"startFrame":0,"durationFrames":24},"easing":"linear",
        "background":{"image":"image.png","from":{"x":0,"y":0,"zoom":1},"to":{"x":1,"y":0,"zoom":2}},
        "sprites":[{"image":"image.png","role":"foreground","from":pose,"to":to,"anchor":[0.5,1],"drawingFps":12}]}}]);
    s["recipe"]["root"] = json!("illust");
    s
}
#[test]
fn drawing_quantization_does_not_quantize_camera_and_resources_are_required() {
    let s = illust_source();
    assert!(valid(&s));
    let a = resolve(&s, 0);
    let b = resolve(&s, 1);
    let c = resolve(&s, 2);
    assert_eq!(
        a["frame"]["recipePlan"]["root"]["sprites"],
        b["frame"]["recipePlan"]["root"]["sprites"]
    );
    assert_ne!(
        a["frame"]["recipePlan"]["root"]["background"],
        b["frame"]["recipePlan"]["root"]["background"]
    );
    let x = c["frame"]["recipePlan"]["root"]["sprites"][0]["pose"]["x"]
        .as_f64()
        .unwrap();
    assert!((x - 1.0 / 12.0).abs() < 1e-10);
    assert_eq!(
        a["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"],
        b["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"]
    );
    let mut missing = s.clone();
    missing["resources"] = json!([]);
    reject(&missing);
    let mut invalid = s;
    invalid["recipe"]["nodes"][0]["scene"]["sprites"][0]["drawingFps"] = json!(0);
    reject(&invalid);
}

#[test]
fn independent_clocks_use_integer_ticks_at_long_and_fractional_boundaries() {
    let mut s = illust_source();
    s["durationFrames"] = json!(1000);
    s["frameRate"] = json!({"numerator":60,"denominator":1});
    s["recipe"]["songStartSeconds"] = json!(0);
    s["recipe"]["nodes"][0]["scene"]["motion"]["durationFrames"] = json!(1000);
    s["recipe"]["nodes"][0]["scene"]["sprites"][0]["drawingFps"] = json!(30);
    s["recipe"]["post"][0]["effects"][0]["fps"] = json!(30);
    for (start, index, expected_sample) in [
        (0.0, 246, 123),
        (0.0, 490, 245),
        (0.3, 246, 132),
        (12.250004, 490, 612),
    ] {
        s["recipe"]["songStartSeconds"] = json!(start);
        let r = image_facts::resolve_with_image_facts(json!({"source":s,
            "clipStart":0,"clipDuration":2000000,"trimStart":0,"timelineTime":index*2000}));
        assert_eq!(
            r["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"],
            3 + expected_sample
        );
        if start == 0.0 || start == 0.3 {
            let x = r["frame"]["recipePlan"]["root"]["sprites"][0]["pose"]["x"]
                .as_f64()
                .unwrap();
            assert!((x - index as f64 / 1000.0).abs() < 1e-10);
        }
    }
}
