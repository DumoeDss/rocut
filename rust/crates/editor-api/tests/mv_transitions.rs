use editor_api::resolve_programmatic_frame_json;
use serde_json::{Value, json};

fn source(style: Value) -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":32,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "recipe":{"version":1,"root":"mix","songStartSeconds":12.25,"outputRoles":["foreground","graphics"],
            "nodes":[{"id":"a","scene":{"kind":"solid","role":"foreground","color":[1,0,0,1]}},
                {"id":"b","scene":{"kind":"solid","role":"foreground","color":[0,0,1,0]}},
                {"id":"mix","scene":{"kind":"transition","from":"a","to":"b","span":{"startFrame":4,"durationFrames":8},
                    "easing":"linear","style":style}}]}})
}
fn frame(s: &Value, index: u32) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,"clipDuration":120000,
        "trimStart":0,"timelineTime":index*5000})
        .to_string(),
    ))
    .unwrap()
}
fn styles() -> Vec<Value> {
    vec![
        json!({"kind":"cut"}),
        json!({"kind":"xfade"}),
        json!({"kind":"flash","color":[1,1,1,1]}),
        json!({"kind":"black"}),
        json!({"kind":"iris","center":[0.5,0.5]}),
        json!({"kind":"irisClose","center":[0.5,0.5]}),
        json!({"kind":"wipe","angle":0}),
        json!({"kind":"push","direction":"left"}),
        json!({"kind":"slices","count":9}),
        json!({"kind":"zoom"}),
        json!({"kind":"ink","seed":0,"blobs":14}),
        json!({"kind":"shatter","seed":0,"center":[0.5,0.5],"columns":9,"rows":5}),
        json!({"kind":"barrier","pivot":[-0.03,0.62],"colors":[[1,1,0,1],[0,0,0,1]],"width":0.04,"stripes":32,"role":"graphics"}),
    ]
}

#[test]
fn all_thirteen_mechanisms_have_exact_handles_and_deterministic_plans() {
    for style in styles() {
        let s = source(style.clone());
        for (index, color) in [
            (3, vec![1.0, 0.0, 0.0, 1.0]),
            (12, vec![0.0, 0.0, 1.0, 0.0]),
        ] {
            assert_eq!(
                frame(&s, index)["frame"]["recipePlan"]["root"]["color"],
                json!(color),
                "{style}"
            );
        }
        let expected = if style["kind"] == "cut" {
            json!([0.0, 0.0, 1.0, 0.0])
        } else {
            json!([1.0, 0.0, 0.0, 1.0])
        };
        assert_eq!(
            frame(&s, 4)["frame"]["recipePlan"]["root"]["color"],
            expected,
            "{style}"
        );
        let mid = frame(&s, 8);
        assert!(mid["error"].is_null(), "{mid}");
        if style["kind"] != "cut" {
            assert!(
                !mid["frame"]["recipePlan"]["root"]["commands"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
        }
        for index in [11, 6, 8, 5, 8] {
            assert_eq!(frame(&s, index), frame(&s, index));
        }
        assert_eq!(mid, frame(&s, 8));
    }
}
#[test]
fn push_slices_and_flash_encode_picture_operations_not_overlay_surrogates() {
    let p = frame(&source(json!({"kind":"push","direction":"left"})), 8);
    let ops = &p["frame"]["recipePlan"]["root"]["commands"];
    assert_eq!(ops[0]["transform"][4].as_f64(), Some(-32.0));
    assert_eq!(ops[1]["transform"][4].as_f64(), Some(32.0));
    assert_eq!(ops[0]["input"], "from");
    assert_eq!(ops[1]["input"], "to");
    let p = frame(&source(json!({"kind":"slices","count":4})), 6);
    let ops = &p["frame"]["recipePlan"]["root"]["commands"];
    assert_eq!(ops.as_array().unwrap().len(), 5);
    assert!(
        ops[1]["transform"][4].as_f64().unwrap() < 0.0
            && ops[2]["transform"][4].as_f64().unwrap() > 0.0
    );
    assert_eq!(ops[1]["replace"], true);
    assert_eq!(ops[2]["clip"]["y"].as_f64(), Some(8.0));
    let p = frame(&source(json!({"kind":"flash","color":[1,1,1,1]})), 8);
    assert_eq!(
        p["frame"]["recipePlan"]["root"]["commands"][1]["kind"],
        "tint"
    );
    assert_eq!(
        p["frame"]["recipePlan"]["root"]["commands"][1]["opacity"].as_f64(),
        Some(1.0)
    );
}
#[test]
fn seeded_organic_masks_shards_and_decorations_are_bounded_and_reproducible() {
    for style in [
        json!({"kind":"ink","seed":11,"blobs":14}),
        json!({"kind":"shatter","seed":11,"center":[0.5,0.5],"columns":9,"rows":5}),
    ] {
        let mut s = source(style);
        let a = frame(&s, 6);
        s["seed"] = json!(8);
        let b = frame(&s, 6);
        assert_ne!(a, b);
        s["seed"] = json!(7);
        assert_eq!(frame(&s, 6), a);
    }
    let s = source(
        json!({"kind":"shatter","seed":11,"center":[0.5,0.5],"columns":9,"rows":5,
        "edge":{"color":[1,1,1,1],"width":0.002,"role":"graphics"}}),
    );
    let p = frame(&s, 6);
    let ops = p["frame"]["recipePlan"]["root"]["commands"]
        .as_array()
        .unwrap();
    assert_eq!(ops.len(), 181); // 90 moving triangles, 90 explicit role strokes + B
    assert!(
        ops.iter()
            .filter(|o| o["kind"] == "stroke")
            .all(|o| o["role"] == "graphics")
    );
    assert!(
        ops.iter()
            .filter(|o| o["kind"] == "image" && o["input"] == "from")
            .all(|o| o["clip"]["points"][0].as_array().unwrap().len() == 3)
    );
}
#[test]
fn invalid_new_parameters_and_unbounded_tessellation_fail_before_planning() {
    for style in [
        json!({"kind":"slices","count":33}),
        json!({"kind":"push","direction":"diagonal"}),
        json!({"kind":"ink","seed":-1,"blobs":14}),
        json!({"kind":"ink","seed":1,"blobs":0}),
        json!({"kind":"shatter","seed":1,"center":[0.5,0.5],"columns":u32::MAX,"rows":u32::MAX}),
        json!({"kind":"shatter","seed":1,"center":[0.5,0.5],"columns":20,"rows":20}),
        json!({"kind":"barrier","pivot":[0.2,0.5],"colors":[[1,1,0,1],[0,0,0,1]],"width":0.04,"stripes":32,"role":"graphics"}),
        json!({"kind":"iris","center":[0.5,0.5],"edge":{"color":[1,1,1,1],"width":1,"role":"lyrics"}}),
    ] {
        assert!(
            frame(&source(style.clone()), 8)["error"].is_string(),
            "{style}"
        );
    }
    let mut s = source(json!({"kind":"zoom"}));
    s["recipe"]["nodes"][2]["scene"]["commands"] = json!([]);
    assert!(frame(&s, 8)["error"].is_string()); // plans cannot be injected by an author
}
#[test]
fn reference_exponential_timing_can_be_selected_without_browser_easing() {
    let mut s = source(json!({"kind":"iris","center":[0.5,0.5]}));
    s["recipe"]["nodes"][2]["scene"]["easing"] = json!("inOutExpo");
    assert_eq!(
        frame(&s, 6)["frame"]["recipePlan"]["root"]["progress"].as_f64(),
        Some(1.0 / 64.0)
    );
}
