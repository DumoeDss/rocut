use crate::model::Issue;
use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scene {
    id: String,
    name: String,
    is_main: bool,
    main_track_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneState {
    current_scene_id: String,
    scenes: Vec<Scene>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    scene_id: Option<String>,
    kind: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    id: String,
    scene_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    scene_state: SceneState,
    background: Option<Background>,
    tracks: Vec<Track>,
    markers: Vec<Marker>,
    previous_scene_state: Option<SceneState>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum Background {
    Color {
        color: String,
    },
    Blur {
        #[serde(rename = "blurIntensity")]
        blur_intensity: f64,
    },
}

fn validate(request: &Request) -> Vec<Issue> {
    let state = &request.scene_state;
    let mut issues = vec![];
    let valid_background = match &request.background {
        None => true,
        Some(Background::Color { color }) => !color.trim().is_empty(),
        Some(Background::Blur { blur_intensity }) => {
            blur_intensity.is_finite() && (0.0..=500.0).contains(blur_intensity)
        }
    };
    if !valid_background {
        issues.push(Issue::new(
            "background",
            "Background requires a nonempty color/gradient or blur intensity in 0..500",
        ));
    }
    let mut ids = BTreeSet::new();
    for scene in &state.scenes {
        if scene.id.is_empty() || scene.name.trim().is_empty() || !ids.insert(&scene.id) {
            issues.push(Issue::new(
                "sceneState.scenes",
                "Scenes require unique nonempty IDs and names",
            ));
        }
        if !request.tracks.iter().any(|t| {
            t.id == scene.main_track_id
                && t.kind == "video"
                && t.scene_id.as_ref() == Some(&scene.id)
        }) {
            issues.push(Issue::new(
                "sceneState.scenes",
                "Each scene needs its own canonical video main track",
            ));
        }
    }
    if state.scenes.iter().filter(|s| s.is_main).count() != 1
        || !ids.contains(&state.current_scene_id)
    {
        issues.push(Issue::new(
            "sceneState",
            "Exactly one main scene and a valid current scene are required",
        ));
    }
    if let Some(previous) = &request.previous_scene_state {
        for old in &previous.scenes {
            let next = state.scenes.iter().find(|s| s.id == old.id);
            if old.is_main && next.is_none_or(|s| !s.is_main) {
                issues.push(Issue::new(
                    "sceneState.scenes",
                    "Cannot remove or demote the main scene",
                ));
            }
            if next.is_some_and(|s| s.main_track_id != old.main_track_id) {
                issues.push(Issue::new(
                    "sceneState.scenes",
                    "Cannot replace an existing scene's canonical main track",
                ));
            }
        }
    }
    for track in &request.tracks {
        if track.scene_id.as_ref().is_none_or(|id| !ids.contains(id)) {
            issues.push(Issue::new(
                "tracks.sceneId",
                "Track references an unknown scene",
            ));
        }
    }
    for marker in &request.markers {
        if marker.scene_id.as_ref().is_none_or(|id| !ids.contains(id)) {
            issues.push(Issue::new(
                "markers.sceneId",
                "Marker references an unknown scene",
            ));
        }
    }
    issues
}

#[export]
pub fn validate_scene_state_json(input: String) -> String {
    let issues = match serde_json::from_str::<Request>(&input) {
        Ok(request) => validate(&request),
        Err(error) => vec![Issue::new(
            "sceneState",
            &format!("Invalid scene schema: {error}"),
        )],
    };
    serde_json::to_string(&issues).expect("scene issues serialize")
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Mutation {
    Create {
        id: String,
        name: String,
        #[serde(rename = "mainTrackId")]
        main_track_id: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Switch {
        id: String,
    },
    Delete {
        id: String,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanRequest {
    project_id: String,
    scene_state: SceneState,
    tracks: Vec<Track>,
    markers: Vec<Marker>,
    operation: Mutation,
}

fn plan(request: PlanRequest) -> Result<Value, String> {
    let mut state = request.scene_state;
    let mut operations = vec![];
    match request.operation {
        Mutation::Create {
            id,
            name,
            main_track_id,
        } => {
            if id.is_empty()
                || name.trim().is_empty()
                || main_track_id.is_empty()
                || state.scenes.iter().any(|s| s.id == id)
            {
                return Err("Scene ID/name must be nonempty and ID must be new".into());
            }
            operations.push(json!({"kind":"create-track","track":{"id":main_track_id,"sceneId":id,"kind":"video","name":"Main Track","hidden":false,"muted":false}}));
            state.scenes.push(Scene {
                id,
                name,
                is_main: false,
                main_track_id,
            });
        }
        Mutation::Rename { id, name } => {
            if name.trim().is_empty() {
                return Err("Scene name must not be empty".into());
            }
            state
                .scenes
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or("Scene not found")?
                .name = name;
        }
        Mutation::Switch { id } => {
            if !state.scenes.iter().any(|s| s.id == id) {
                return Err("Scene not found".into());
            }
            state.current_scene_id = id;
        }
        Mutation::Delete { id } => {
            let scene = state
                .scenes
                .iter()
                .find(|s| s.id == id)
                .ok_or("Scene not found")?;
            if scene.is_main {
                return Err("Cannot delete the main scene".into());
            }
            for track in &request.tracks {
                if track.scene_id.as_ref() == Some(&id) {
                    operations.push(json!({"kind":"delete-track","trackId":track.id}));
                }
            }
            for marker in &request.markers {
                if marker.scene_id.as_ref() == Some(&id) {
                    operations.push(json!({"kind":"delete-marker","markerId":marker.id}));
                }
            }
            state.scenes.retain(|s| s.id != id);
            if state.current_scene_id == id {
                state.current_scene_id = state
                    .scenes
                    .iter()
                    .find(|s| s.is_main)
                    .ok_or("Main scene missing")?
                    .id
                    .clone();
            }
        }
    }
    operations.push(json!({"kind":"update-project","projectId":request.project_id,"patch":{"sceneState":state}}));
    Ok(json!({"operations":operations}))
}

#[export]
pub fn plan_scene_mutation_json(input: String) -> String {
    let result = serde_json::from_str::<PlanRequest>(&input)
        .map_err(|e| e.to_string())
        .and_then(plan);
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error":error}).to_string(),
    }
}
