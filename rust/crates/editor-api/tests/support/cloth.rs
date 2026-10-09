use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[path = "image_facts.rs"]
mod image_facts;

pub fn source() -> Value {
    let hash = "a".repeat(64);
    let resource = json!({"id":"cloth.png","kind":"image","mimeType":"image/png","byteLength":1,
        "sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}")});
    let settings = json!({
        "image":"cloth.png","rect":[0.1,0.2,0.75,0.6],"fit":"contain",
        "columns":12,"rows":8,"pins":"topEdge","gravity":1.5,"wind":[0.3,0,0.8],
        "gust":0.4,"gustFrequency":0.8,"damping":2,"stretchCompliance":0.000001,
        "bendCompliance":0.001,"solverIterations":6,"perspective":0.6,
        "shading":0.45,"opacity":1,"events":[]});
    let scene = json!({"kind":"cloth","role":"subject",
        "span":{"startFrame":4,"durationFrames":48},"settings":settings});
    let recipe = json!({"version":1,"root":"c","songStartSeconds":0,"outputRoles":["subject"],
        "nodes":[{"id":"c","scene":scene}]});
    json!({"version":1,"runtime":"canvas-worker","code":"","width":320,"height":180,
        "frameRate":{"numerator":120,"denominator":1},"durationFrames":60,"seed":27,
        "resources":[resource],"recipe":recipe})
}

pub fn scene(source: &mut Value) -> &mut Value {
    &mut source["recipe"]["nodes"][0]["scene"]
}

pub fn settings(source: &mut Value) -> &mut Value {
    &mut scene(source)["settings"]
}

pub fn neutral(source: &mut Value) {
    settings(source)["gravity"] = json!(0);
    settings(source)["wind"] = json!([0, 0, 0]);
    settings(source)["gust"] = json!(0);
    settings(source)["events"] = json!([]);
}

pub fn step(source: &Value) -> u64 {
    120_000 * source["frameRate"]["denominator"].as_u64().unwrap()
        / source["frameRate"]["numerator"].as_u64().unwrap()
}

pub fn resolve_trim(source: &Value, local_frame: u64, trim: u64) -> Value {
    let step = step(source);
    image_facts::resolve_with_image_facts(json!({"source":source,"clipStart":12000,
            "clipDuration":source["durationFrames"].as_u64().unwrap()*step-trim,
            "trimStart":trim,"timelineTime":12000+local_frame*step}))
}

pub fn resolve(source: &Value, frame: u64) -> Value {
    resolve_trim(source, frame, 0)
}

pub fn root(result: &Value) -> &Value {
    assert!(
        result["error"].is_null(),
        "unexpected resolve error: {result}"
    );
    &result["frame"]["recipePlan"]["root"]
}

pub fn data(result: &Value) -> &Value {
    &root(result)["data"]
}

pub fn issues(source: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":source},
        "duration":source["durationFrames"].as_u64().unwrap()*step(source),
        "trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap()
}

pub fn valid(source: &Value) {
    assert!(
        issues(source).is_empty(),
        "unexpected validation errors: {:?}",
        issues(source)
    );
}

pub fn reject(source: &Value) {
    assert!(
        !issues(source).is_empty(),
        "invalid Cloth accepted: {source}"
    );
    assert!(resolve(source, 0)["error"].is_string());
}

pub fn num(value: &Value) -> f64 {
    value.as_f64().unwrap()
}

pub fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-7, "{actual} != {expected}");
}

/// Source UVs identify material particles independently of face painter order.
/// Position and w are retained, so lighting/opacity cannot masquerade as motion.
pub fn vertices(plan: &Value) -> Vec<[f64; 5]> {
    let mut points = BTreeMap::new();
    for face in plan["faces"].as_array().unwrap() {
        for vertex in face["vertices"].as_array().unwrap() {
            let uv = [num(&vertex["uv"][0]), num(&vertex["uv"][1])];
            let point = [
                uv[0],
                uv[1],
                num(&vertex["position"][0]),
                num(&vertex["position"][1]),
                num(&vertex["w"]),
            ];
            if let Some(previous) = points.insert((uv[0].to_bits(), uv[1].to_bits()), point) {
                assert_eq!(
                    previous, point,
                    "shared Cloth particle has inconsistent geometry"
                );
            }
        }
    }
    points.into_values().collect()
}

pub fn assert_rest(plan: &Value) {
    assert_eq!(plan["rect"], json!([32.0, 36.0, 240.0, 108.0]));
    if plan["fullImage"] == true {
        assert!(plan["faces"].as_array().unwrap().is_empty());
    } else {
        let points = vertices(plan);
        assert!(!points.is_empty());
        for [u, v, x, y, w] in points {
            near(x, u * 320.0);
            near(y, v * 180.0);
            near(w, 1.0);
        }
    }
}

pub fn event(ticks: u64, velocity: [f64; 3]) -> Value {
    json!({"atTicks":ticks,"center":[0.5,0.75],"radius":0.5,"velocity":velocity})
}

