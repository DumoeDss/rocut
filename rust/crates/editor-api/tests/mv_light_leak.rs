use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn effect(alpha: &str) -> Value {
    json!({"kind":"lightLeak","amount":0.8,"alpha":alpha})
}
fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":160,"height":96,
        "frameRate":{"numerator":30000,"denominator":1001},"durationFrames":300,"seed":3,
        "recipe":{"version":1,"root":"solid","songStartSeconds":12.25,"outputRoles":["foreground"],
            "nodes":[{"id":"solid","scene":{"kind":"solid","role":"foreground","color":[0.2,0.3,0.4,0.5]}}],
            "post":[{"stage":"composite","effects":[effect("expand")]}]}})
}
fn resolve(s: &Value, frame: u64) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,
        "clipDuration":1201200,"trimStart":0,"timelineTime":frame*4004})
        .to_string(),
    ))
    .unwrap()
}
fn plan(s: &Value, frame: u64) -> Value {
    resolve(s, frame)["frame"]["recipePlan"]["post"][0]["effects"][0]["lightLeak"].clone()
}
fn valid(s: &Value) -> bool {
    let issues: Vec<Value> = serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":1201200,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap();
    issues.is_empty()
}

#[test]
fn light_leak_rejects_unsafe_parameters_and_requires_explicit_coverage_semantics() {
    let s = source();
    assert!(valid(&s));
    for (field, value) in [
        ("amount", json!(-0.1)),
        ("amount", json!(1.1)),
        ("amount", Value::Null),
        ("speed", json!(-0.1)),
        ("speed", json!(8.1)),
        ("speed", Value::Null),
        ("seedOffset", json!(-1)),
        ("seedOffset", json!(4294967296u64)),
        ("seedOffset", json!(1.5)),
        ("alpha", json!("auto")),
        ("alpha", Value::Null),
        ("extra", json!(1)),
    ] {
        let mut bad = s.clone();
        bad["recipe"]["post"][0]["effects"][0][field] = value;
        assert!(!valid(&bad), "accepted {field}");
        assert!(resolve(&bad, 0)["error"].is_string());
    }
    let mut missing = s.clone();
    missing["recipe"]["post"][0]["effects"][0]
        .as_object_mut()
        .unwrap()
        .remove("alpha");
    assert!(!valid(&missing));
    let mut explicit = s;
    explicit["recipe"]["post"][0]["effects"][0]["speed"] = json!(1);
    explicit["recipe"]["post"][0]["effects"][0]["seedOffset"] = json!(0);
    assert_eq!(plan(&explicit, 123), plan(&source(), 123));
}

