use super::test_support::*;
use crate::mv_recipe::Recipe;
use serde_json::{Value, json};

fn collapse_recipe() -> Value {
    json!({"version":1,"root":"ember","songStartSeconds":0,"outputRoles":["foreground"],
        "nodes":[{"id":"ember","scene":{"kind":"ember","role":"foreground",
            "span":{"startFrame":0,"durationFrames":60},"settings":author("collapse")}}]})
}
#[test]
fn repeated_dag_visits_are_charged_not_deduplicated_by_scene_identity() {
    let mut value = collapse_recipe();
    let base: Recipe = serde_json::from_value(value.clone()).unwrap();
    assert!(base.validate(&resources(), 60, 1920, 1080, 4000).is_empty());
    for (id, child) in [("pair", "ember"), ("root", "pair")] {
        value["nodes"].as_array_mut().unwrap().push(json!({"id":id,"scene":{"kind":"transition", "from":child,"to":child,
            "span":{"startFrame":0,"durationFrames":60},"easing":"linear","style":{"kind":"xfade"}}}));
    }
    value["root"] = json!("root");
    let expanded: Recipe = serde_json::from_value(value).unwrap();
    let issues = expanded.validate(&resources(), 60, 1920, 1080, 4000);
    assert!(
        issues.iter().any(|i| i.message.contains("4096")),
        "{}",
        issues
            .iter()
            .map(|i| i.message.as_str())
            .collect::<Vec<_>>()
            .join("; ")
    );
}
#[test]
fn decoded_image_reserve_and_encoded_copies_share_temporary_surface_admission() {
    let recipe: Recipe = serde_json::from_value(collapse_recipe()).unwrap();
    assert!(
        recipe
            .validate(&resources(), 60, 1920, 1080, 4000)
            .is_empty()
    );
    let issues = recipe.validate(&resources(), 60, 4096, 4096, 4000);
    assert!(
        issues
            .iter()
            .any(|i| i.message.contains("raster surface budget"))
    );
}
#[test]
fn unused_branch_still_requires_real_declared_image_identity() {
    let mut value = collapse_recipe();
    value["nodes"][0]["scene"]["settings"]["image"] = json!("missing.png");
    value["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"solid","scene":{"kind":"solid","role":"foreground","color":[0,0,0,1]}}));
    value["root"] = json!("solid");
    let recipe: Recipe = serde_json::from_value(value).unwrap();
    assert!(
        !recipe
            .validate(&resources(), 60, 1920, 1080, 4000)
            .is_empty()
    );
}
