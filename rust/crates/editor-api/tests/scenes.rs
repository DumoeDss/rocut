use editor_api::{plan_scene_mutation_json, validate_scene_state_json};
use serde_json::{Value, json};

fn state() -> Value {
    json!({"currentSceneId":"main", "scenes":[{"id":"main","name":"Main","isMain":true,"mainTrackId":"main-track"}]})
}

#[test]
fn creates_typed_atomic_plan_and_refuses_deleting_main() {
    let mut request = json!({"projectId":"project","sceneState":state(),"tracks":[],"markers":[],"operation":{"kind":"create","id":"second","name":"Second","mainTrackId":"second-track"}});
    let result: Value =
        serde_json::from_str(&plan_scene_mutation_json(request.to_string())).unwrap();
    assert_eq!(result["operations"][0]["kind"], "create-track");
    assert_eq!(
        result["operations"][1]["patch"]["sceneState"]["scenes"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    request["operation"] = json!({"kind":"delete","id":"main"});
    let result: Value =
        serde_json::from_str(&plan_scene_mutation_json(request.to_string())).unwrap();
    assert!(result["error"].is_string());
}

#[test]
fn validates_membership_and_protects_main_identity() {
    let mut request = json!({"sceneState":state(),"previousSceneState":state(),"tracks":[{"id":"main-track","kind":"video","sceneId":"main"}],"markers":[]});
    assert_eq!(validate_scene_state_json(request.to_string()), "[]");
    request["tracks"][0]["sceneId"] = json!("missing");
    assert_ne!(validate_scene_state_json(request.to_string()), "[]");
    request["sceneState"]["scenes"][0]["mainTrackId"] = json!("replacement");
    assert!(validate_scene_state_json(request.to_string()).contains("Cannot replace"));
}

#[test]
fn validates_native_project_background() {
    let mut request = json!({"sceneState":state(),"tracks":[{"id":"main-track","kind":"video","sceneId":"main"}],"markers":[]});
    for background in [
        json!({"type":"color","color":"linear-gradient(90deg, red, blue)"}),
        json!({"type":"blur","blurIntensity":500}),
    ] {
        request["background"] = background;
        assert_eq!(validate_scene_state_json(request.to_string()), "[]");
    }
    for background in [
        json!({"type":"color","color":" "}),
        json!({"type":"blur","blurIntensity":-1}),
        json!({"type":"blur","blurIntensity":501}),
        json!({"type":"blur","blurIntensity":10,"extra":true}),
    ] {
        request["background"] = background;
        assert_ne!(validate_scene_state_json(request.to_string()), "[]");
    }
}
