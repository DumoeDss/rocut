use super::tests::settings;
use crate::{mv_recipe::Recipe, programmatic_resources::Resource};
use serde_json::{Value, json};

fn resources() -> Vec<Resource> {
    [("image","image","image/png"),("font","font","font/woff2")].into_iter().map(|(id,kind,mime)| {
        serde_json::from_value(json!({"id":id,"kind":kind,"mimeType":mime,"byteLength":1,
            "sha256":"ab".repeat(32),"attachmentKey":format!("programmatic-sha256-{}","ab".repeat(32))})).unwrap()
    }).collect()
}
fn recipe() -> Value {
    json!({"version":1,"root":"a","songStartSeconds":0,"outputRoles":["graphics"],
        "nodes":[{"id":"a","scene":{"kind":"afterimage","role":"graphics","settings":settings(),
            "span":{"startFrame":0,"durationFrames":240}}}]})
}
fn errors(value: Value, resources: &[Resource], size: u32) -> Vec<crate::model::Issue> {
    serde_json::from_value::<Recipe>(value)
        .unwrap()
        .validate(resources, 240, size, size, 2000)
}
#[test]
fn declarations_span_duration_and_raster_peak_are_enforced() {
    let resources = resources();
    assert!(errors(recipe(), &resources, 640).is_empty());
    assert!(!errors(recipe(), &resources[..1], 640).is_empty());
    assert!(!errors(recipe(), &resources[1..], 640).is_empty());
    for key in ["titleFont", "subtitle", "credit"] {
        let mut value = recipe();
        if key == "titleFont" {
            value["nodes"][0]["scene"]["settings"][key] = json!("image");
        } else {
            value["nodes"][0]["scene"]["settings"][key]["font"] = json!("image");
        }
        assert!(!errors(value, &resources, 640).is_empty(), "{key}");
    }
    let mut invalid = recipe();
    invalid["nodes"][0]["scene"]["span"]["durationFrames"] = json!(241);
    assert!(!errors(invalid, &resources, 640).is_empty());
    let r: Recipe = serde_json::from_value(recipe()).unwrap();
    assert!(!r.validate(&resources, 240, 640, 360, u64::MAX).is_empty());
    // Ten full-frame surfaces plus transient/payload grain: preserve the 64M-pixel cap.
    assert!(errors(recipe(), &resources, 2570).is_empty());
    assert!(
        errors(recipe(), &resources, 2580)[0]
            .message
            .contains("raster surface budget")
    );
}
#[test]
fn ref_remaps_afterimage_response_and_grain_without_changing_root_song_clock() {
    let resources = resources();
    let original: Recipe = serde_json::from_value(recipe()).unwrap();
    let direct = serde_json::to_value(
        original
            .resolve(60, 2000, 17, 640, 360, None, &resources, 120000, None)
            .unwrap(),
    )
    .unwrap();
    let mut reverse = recipe();
    reverse["root"] = json!("reverse");
    reverse["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"reverse","scene":{"kind":"ref","input":"a",
        "timeMap":[{"atFrame":0,"sourceFrame":120},{"atFrame":120,"sourceFrame":0}]}}));
    let reverse: Recipe = serde_json::from_value(reverse).unwrap();
    assert!(reverse.validate(&resources, 240, 640, 360, 2000).is_empty());
    let sample = serde_json::to_value(
        reverse
            .resolve(60, 2000, 17, 640, 360, None, &resources, 120000, None)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(sample["root"]["input"], direct["root"]);
    let sample = serde_json::to_value(
        reverse
            .resolve(90, 2000, 17, 640, 360, None, &resources, 180000, None)
            .unwrap(),
    )
    .unwrap();
    let direct = serde_json::to_value(
        original
            .resolve(30, 2000, 17, 640, 360, None, &resources, 60000, None)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(sample["root"]["input"], direct["root"]);
    assert_eq!(sample["songSeconds"], 1.5);
    assert_eq!(direct["songSeconds"], 0.5);
}
#[test]
fn repeated_dag_visits_charge_afterimage_text_and_grain_primitives() {
    let mut r = recipe();
    for i in 1..=4 {
        let previous = if i == 1 {
            "a".to_string()
        } else {
            format!("repeat{}", i - 1)
        };
        r["nodes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":format!("repeat{i}"),"scene":{
            "kind":"transition","from":previous,"to":previous,"style":{"kind":"xfade"},
            "easing":"linear","span":{"startFrame":0,"durationFrames":240}}}));
    }
    r["root"] = json!("repeat4");
    let issues = errors(r.clone(), &resources(), 320);
    assert!(
        issues[0]
            .message
            .contains("4096 expanded generator primitives")
    );
    r["nodes"][0]["scene"]["settings"]["grain"] = json!(0);
    assert!(errors(r.clone(), &resources(), 320).is_empty());
    r["nodes"][0]["scene"]["settings"]["subtitle"]["text"] = json!("x".repeat(256));
    assert!(
        errors(r, &resources(), 320)[0]
            .message
            .contains("4096 expanded generator primitives")
    );
}

#[test]
fn repeated_dag_grain_payload_is_not_mistaken_for_reusable_raster_scratch() {
    let mut r = recipe();
    for i in 1..=3 {
        let previous = if i == 1 {
            "a".to_string()
        } else {
            format!("repeat{}", i - 1)
        };
        r["nodes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":format!("repeat{i}"),"scene":{
            "kind":"transition","from":previous,"to":previous,"style":{"kind":"xfade"},
            "easing":"linear","span":{"startFrame":0,"durationFrames":240}}}));
    }
    r["root"] = json!("repeat3");
    assert!(errors(r.clone(), &resources(), 1970).is_empty());
    assert!(
        errors(r.clone(), &resources(), 1980)[0]
            .message
            .contains("raster surface budget")
    );
    r["nodes"][0]["scene"]["settings"]["grain"] = json!(0);
    assert!(errors(r, &resources(), 1980).is_empty());
}
