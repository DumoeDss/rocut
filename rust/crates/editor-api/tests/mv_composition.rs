use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "recipe":{"version":1,"root":"ref","songStartSeconds":12.25,"outputRoles":["foreground"],
        "nodes":[{"id":"a","scene":{"kind":"solid","role":"foreground","color":[1,0,0,1]}},
        {"id":"b","scene":{"kind":"solid","role":"foreground","color":[0,0,1,1]}},
        {"id":"ref","scene":{"kind":"ref","input":"a","timeMap":[{"atFrame":0,"sourceFrame":2},{"atFrame":4,"sourceFrame":6},{"atFrame":7,"sourceFrame":6},{"atFrame":10,"sourceFrame":0}]}}],
        "post":[{"roles":["foreground"],"effects":[{"kind":"grain","amount":0.1,"fps":12}]}]}})
}
fn resolve(s: &Value, index: u64) -> Value {
    let step = 120000 * s["frameRate"]["denominator"].as_u64().unwrap()
        / s["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,
        "clipDuration":24*step,"trimStart":0,"timelineTime":index*step})
        .to_string(),
    ))
    .unwrap()
}
fn valid(s: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":1,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}
fn root(r: &Value) -> &Value {
    &r["frame"]["recipePlan"]["root"]
}
fn reject(s: &Value) {
    assert!(!valid(s));
    assert!(resolve(s, 0)["error"].is_string());
}

#[test]
fn exact_integer_map_covers_play_hold_reverse_and_nested_references() {
    let mut s = source();
    assert!(valid(&s));
    for (frame, expected) in [
        (0, 2),
        (1, 3),
        (4, 6),
        (6, 6),
        (8, 4),
        (9, 2),
        (10, 0),
        (23, 0),
    ] {
        assert_eq!(root(&resolve(&s, frame))["sampledFrame"], expected);
    }
    s["recipe"]["nodes"][2]["scene"]["timeMap"] =
        json!([{"atFrame":2,"sourceFrame":6},{"atFrame":5,"sourceFrame":2}]);
    for (frame, expected) in [(0, 6), (2, 6), (3, 4), (4, 3), (5, 2), (23, 2)] {
        assert_eq!(root(&resolve(&s, frame))["sampledFrame"], expected);
    }
    s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"outer","scene":{"kind":"ref","input":"ref","timeMap":[{"atFrame":0,"sourceFrame":4}]}}));
    s["recipe"]["root"] = json!("outer");
    let r = resolve(&s, 10);
    assert_eq!(root(&r)["sampledFrame"], 4);
    assert_eq!(root(&r)["input"]["sampledFrame"], 3);
    // Finishing uses destination song time, not either frozen input clock.
    assert_eq!(
        r["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"],
        159
    );
}

#[test]
fn mapped_illust_clock_matches_direct_render_including_quantization_and_fractional_fps() {
    let mut s = source();
    s["resources"] = json!([{"id":"a.png","kind":"image","mimeType":"image/png","byteLength":1,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}]);
    s["recipe"]["nodes"][0]["scene"] = json!({"kind":"illust","motion":{"startFrame":0,"durationFrames":24},"easing":"linear",
        "sprites":[{"image":"a.png","role":"foreground","anchor":[0.5,0.5],"drawingFps":12,
        "sway":{"amplitude":0.1,"frequency":1.2,"phase":0.2},
        "from":{"x":0,"y":0.5,"height":1,"rotation":0,"opacity":1},
        "to":{"x":1,"y":0.5,"height":1,"rotation":0,"opacity":1}}]});
    s["frameRate"] = json!({"numerator":30000,"denominator":1001});
    let mut direct = s.clone();
    direct["recipe"]["root"] = json!("a");
    for (i, mapped) in [(0, 2), (4, 6), (6, 6), (9, 2), (23, 0)] {
        assert_eq!(
            root(&resolve(&s, i))["input"],
            *root(&resolve(&direct, mapped))
        );
    }
}

