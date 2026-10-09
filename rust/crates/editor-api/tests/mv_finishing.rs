use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn effects() -> Vec<Value> {
    vec![
        json!({"kind":"invert","amount":0.25}),
        json!({"kind":"flash","amount":0.5,"color":[0.25,0.5,1.0]}),
        json!({"kind":"fade","amount":0.75}),
        json!({"kind":"letterbox","amount":0.5,"heightFraction":0.125}),
        json!({"kind":"quantizationDither","amount":0.8}),
    ]
}
fn source(effects: Vec<Value>) -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "recipe":{"version":1,"root":"solid","songStartSeconds":0.5,"outputRoles":["foreground"],
        "nodes":[{"id":"solid","scene":{"kind":"solid","role":"foreground","color":[0.2,0.4,0.6,0.5]}}],
        "post":[{"roles":["foreground"],"effects":effects}]}})
}
fn resolve(s: &Value, frame: u64) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":frame*5000}).to_string(),
    )).unwrap()
}
fn issues(s: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap()
}
fn plan(s: &Value, frame: u64) -> Value {
    let resolved = resolve(s, frame);
    assert!(
        resolved["frame"].is_object(),
        "could not resolve: {resolved}"
    );
    resolved["frame"]["recipePlan"]["post"].clone()
}
fn grade(lift: [f64; 3], gain: [f64; 3]) -> Value {
    json!({"kind":"grade","exposure":0.0,"contrast":1.0,"saturation":1.0,"lift":lift,"gain":gain})
}
fn reject(s: &Value) {
    assert!(
        !issues(s).is_empty(),
        "accepted invalid finishing effect: {s}"
    );
    assert!(
        resolve(s, 0)["error"].is_string(),
        "render accepted invalid finishing effect: {s}"
    );
}

#[test]
fn finishing_lowers_to_exact_affine_grades_without_reordering() {
    let s = source(effects());
    assert!(issues(&s).is_empty());
    let p = plan(&s, 0);
    let expected = [
        grade([0.25; 3], [0.75; 3]),
        grade([0.125, 0.25, 0.5], [0.625, 0.75, 1.0]),
        grade([0.0; 3], [0.25; 3]),
        effects()[3].clone(),
        effects()[4].clone(),
    ];
    for (i, e) in expected.iter().enumerate() {
        assert_eq!(&p[0]["effects"][i]["effect"], e);
        assert_eq!(p[0]["effects"][i]["seed"], 7);
    }
}

#[test]
fn zero_and_full_amount_have_exact_identity_inverse_color_and_black_endpoints() {
    let mut neutral = effects();
    for e in &mut neutral {
        e["amount"] = json!(0.0);
    }
    let s = source(neutral);
    assert!(issues(&s).is_empty());
    let p = plan(&s, 0);
    for i in 0..3 {
        assert_eq!(p[0]["effects"][i]["effect"], grade([0.0; 3], [1.0; 3]));
    }
    let mut full = effects();
    for e in &mut full {
        e["amount"] = json!(1.0);
    }
    full[3]["heightFraction"] = json!(0.5);
    let s = source(full);
    assert!(issues(&s).is_empty());
    let p = plan(&s, 0);
    assert_eq!(p[0]["effects"][0]["effect"], grade([1.0; 3], [0.0; 3]));
    assert_eq!(
        p[0]["effects"][1]["effect"],
        grade([0.25, 0.5, 1.0], [0.25, 0.5, 1.0])
    );
    assert_eq!(p[0]["effects"][2]["effect"], grade([0.0; 3], [0.0; 3]));
}

