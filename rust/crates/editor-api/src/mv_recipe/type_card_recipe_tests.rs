use super::test_support::*;
use crate::mv_recipe::Recipe;
use serde_json::{Value, json};

#[test]
fn requests_cover_disconnected_quiet_nodes_deduplicate_and_sort_without_current_frame() {
    let mut value = recipe(settings("quiet"));
    value["nodes"][0]["scene"]["settings"]["glyphs"] = json!([
        {"text":"Z","opticalScale":1},{"text":"A","opticalScale":1},{"text":"Z","opticalScale":0.9}]);
    let mut second = value["nodes"][0].clone();
    second["id"] = json!("disconnected");
    second["scene"]["settings"]["glyphs"] = json!([{"text":"B","opticalScale":1}]);
    value["nodes"].as_array_mut().unwrap().push(second);
    let r: Recipe = serde_json::from_value(value).unwrap();
    let resources = resources();
    let request = r.font_metric_requests(&resources).unwrap();
    assert_eq!(request.len(), 1);
    assert_eq!(request[0].glyphs, ["A", "B", "Z"]);
    assert!(r.font_metric_requests(&[]).is_err());
    assert!(r.validate(&resources, 240, 640, 360, 2000).is_empty());
}

#[test]
fn request_limit_is_global_across_nodes_including_disconnected_nodes() {
    let mut value = recipe(settings("quiet"));
    value["nodes"] = json!([]);
    for n in 0..9 {
        let mut a = settings("quiet");
        a["glyphs"] = json!((0..128).map(|i| {
            json!({"text":char::from_u32(0x1000+n*128+i).unwrap().to_string(),"opticalScale":1})
        }).collect::<Vec<_>>());
        value["nodes"].as_array_mut().unwrap().push(json!({"id":if n==0 {"card".to_string()} else {format!("other{n}")},
            "scene":{"kind":"typeCard","role":"graphics","span":{"startFrame":0,"durationFrames":240},"settings":a}}));
    }
    let r: Recipe = serde_json::from_value(value.clone()).unwrap();
    assert!(r.font_metric_requests(&resources()).is_err());
    assert!(
        r.validate(&resources(), 240, 640, 360, 2000)[0]
            .message
            .contains("1024")
    );
    value["nodes"].as_array_mut().unwrap().pop();
    let r: Recipe = serde_json::from_value(value).unwrap();
    assert_eq!(
        r.font_metric_requests(&resources()).unwrap()[0]
            .glyphs
            .len(),
        1024
    );
}

#[test]
fn quiet_ref_sampling_uses_shared_metrics_and_remaps_grain_and_local_clock() {
    let settings = settings("quiet");
    let fonts = context(settings.clone());
    let resources = resources();
    let plain: Recipe = serde_json::from_value(recipe(settings.clone())).unwrap();
    assert!(
        plain
            .resolve(60, 2000, 0, 640, 360, None, &resources, 120000, None)
            .is_err()
    );
    let expected = serde_json::to_value(
        plain
            .resolve_with_fonts(
                30,
                2000,
                0,
                640,
                360,
                None,
                &resources,
                60000,
                None,
                Some(&fonts),
            )
            .unwrap(),
    )
    .unwrap();
    let mut value = recipe(settings);
    value["root"] = json!("reverse");
    value["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"reverse","scene":{"kind":"ref","input":"card",
        "timeMap":[{"atFrame":0,"sourceFrame":120},{"atFrame":120,"sourceFrame":0}]}}));
    let r: Recipe = serde_json::from_value(value).unwrap();
    let actual = serde_json::to_value(
        r.resolve_with_fonts(
            90,
            2000,
            0,
            640,
            360,
            None,
            &resources,
            180000,
            None,
            Some(&fonts),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(actual["root"]["input"], expected["root"]);
    assert_eq!(actual["songSeconds"], 1.5);
    assert_eq!(expected["songSeconds"], 0.5);
}

fn issues(value: Value, width: u32) -> Vec<crate::model::Issue> {
    serde_json::from_value::<Recipe>(value)
        .unwrap()
        .validate(&resources(), 240, width, width, 2000)
}
#[test]
fn manual_beat_nodes_do_not_require_audio_but_analysis_nodes_do() {
    let mut value = recipe(settings("flicker"));
    assert!(issues(value.clone(), 320).is_empty());
    value["nodes"][0]["scene"]["settings"]["beats"] = json!({"kind":"analysis"});
    assert!(issues(value, 320)[0].message.contains("analysis binding"));
}

#[test]
fn expanded_text_effect_and_cloned_grain_payload_have_finite_budgets() {
    let mut value = recipe(settings("flicker"));
    for i in 1..=3 {
        let child = if i == 1 {
            "card".to_string()
        } else {
            format!("repeat{}", i - 1)
        };
        value["nodes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":format!("repeat{i}"),"scene":{
            "kind":"transition","from":child,"to":child,"style":{"kind":"xfade"},
            "span":{"startFrame":0,"durationFrames":240},"easing":"linear"}}));
    }
    value["root"] = json!("repeat3");
    assert!(
        issues(value, 320)[0]
            .message
            .contains("4096 expanded generator primitives")
    );
    assert!(
        issues(recipe(settings("quiet")), 4096)[0]
            .message
            .contains("raster surface budget")
    );
    let mut quiet = settings("quiet");
    quiet["grain"] = json!(0);
    let low: super::TypeCard = serde_json::from_value(quiet).unwrap();
    let high = model("quiet");
    assert!(high.plan_pixels() >= low.plan_pixels() + 9 * 65536);
}
