use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn source(kind: &str) -> Value {
    let hash = "a".repeat(64);
    let scene = if kind == "glyphRain" {
        json!({"kind":kind,"role":"foreground","settings":{"font":"font.ttf","glyphs":"01ABC+-",
            "columns":12,"rows":16,"trail":8,"speed":7,"drawingFps":12,
            "color":[0,1,0.4,0.6],"headColor":[1,1,1,1],"opacity":0.8}})
    } else {
        json!({"kind":kind,"role":"subject","span":{"startFrame":4,"durationFrames":12},"easing":"linear",
            "settings":{"image":"image.png","columns":8,"rows":6,"rect":[0,0,1,1],"fit":"contain",
            "scatter":0.8,"stagger":0.4,"spin":1,"startScale":0.1,"opacity":0.75,"direction":"in"}})
    };
    json!({"version":1,"runtime":"canvas-worker","code":"","width":320,"height":180,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":27,
        "resources":[
            {"id":"font.ttf","kind":"font","mimeType":"font/ttf","byteLength":1,"sha256":hash,
                "attachmentKey":format!("programmatic-sha256-{hash}"),"font":{"family":"GeneratorFixture","weight":500,"style":"normal"}},
            {"id":"image.png","kind":"image","mimeType":"image/png","byteLength":1,"sha256":hash,
                "attachmentKey":format!("programmatic-sha256-{hash}")}
        ],"recipe":{"version":1,"root":"g","songStartSeconds":0,"outputRoles":["foreground","subject"],
            "nodes":[{"id":"g","scene":scene}]}})
}
fn resolve(s: &Value, index: u64) -> Value {
    let step = 120000 * s["frameRate"]["denominator"].as_u64().unwrap()
        / s["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":12000,
        "clipDuration":30*step,"trimStart":0,"timelineTime":12000+index*step})
        .to_string(),
    ))
    .unwrap()
}
fn root(result: &Value) -> &Value {
    &result["frame"]["recipePlan"]["root"]
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

#[test]
fn glyph_rain_is_quantized_seeded_and_reversible_without_state() {
    let mut s = source("glyphRain");
    assert!(valid(&s));
    let initial = resolve(&s, 0);
    assert_eq!(root(&initial), root(&resolve(&s, 1)));
    assert_ne!(root(&initial), root(&resolve(&s, 3)));
    assert_eq!(initial, resolve(&s, 0));
    let data = &root(&initial)["data"];
    assert_eq!(data["font"], "font.ttf");
    assert_eq!(data["fontSize"], 10.125);
    let glyphs = data["glyphs"].as_array().unwrap();
    assert!(!glyphs.is_empty() && glyphs.len() <= 96);
    for glyph in glyphs {
        assert!("01ABC+-".contains(glyph["text"].as_str().unwrap()));
        assert!((0.0..=0.8).contains(&glyph["opacity"].as_f64().unwrap()));
    }
    s["seed"] = json!(28);
    assert_ne!(root(&initial), root(&resolve(&s, 0)));
    s["frameRate"] = json!({"numerator":24000,"denominator":1001});
    assert_eq!(root(&resolve(&s, 0)), root(&resolve(&s, 1)));
    assert_ne!(root(&resolve(&s, 0)), root(&resolve(&s, 2)));
}

#[test]
fn generator_reference_and_song_offset_use_the_existing_clock() {
    let mut s = source("glyphRain");
    s["recipe"]["songStartSeconds"] = json!(0.125);
    assert_eq!(root(&resolve(&s, 0)), root(&resolve(&s, 1)));
    assert_ne!(root(&resolve(&s, 0)), root(&resolve(&s, 2)));
    let direct = resolve(&s, 8);
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"hold","scene":{
        "kind":"ref","input":"g","timeMap":[{"atFrame":0,"sourceFrame":8}]}}));
    s["recipe"]["root"] = json!("hold");
    assert_eq!(root(&resolve(&s, 0))["input"], *root(&direct));
    assert_eq!(root(&resolve(&s, 27))["input"], *root(&direct));
}

#[test]
fn particle_reveal_has_exact_endpoints_and_real_geometric_motion() {
    let mut s = source("particleReveal");
    assert!(valid(&s));
    assert_eq!(root(&resolve(&s, 4))["data"]["particles"], json!([]));
    assert_eq!(root(&resolve(&s, 4))["data"]["fullImage"], false);
    let middle = resolve(&s, 10);
    let particles = root(&middle)["data"]["particles"].as_array().unwrap();
    assert_eq!(particles.len(), 48);
    assert!(
        particles
            .iter()
            .any(|p| p["offset"][0].as_f64().unwrap().abs() > 1.0)
    );
    assert!(
        particles
            .iter()
            .all(|p| p["scale"].as_f64().unwrap() > 0.1 && p["scale"].as_f64().unwrap() < 1.0)
    );
    assert_eq!(root(&resolve(&s, 16))["data"]["fullImage"], true);
    assert_eq!(root(&resolve(&s, 29))["data"]["particles"], json!([]));
    assert_eq!(middle, resolve(&s, 10));
    s["recipe"]["nodes"][0]["scene"]["settings"]["direction"] = json!("out");
    assert_eq!(root(&resolve(&s, 4))["data"]["fullImage"], true);
    assert_eq!(root(&resolve(&s, 16))["data"]["fullImage"], false);
    assert_eq!(root(&resolve(&s, 16))["data"]["particles"], json!([]));
}

#[test]
fn rejects_bad_resources_bounds_enums_and_unknown_fields_at_both_boundaries() {
    for (kind, key, value) in [
        ("glyphRain", "font", json!("image.png")),
        ("glyphRain", "glyphs", json!("a\nb")),
        ("glyphRain", "glyphs", json!("x".repeat(65))),
        ("glyphRain", "columns", json!(129)),
        ("glyphRain", "trail", json!(17)),
        ("glyphRain", "drawingFps", json!(0)),
        ("glyphRain", "speed", json!(-1)),
        ("glyphRain", "opacity", json!(2)),
        ("particleReveal", "image", json!("font.ttf")),
        ("particleReveal", "rows", json!(65)),
        ("particleReveal", "fit", json!("invalid")),
        ("particleReveal", "stagger", json!(1)),
        ("particleReveal", "scatter", json!(3)),
        ("particleReveal", "rect", json!([0, 0, 0, 1])),
        ("particleReveal", "typo", json!(0)),
    ] {
        let mut s = source(kind);
        s["recipe"]["nodes"][0]["scene"]["settings"][key] = value;
        reject(&s);
    }
}

#[test]
fn generator_primitive_budget_counts_expanded_graph_inputs() {
    let mut s = source("particleReveal");
    s["recipe"]["nodes"][0]["scene"]["settings"]["columns"] = json!(64);
    s["recipe"]["nodes"][0]["scene"]["settings"]["rows"] = json!(64);
    assert!(valid(&s));
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"twice","scene":{
        "kind":"transition","from":"g","to":"g","span":{"startFrame":0,"durationFrames":20},
        "easing":"linear","style":{"kind":"xfade"}}}));
    s["recipe"]["root"] = json!("twice");
    reject(&s);
    assert!(resolve(&s, 0)["error"].as_str().unwrap().contains("4096"));
}