pub fn z_motion(plan: &Value) -> f64 {
    vertices(plan).iter().map(|p| 1.0 - p[4]).sum()
}

pub fn assert_schema_contract() {
    let base = source();
    for (key, value) in [
        ("columns", json!(24)),
        ("rows", json!(24)),
        ("gravity", json!(4)),
        ("wind", json!([-4, 4, -4])),
        ("gust", json!(2)),
        ("gustFrequency", json!(5)),
        ("damping", json!(10)),
        ("stretchCompliance", json!(0.001)),
        ("bendCompliance", json!(0.1)),
        ("solverIterations", json!(12)),
        ("perspective", json!(0.8)),
        ("shading", json!(1)),
    ] {
        let mut accepted = base.clone();
        settings(&mut accepted)[key] = value;
        valid(&accepted);
    }
    let keys: Vec<_> = settings(&mut base.clone())
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    for key in keys {
        let mut invalid = base.clone();
        settings(&mut invalid).as_object_mut().unwrap().remove(&key);
        reject(&invalid);
    }
    for (key, value) in [
        ("columns", json!(1)),
        ("columns", json!(25)),
        ("columns", json!(2.5)),
        ("rows", json!(1)),
        ("rows", json!(25)),
        ("pins", json!("none")),
        ("gravity", json!(-0.1)),
        ("gravity", json!(4.1)),
        ("wind", json!([0, 0])),
        ("wind", json!([4.01, 0, 0])),
        ("wind", json!([0, -4.01, 0])),
        ("gust", json!(-0.1)),
        ("gust", json!(2.1)),
        ("gustFrequency", json!(-0.1)),
        ("gustFrequency", json!(5.1)),
        ("damping", json!(-0.1)),
        ("damping", json!(10.1)),
        ("stretchCompliance", json!(-0.001)),
        ("stretchCompliance", json!(0.00101)),
        ("bendCompliance", json!(-0.1)),
        ("bendCompliance", json!(0.101)),
        ("solverIterations", json!(1)),
        ("solverIterations", json!(13)),
        ("solverIterations", json!(2.5)),
        ("perspective", json!(0.801)),
        ("shading", json!(-0.1)),
        ("opacity", json!(1.01)),
        ("image", json!("missing.png")),
        ("fit", json!("invalid")),
        ("rect", json!([0, 0, 0, 1])),
        ("unknown", json!(0)),
    ] {
        let mut invalid = base.clone();
        settings(&mut invalid)[key] = value;
        reject(&invalid);
    }
    for key in ["kind", "role", "settings", "span"] {
        let mut invalid = base.clone();
        scene(&mut invalid).as_object_mut().unwrap().remove(key);
        reject(&invalid);
    }
    for (key, value) in [
        ("easing", json!("linear")),
        ("role", json!("invalid")),
        ("unknown", json!(0)),
    ] {
        let mut invalid = base.clone();
        scene(&mut invalid)[key] = value;
        reject(&invalid);
    }
    for (key, value) in [
        ("atTicks", json!(-1)),
        ("atTicks", json!(0.5)),
        ("atTicks", json!(48_000)),
        ("atTicks", json!(3_600_001)),
        ("atTicks", json!(9_007_199_254_740_992_u64)),
        ("center", json!([-0.1, 0.5])),
        ("center", json!([0.5, 1.1])),
        ("radius", json!(0.009)),
        ("radius", json!(2.001)),
        ("velocity", json!([0, 0, 3.01])),
        ("velocity", json!([-3.01, 0, 0])),
        ("unknown", json!(0)),
    ] {
        let mut invalid = base.clone();
        let mut impulse = event(0, [0.0, 0.0, 1.0]);
        impulse[key] = value;
        settings(&mut invalid)["events"] = json!([impulse]);
        reject(&invalid);
    }
    for impulses in [
        vec![event(0, [0.0; 3]); 17],
        vec![event(2, [0.0; 3]), event(1, [0.0; 3])],
    ] {
        let mut invalid = base.clone();
        settings(&mut invalid)["events"] = json!(impulses);
        reject(&invalid);
    }
    for key in ["atTicks", "center", "radius", "velocity"] {
        let mut invalid = base.clone();
        let mut impulse = event(0, [0.0, 0.0, 1.0]);
        impulse.as_object_mut().unwrap().remove(key);
        settings(&mut invalid)["events"] = json!([impulse]);
        reject(&invalid);
    }
    let mut invalid = base.clone();
    invalid["resources"][0]["kind"] = json!("font");
    reject(&invalid);
    let mut accepted = base;
    settings(&mut accepted)["events"] = json!(vec![event(47_999, [0.0; 3]); 16]);
    valid(&accepted);
    settings(&mut accepted)["events"] = json!([
        {"atTicks":0,"center":[0,1],"radius":0.01,"velocity":[-3,3,-3]},
        {"atTicks":0,"center":[1,0],"radius":2,"velocity":[3,-3,3]}
    ]);
    valid(&accepted);
}
