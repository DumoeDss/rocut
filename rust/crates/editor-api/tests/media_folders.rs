use editor_api::{plan_media_folder_mutation_json, validate_media_folders_json};
use serde_json::{Value, json};

fn apply(state: Value, operation: Value) -> Value {
    let request = json!({"projectId":"project", "mediaFolders":state, "assetIds":["asset", "other"], "operation":operation});
    serde_json::from_str(&plan_media_folder_mutation_json(request.to_string())).unwrap()
}
fn next(state: Value, operation: Value) -> Value {
    let result = apply(state, operation);
    assert!(result.get("error").is_none(), "{result}");
    result["operations"][0]["patch"]["mediaFolders"].clone()
}

#[test]
fn folders_roundtrip_rename_move_and_dissolve_without_media_deletion() {
    let state = next(
        Value::Null,
        json!({"kind":"create", "id":"root", "name":"Root"}),
    );
    let state = next(
        state,
        json!({"kind":"create", "id":"child", "name":"Child", "parentId":"root"}),
    );
    let state = next(
        state,
        json!({"kind":"move-assets", "assetIds":["asset"], "folderId":"child"}),
    );
    let state: Value = serde_json::from_str(&state.to_string()).unwrap();
    let state = next(
        state,
        json!({"kind":"rename", "id":"child", "name":"Renamed"}),
    );
    assert_eq!(state["folders"][1]["id"], "child");
    assert_eq!(state["folders"][1]["name"], "Renamed");
    let state = next(state, json!({"kind":"dissolve", "id":"child"}));
    assert_eq!(state["assignments"][0]["folderId"], "root");
    let result = apply(state.clone(), json!({"kind":"dissolve", "id":"root"}));
    assert_eq!(result["operations"].as_array().unwrap().len(), 1);
    assert_eq!(result["operations"][0]["kind"], "update-project");
    assert_eq!(
        result["operations"][0]["patch"]["mediaFolders"]["assignments"],
        json!([])
    );
    let state = next(state, json!({"kind":"move-assets", "assetIds":["asset"]}));
    assert_eq!(state["assignments"], json!([]));
}

#[test]
fn rejects_cycles_unknown_references_cross_project_and_duplicate_ids() {
    let state = next(
        Value::Null,
        json!({"kind":"create", "id":"root", "name":"Root"}),
    );
    let state = next(
        state,
        json!({"kind":"create", "id":"child", "name":"Child", "parentId":"root"}),
    );
    for operation in [
        json!({"kind":"move-folder", "id":"root", "parentId":"child"}),
        json!({"kind":"move-folder", "id":"root", "parentId":"root"}),
        json!({"kind":"move-folder", "id":"root", "parentId":"missing"}),
        json!({"kind":"move-assets", "assetIds":["foreign"], "folderId":"root"}),
        json!({"kind":"create", "id":"root", "name":"Duplicate"}),
        json!({"kind":"rename", "id":"root", "name":"  "}),
    ] {
        assert!(apply(state.clone(), operation).get("error").is_some());
    }
    let mut foreign = state.clone();
    foreign["projectId"] = json!("foreign");
    assert!(
        apply(foreign, json!({"kind":"rename", "id":"root", "name":"No"}))
            .get("error")
            .is_some()
    );
    let moved = next(state, json!({"kind":"move-folder", "id":"child"}));
    assert!(moved["folders"][1].get("parentId").is_none());
}

#[test]
fn legacy_state_is_optional_and_invalid_loaded_state_fails_closed() {
    let request = json!({"projectId":"project", "assetIds":[]});
    assert_eq!(validate_media_folders_json(request.to_string()), "[]");
    let invalid = json!({"projectId":"project", "assetIds":[], "mediaFolders":{
        "projectId":"project", "folders":[], "assignments":[{"assetId":"missing", "folderId":"missing"}]
    }});
    let issues: Value =
        serde_json::from_str(&validate_media_folders_json(invalid.to_string())).unwrap();
    assert!(!issues.as_array().unwrap().is_empty());
}