fn sequence() -> Value {
    json!({"kind":"sequence","items":[
        {"input":"a","span":{"startFrame":0,"durationFrames":5},"timeMap":[{"atFrame":0,"sourceFrame":0},{"atFrame":4,"sourceFrame":4}]},
        {"input":"b","span":{"startFrame":8,"durationFrames":4},"timeMap":[{"atFrame":8,"sourceFrame":9},{"atFrame":11,"sourceFrame":6}]}]})
}
#[test]
fn sequence_has_half_open_intervals_gaps_and_can_itself_be_rewound() {
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"] = sequence();
    assert!(valid(&s));
    assert_eq!(
        root(&resolve(&s, 4))["input"]["color"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
    for i in [5, 7, 12, 23] {
        assert_eq!(root(&resolve(&s, i))["kind"], "empty");
    }
    assert_eq!(root(&resolve(&s, 8))["sampledFrame"], 9);
    assert_eq!(root(&resolve(&s, 11))["sampledFrame"], 6);
    s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{"kind":"ref","input":"ref","timeMap":[{"atFrame":0,"sourceFrame":11},{"atFrame":11,"sourceFrame":0}]}}));
    s["recipe"]["root"] = json!("reverse");
    assert_eq!(
        root(&resolve(&s, 0))["input"]["input"]["color"],
        json!([0.0, 0.0, 1.0, 1.0])
    );
    assert_eq!(root(&resolve(&s, 5))["input"]["kind"], "empty");
    assert_eq!(
        root(&resolve(&s, 11))["input"]["input"]["color"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
}
fn panel(input: &str, polygon: Value) -> Value {
    json!({"input":input,"polygon":polygon,"opening":{"span":{"startFrame":0,"durationFrames":2},"angle":0,"easing":"linear"},
        "camera":{"motion":{"startFrame":0,"durationFrames":24},"from":{"x":0,"y":0,"zoom":1},"to":{"x":0,"y":0,"zoom":1},"easing":"linear"}})
}
fn panels() -> Value {
    json!({"kind":"panels","panels":[panel("a",json!([[0,0],[0.45,0],[0.45,1],[0,1]])),panel("b",json!([[0.55,0],[1,0],[1,1],[0.55,1]]))],
        "collapse":{"hero":0,"span":{"startFrame":8,"durationFrames":8},"easing":"linear"}})
}
#[test]
fn panel_geometry_reveals_then_expands_hero_continuously_to_full_frame() {
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"] = panels();
    assert!(valid(&s));
    assert_eq!(root(&resolve(&s, 0))["panels"], json!([]));
    assert_eq!(root(&resolve(&s, 4))["panels"].as_array().unwrap().len(), 2);
    let partial = resolve(&s, 12);
    let poly = root(&partial)["panels"][1]["polygon"].as_array().unwrap();
    let max_x = poly
        .iter()
        .map(|p| p[0].as_f64().unwrap())
        .fold(0.0, f64::max);
    assert!((max_x - 46.4).abs() < 1e-9);
    let end = resolve(&s, 16);
    let p = &root(&end)["panels"];
    assert_eq!(p.as_array().unwrap().len(), 1);
    assert_eq!(
        p[0]["polygon"],
        json!([[0.0, 0.0], [64.0, 0.0], [64.0, 64.0], [0.0, 64.0]])
    );
    assert_eq!(p[0]["transform"], json!([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
}
#[test]
fn every_reference_is_validated_including_inactive_cycles_and_bad_geometry() {
    for map in [
        json!([]),
        json!([{"atFrame":0,"sourceFrame":24}]),
        json!([{"atFrame":24,"sourceFrame":0}]),
        json!([{"atFrame":2,"sourceFrame":0},{"atFrame":2,"sourceFrame":3}]),
        json!([{"atFrame":0,"sourceFrame":0,"rate":1}]),
    ] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"]["timeMap"] = map;
        reject(&s);
    }
    for input in ["ref", "missing"] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"]["input"] = json!(input);
        s["recipe"]["root"] = json!("a");
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"] = sequence();
    s["recipe"]["nodes"][2]["scene"]["items"][1]["span"]["startFrame"] = json!(4);
    reject(&s);
    for input in ["ref", "missing"] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"] = sequence();
        s["recipe"]["nodes"][2]["scene"]["items"][1]["input"] = json!(input);
        reject(&s); // Later/inactive intervals must not conceal cycles or missing nodes.
    }
    for polygon in [
        json!([[0, 0], [1, 1], [0, 1], [1, 0]]),
        json!([[0, 0], [1, 0], [0.2, 0.2], [1, 1], [0, 1]]),
        json!([[0, 0], [0, 0], [1, 1]]),
        json!([[-1, 0], [1, 0], [1, 1]]),
    ] {
        let mut s = source();
        s["recipe"]["nodes"][2]["scene"] = panels();
        s["recipe"]["nodes"][2]["scene"]["panels"][0]["polygon"] = polygon;
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"] = panels();
    s["recipe"]["nodes"][2]["scene"]["panels"][1]["input"] = json!("ref");
    reject(&s);
    s["recipe"]["nodes"][2]["scene"]["panels"][1]["input"] = json!("a");
    s["recipe"]["nodes"][2]["scene"]["collapse"]["hero"] = json!(2);
    reject(&s);
    s["recipe"]["nodes"][2]["scene"]["collapse"]["hero"] = json!(0);
    s["recipe"]["nodes"][2]["scene"]["collapse"]["span"]["startFrame"] = json!(0);
    reject(&s);
}