#[test]
fn geometry_is_dynamic_seeded_and_uses_outer_trimmed_rational_source_clock() {
    let s = source();
    let a = plan(&s, 123);
    assert_eq!(a["seed"], 3);
    assert_eq!(a["seconds"], (1470000.0 + 123.0 * 4004.0) / 120000.0);
    assert_eq!(a["gradients"].as_array().unwrap().len(), 2);
    assert_eq!(a["gradients"][0]["stops"][0]["color"][0], 255.0);
    // Captured by executing original meta.js/util.js (extracted SHA-256
    // 5da6977f1d57b45569e81e7b0b5f6ae36b3d22fac90ed99a2d3e3b0411fdfec2),
    // not by this Rust implementation or its browser raster adapter.
    for (value, expected) in [
        (&a["gradients"][0]["center"][0], 160.40266313752204),
        (&a["gradients"][0]["center"][1], 37.58298717844276),
        (&a["gradients"][0]["radius"], 119.47706266010216),
        (
            &a["gradients"][0]["stops"][0]["color"][3],
            0.3616106375442441,
        ),
        (&a["gradients"][1]["center"][0], 22.420396536887075),
        (&a["gradients"][1]["center"][1], 84.27425840995734),
        (
            &a["gradients"][1]["stops"][0]["color"][3],
            0.19724216593322402,
        ),
    ] {
        assert!((value.as_f64().unwrap() - expected).abs() < 1e-10);
    }
    assert_ne!(a["gradients"], plan(&s, 2)["gradients"]);
    for frame in [123, 2, 71, 0, 123] {
        assert_eq!(
            plan(&s, frame),
            plan(&serde_json::from_str(&s.to_string()).unwrap(), frame)
        );
    }
    let mut changed = s.clone();
    changed["seed"] = json!(4);
    assert_ne!(a["gradients"], plan(&changed, 123)["gradients"]);
    changed["seed"] = json!(u32::MAX);
    changed["recipe"]["post"][0]["effects"][0]["seedOffset"] = json!(4);
    assert_eq!(a, plan(&changed, 123));
    let mut held = s.clone();
    held["recipe"]["root"] = json!("hold");
    held["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"hold","scene":{"kind":"ref","input":"solid","timeMap":[{"atFrame":0,"sourceFrame":1}]}}));
    assert_eq!(a, plan(&held, 123));
    let trimmed: Value = serde_json::from_str(&resolve_programmatic_frame_json(json!({
        "source":held,"clipStart":120000,"clipDuration":200*4004,"trimStart":100*4004,"timelineTime":120000+23*4004
    }).to_string())).unwrap();
    assert_eq!(
        a,
        trimmed["frame"]["recipePlan"]["post"][0]["effects"][0]["lightLeak"]
    );
    changed["recipe"]["post"][0]["effects"][0]["speed"] = json!(0);
    assert_eq!(plan(&changed, 0), plan(&changed, 299));
}

#[test]
fn amount_curves_change_resolved_gradient_alpha_not_geometry() {
    let mut s = source();
    s["recipe"]["post"][0]["effects"][0]["speed"] = json!(0);
    s["recipe"]["post"][0]["automation"] = json!([{"effect":0,"keyframes":[
        {"frame":0,"value":0,"easing":"linear"},{"frame":100,"value":1,"easing":"linear"}]}]);
    assert!(valid(&s));
    let zero = plan(&s, 0);
    let middle = plan(&s, 50);
    let full = plan(&s, 100);
    assert_eq!(zero["gradients"][0]["stops"][0]["color"][3], 0.0);
    assert_eq!(
        middle["gradients"][0]["center"],
        full["gradients"][0]["center"]
    );
    for index in 0..2 {
        let m = middle["gradients"][index]["stops"][0]["color"][3]
            .as_f64()
            .unwrap();
        let f = full["gradients"][index]["stops"][0]["color"][3]
            .as_f64()
            .unwrap();
        assert!((m * 2.0 - f).abs() < 1e-12);
    }
}

#[test]
fn reusable_scratch_and_pass_costs_do_not_bypass_existing_raster_caps() {
    let mut s = source();
    s["width"] = json!(3200);
    s["height"] = json!(3200);
    s["recipe"]["post"] = json!([]);
    assert!(valid(&s));
    s["recipe"]["post"] = json!([{"stage":"composite","effects":[effect("expand")]}]);
    assert!(!valid(&s)); // Additional screen working surface must count.
    s["width"] = json!(3000);
    s["height"] = json!(3000);
    assert!(valid(&s));
    s["recipe"]["post"][0]["effects"][0] = effect("preserve");
    assert!(!valid(&s));
    s["width"] = json!(2800);
    s["height"] = json!(2800);
    s["recipe"]["post"][0]["effects"] = json!(vec![effect("preserve"); 8]);
    assert!(valid(&s)); // Sequential effects reuse the peak, not 8 x allocations.
    s["width"] = json!(160);
    s["height"] = json!(96);
    s["recipe"]["post"] = json!([
        {"stage":"role","roles":["background","subject","graphics","foreground"],"effects":vec![effect("preserve");8]},
        {"stage":"composite","effects":vec![effect("preserve");8]}
    ]);
    assert!(valid(&s)); // 96 + 24 = 120 passes.
    s["recipe"]["post"]
        .as_array_mut()
        .unwrap()
        .push(json!({"stage":"composite","effects":vec![effect("preserve");3]}));
    assert!(!valid(&s)); // 129 > 128, unchanged cap.
}
