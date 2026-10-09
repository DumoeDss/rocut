//! Public source/plan/resource contracts; these synthetic facts do not test pixels.
#[path = "kanji_slam_image_budget_tests.rs"]
mod image_budget;
#[path = "kanji_slam_public_negatives.rs"]
mod negatives;
#[path = "kanji_slam_stream_budget_tests.rs"]
mod stream_budget;
#[path = "kanji_slam_public_support.rs"]
mod support;
use serde_json::{Value, json};
use support::*;

#[test]
fn pending_discovery_retains_hidden_authored_glyphs_and_exact_resource_identity() {
    let r = recipe("kanji", vec![]);
    let pending = resolve(&request(r.clone(), 0));
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert_eq!(pending["frame"]["fontMetricRequests"], font_requests(&r, 0));
    let monument = pending["frame"]["fontMetricRequests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["resource"]["id"] == "monument")
        .unwrap();
    for glyph in ["救", "っ", "て", "夜"] {
        assert!(
            monument["bounds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|b| b["text"] == glyph && b["fontSizePx"].as_f64() == Some(1500.0))
        );
    }
    assert_eq!(
        pending["frame"]["imageDimensionRequests"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let ready = resolve(&measured(request(r, 48)));
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "kanjiSlam");
    assert_eq!(
        ready["frame"]["recipePlan"]["outputRoles"],
        json!(["background", "subject", "graphics", "foreground"])
    );
    assert!(
        !ready["frame"]["recipePlan"]["root"]["data"]["commands"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn nested_reverse_reference_sequence_uses_the_same_integer_clock_for_metrics_and_draws() {
    let direct = recipe("kanji", vec![]);
    let mapped = recipe(
        "ref",
        vec![
            json!({"id":"ref","scene":{"kind":"ref","input":"sequence","timeMap":[{"atFrame":0,"sourceFrame":40},{"atFrame":20,"sourceFrame":10}]}}),
            json!({"id":"sequence","scene":{"kind":"sequence","items":[{"input":"kanji","span":{"startFrame":10,"durationFrames":31},"timeMap":[{"atFrame":10,"sourceFrame":140},{"atFrame":40,"sourceFrame":100}]}]}}),
        ],
    );
    for (at, sampled) in [(1, 102), (20, 140), (0, 100), (1, 102)] {
        assert_eq!(font_requests(&mapped, at), font_requests(&direct, sampled));
    }
    let a = resolve(&measured(request(mapped, 1)));
    let b = resolve(&measured(request(direct, 102)));
    assert!(a.get("error").is_none(), "{a}");
    assert!(b.get("error").is_none(), "{b}");
    assert_eq!(
        a["frame"]["recipePlan"]["root"]["input"]["input"]["data"],
        b["frame"]["recipePlan"]["root"]["data"]
    );
}

#[test]
fn sequence_gaps_and_hidden_future_shots_preflight_resources_without_clamping_actual_draws() {
    let mut hidden = recipe("black", vec![black()]);
    hidden["nodes"][0]["scene"]["span"] = json!({"startFrame":240,"durationFrames":240});
    for at in [0, 550] {
        let ready = resolve(&measured(request(hidden.clone(), at)));
        assert!(ready.get("error").is_none(), "{ready}");
        assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "solid");
    }
    hidden["root"] = json!("kanji");
    let error = resolve(&request(hidden, 0));
    assert!(
        error["error"]
            .as_str()
            .unwrap()
            .contains("valid shot clock")
    );
    let gap = recipe(
        "sequence",
        vec![
            json!({"id":"sequence","scene":{"kind":"sequence","items":[{"input":"kanji","span":{"startFrame":10,"durationFrames":10},"timeMap":[{"atFrame":10,"sourceFrame":140}]}]}}),
        ],
    );
    let static_requests = font_requests(&recipe("black", vec![black()]), 0);
    assert_eq!(font_requests(&gap, 20), static_requests);
    assert_eq!(
        font_requests(&gap, 10),
        font_requests(&recipe("kanji", vec![]), 140)
    );
}

#[test]
fn authored_unknown_fields_and_incorrect_resource_roles_are_rejected() {
    let original = request(recipe("kanji", vec![]), 0);
    for path in [
        "/source/recipe/nodes/0/scene",
        "/source/recipe/nodes/0/scene/settings",
        "/source/recipe/nodes/0/scene/settings/wind",
        "/source/recipe/nodes/0/scene/settings/frames/0",
        "/source/recipe/nodes/0/scene/settings/beats",
    ] {
        let mut bad = original.clone();
        bad.pointer_mut(path).unwrap()["unknown"] = json!(true);
        assert!(
            resolve(&bad)["error"]
                .as_str()
                .unwrap()
                .contains("unknown field")
        );
    }
    for field in ["monument", "lyric", "counter"] {
        let mut bad = original.clone();
        bad["source"]["recipe"]["nodes"][0]["scene"]["settings"]["fonts"][field] =
            json!("character");
        assert!(resolve(&bad).get("error").is_some());
    }
    let encoded = serde_json::to_string(&original).unwrap();
    let decoded: Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, original);
    assert_eq!(resolve(&decoded), resolve(&original));
}