#[test]
fn invalid_amounts_color_geometry_and_unknown_fields_fail_at_save_and_render() {
    for i in 0..effects().len() {
        for value in [json!(-0.001), json!(1.001), Value::Null, json!("0.5")] {
            let mut s = source(effects());
            s["recipe"]["post"][0]["effects"][i]["amount"] = value;
            reject(&s);
        }
        let mut s = source(effects());
        s["recipe"]["post"][0]["effects"][i]
            .as_object_mut()
            .unwrap()
            .remove("amount");
        reject(&s);
        let mut s = source(effects());
        s["recipe"]["post"][0]["effects"][i]["alpha"] = json!("opaque");
        reject(&s);
    }
    for value in [
        json!([-0.01, 0.0, 1.0]),
        json!([0.0, 1.01, 0.0]),
        json!([0.0, 1.0]),
        json!([0.0, 0.0, 0.0, 1.0]),
        json!([0.0, null, 1.0]),
        json!("#ffffff"),
    ] {
        let mut s = source(effects());
        s["recipe"]["post"][0]["effects"][1]["color"] = value;
        reject(&s);
    }
    for value in [json!(-0.001), json!(0.501), Value::Null] {
        let mut s = source(effects());
        s["recipe"]["post"][0]["effects"][3]["heightFraction"] = value;
        reject(&s);
    }
    for (i, key) in [(1, "color"), (3, "heightFraction")] {
        let mut s = source(effects());
        s["recipe"]["post"][0]["effects"][i]
            .as_object_mut()
            .unwrap()
            .remove(key);
        reject(&s);
    }
    let mut s = source(effects());
    s["recipe"]["post"][0]["effects"][4]["fps"] = json!(24);
    reject(&s); // Quantization noise has a static source seed, not a grain clock.
}

#[test]
fn serialization_default_stage_and_reverse_seek_preserve_static_finishing_plan() {
    let original = source(effects());
    let roundtrip: Value =
        serde_json::from_str(&serde_json::to_string(&original).unwrap()).unwrap();
    assert!(issues(&roundtrip).is_empty());
    let first = plan(&original, 2);
    assert_eq!(first, plan(&roundtrip, 18));
    assert_eq!(first, plan(&roundtrip, 2));
    let mut explicit = roundtrip.clone();
    explicit["recipe"]["post"][0]["stage"] = json!("role");
    assert_eq!(first, plan(&explicit, 2));
    let mut composite = roundtrip;
    composite["recipe"]["post"][0]["stage"] = json!("composite");
    composite["recipe"]["post"][0]
        .as_object_mut()
        .unwrap()
        .remove("roles");
    assert!(issues(&composite).is_empty());
    let composed = plan(&composite, 2);
    assert_eq!(composed[0]["stage"], "composite");
    assert_eq!(composed[0]["effects"], first[0]["effects"]);
}

#[test]
fn every_finishing_effect_counts_as_one_role_weighted_or_composite_pass() {
    for effect in effects() {
        let mut s = source(vec![effect.clone(); 8]);
        s["recipe"]["post"][0]["roles"] =
            json!(["background", "subject", "graphics", "foreground"]);
        let group = s["recipe"]["post"][0].clone();
        s["recipe"]["post"] = json!(vec![group; 4]); // 8 effects x 4 roles x 4 groups = 128.
        assert!(
            issues(&s).is_empty(),
            "effect counted more than once: {effect}"
        );
        plan(&s, 0);
        s["recipe"]["post"]
            .as_array_mut()
            .unwrap()
            .push(json!({"stage":"composite","effects":[effect]}));
        reject(&s); // A single additional composite pass must exceed the cap.
    }
}

#[test]
fn existing_color_and_spatial_effects_keep_their_serialized_plan() {
    let old = vec![
        grade([0.0; 3], [1.0; 3]),
        json!({"kind":"palette","colors":[[0.0,0.0,0.0,1.0],[1.0,1.0,1.0,1.0]],"mix":0.5}),
        json!({"kind":"vignette","amount":0.3}),
        json!({"kind":"grain","amount":0.1,"fps":12}),
        json!({"kind":"lineBoil","amount":2.0,"cellSize":34.0,"fps":12}),
        json!({"kind":"glitch","amount":0.5,"bands":38,"fps":12}),
        json!({"kind":"chromaticAberration","amount":4.0,"center":[0.25,0.75]}),
        json!({"kind":"zoomBlur","amount":0.2,"center":[0.25,0.75]}),
        json!({"kind":"bloom","amount":0.5,"threshold":0.72,"radius":4.0,"alpha":"expand"}),
    ];
    for effect in old {
        let s = source(vec![effect.clone()]);
        assert!(issues(&s).is_empty());
        assert_eq!(plan(&s, 0)[0]["effects"][0]["effect"], effect);
    }
}
