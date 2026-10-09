use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};

fn source(post: Value) -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "recipe":{"version":1,"root":"solid","songStartSeconds":0.5,
        "outputRoles":["foreground","background"],
        "nodes":[{"id":"solid","scene":{"kind":"solid","role":"foreground","color":[1,1,1,0.5]}}],
        "post":post}})
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
fn bloom() -> Value {
    json!({"kind":"bloom","amount":1.0,"threshold":0.7,"radius":4.0,"alpha":"expand"})
}

#[test]
fn agent_catalog_discovers_stages_that_persist_and_resolve() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let stages = &catalog["postStages"];
    assert_eq!(stages["supported"], json!(["role", "composite"]));
    assert_eq!(stages["default"], "role");
    assert_eq!(stages["passBudget"], 128);
    for stage in stages["supported"].as_array().unwrap() {
        let mut post = json!({"stage":stage,"effects":[bloom()]});
        if stage == "role" {
            post["roles"] = json!(["foreground"]);
        }
        let s = source(json!([post]));
        assert!(
            issues(&s).is_empty(),
            "advertised stage cannot persist: {stage}"
        );
        assert_eq!(
            resolve(&s, 0)["frame"]["recipePlan"]["post"][0]["stage"],
            *stage
        );
    }
}

#[test]
fn omitted_stage_preserves_role_plan_and_composite_has_one_explicit_target() {
    let old = source(json!([{"roles":["foreground"],"effects":[bloom()]}]));
    let mut explicit = old.clone();
    explicit["recipe"]["post"][0]["stage"] = json!("role");
    assert!(issues(&old).is_empty());
    assert_eq!(resolve(&old, 0), resolve(&explicit, 0));
    assert_eq!(
        resolve(&old, 0)["frame"]["recipePlan"]["post"][0]["stage"],
        "role"
    );

    let composite = source(json!([{"stage":"composite","effects":[bloom()]}]));
    assert!(issues(&composite).is_empty());
    let plan = resolve(&composite, 0)["frame"]["recipePlan"].clone();
    assert_eq!(plan["post"][0]["stage"], "composite");
    assert_eq!(plan["post"][0]["roles"], json!([]));
    assert_eq!(plan["post"][0]["effects"][0]["effect"], bloom());
    assert_eq!(plan["outputRoles"], json!(["background", "foreground"]));
    let mut empty_roles = composite.clone();
    empty_roles["recipe"]["post"][0]["roles"] = json!([]);
    assert_eq!(resolve(&composite, 0), resolve(&empty_roles, 0));
}

#[test]
fn reject_ambiguous_composite_targets_and_invalid_stages_at_save_and_render() {
    for post in [
        json!({"stage":"composite","roles":["foreground"],"effects":[bloom()]}),
        json!({"stage":"composite","roles":["background","subject","graphics","foreground"],"effects":[bloom()]}),
        json!({"stage":"role","effects":[bloom()]}),
        json!({"roles":[],"effects":[bloom()]}),
        json!({"stage":"role","roles":["foreground","foreground"],"effects":[bloom()]}),
        json!({"stage":"output","effects":[bloom()]}),
        json!({"stage":null,"roles":["foreground"],"effects":[bloom()]}),
    ] {
        let s = source(json!([post]));
        assert!(
            !issues(&s).is_empty(),
            "accepted invalid post target: {post}"
        );
        assert!(resolve(&s, 0)["error"].is_string());
    }
}

#[test]
fn composite_work_is_counted_once_and_accumulates_with_role_work() {
    let mut s = source(json!([
        {"stage":"role","roles":["background","subject","graphics","foreground"],"effects":[bloom(),bloom()]},
        {"stage":"composite","effects":[bloom(),bloom(),bloom(),bloom()]}
    ])); // 80 role passes + 40 composite passes.
    assert!(issues(&s).is_empty());
    assert!(resolve(&s, 0)["frame"].is_object());
    s["recipe"]["post"][1]["effects"]
        .as_array_mut()
        .unwrap()
        .push(bloom());
    assert!(!issues(&s).is_empty()); // 130 passes must not bypass the existing cap.
    assert!(resolve(&s, 0)["error"].is_string());
}

#[test]
fn stage_preserves_authored_group_order_and_song_sampled_seeds() {
    let grain = json!({"kind":"grain","amount":0.1,"fps":12});
    let s = source(json!([
        {"stage":"composite","effects":[grain]},
        {"roles":["foreground"],"effects":[bloom()]},
        {"stage":"composite","effects":[bloom(),grain]}
    ]));
    let post = resolve(&s, 2)["frame"]["recipePlan"]["post"].clone();
    assert_eq!(post[0]["stage"], "composite");
    assert_eq!(post[1]["stage"], "role");
    assert_eq!(post[2]["stage"], "composite");
    assert_eq!(post[0]["effects"][0]["seed"], 14); // 7 + floor((0.5 + 2/24) * 12)
    assert_eq!(post[2]["effects"][1]["seed"], 14);
    assert_eq!(post[1]["effects"][0]["seed"], 7);
    assert_eq!(post, resolve(&s, 3)["frame"]["recipePlan"]["post"]);
    assert_eq!(
        resolve(&s, 4)["frame"]["recipePlan"]["post"][0]["effects"][0]["seed"],
        15
    );
}
