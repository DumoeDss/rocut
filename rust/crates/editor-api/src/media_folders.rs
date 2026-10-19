use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Folder {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Assignment {
    asset_id: String,
    folder_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    project_id: String,
    folders: Vec<Folder>,
    assignments: Vec<Assignment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    project_id: String,
    #[serde(default)]
    media_folders: Option<State>,
    asset_ids: Vec<String>,
    #[serde(default)]
    operation: Option<Mutation>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Mutation {
    Create {
        id: String,
        name: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
    },
    Rename {
        id: String,
        name: String,
    },
    MoveFolder {
        id: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
    },
    MoveAssets {
        #[serde(rename = "assetIds")]
        asset_ids: Vec<String>,
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    },
    Dissolve {
        id: String,
    },
}

fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 200 && !id.chars().any(char::is_control)
}

fn validate(state: &State, project: &str, assets: &[String]) -> Result<(), String> {
    if !valid_id(project) || state.project_id != project {
        return Err("Media folders belong to another project".into());
    }
    if state.folders.len() > 4096 || state.assignments.len() > 100_000 || assets.len() > 100_000 {
        return Err("Media folder state exceeds its limit".into());
    }
    let mut folders = BTreeMap::new();
    for folder in &state.folders {
        if !valid_id(&folder.id)
            || folder.name.trim().is_empty()
            || folder.name.len() > 256
            || folders.insert(folder.id.as_str(), folder).is_some()
        {
            return Err("Folders require unique stable IDs and nonempty bounded names".into());
        }
    }
    for folder in &state.folders {
        let mut visited = BTreeSet::new();
        let mut current = Some(folder.id.as_str());
        while let Some(id) = current {
            if !visited.insert(id) {
                return Err("Folder hierarchy contains a cycle".into());
            }
            let item = folders
                .get(id)
                .ok_or("Folder references an unknown parent")?;
            current = item.parent_id.as_deref();
        }
    }
    let assets: BTreeSet<_> = assets.iter().map(String::as_str).collect();
    let mut assigned = BTreeSet::new();
    for item in &state.assignments {
        if !assets.contains(item.asset_id.as_str())
            || !folders.contains_key(item.folder_id.as_str())
            || !assigned.insert(&item.asset_id)
        {
            return Err("Folder assignment references unknown or duplicate project media".into());
        }
    }
    Ok(())
}

fn plan(request: Request) -> Result<Value, String> {
    let mut state = request.media_folders.unwrap_or(State {
        project_id: request.project_id.clone(),
        folders: vec![],
        assignments: vec![],
    });
    validate(&state, &request.project_id, &request.asset_ids)?;
    match request.operation.ok_or("Folder operation is required")? {
        Mutation::Create {
            id,
            name,
            parent_id,
        } => state.folders.push(Folder {
            id,
            name: name.trim().into(),
            parent_id,
        }),
        Mutation::Rename { id, name } => {
            state
                .folders
                .iter_mut()
                .find(|folder| folder.id == id)
                .ok_or("Unknown folder")?
                .name = name.trim().into();
        }
        Mutation::MoveFolder { id, parent_id } => {
            state
                .folders
                .iter_mut()
                .find(|folder| folder.id == id)
                .ok_or("Unknown folder")?
                .parent_id = parent_id;
        }
        Mutation::MoveAssets {
            asset_ids,
            folder_id,
        } => {
            if folder_id
                .as_ref()
                .is_some_and(|id| !state.folders.iter().any(|f| &f.id == id))
            {
                return Err("Unknown destination folder".into());
            }
            if asset_ids.len() > 100_000 {
                return Err("Media move exceeds its limit".into());
            }
            let known: BTreeSet<_> = request.asset_ids.iter().collect();
            let selected: BTreeSet<_> = asset_ids.into_iter().collect();
            if selected.iter().any(|id| !known.contains(id)) {
                return Err("Cannot move media from another project".into());
            }
            state
                .assignments
                .retain(|item| !selected.contains(&item.asset_id));
            if let Some(folder_id) = folder_id {
                for asset_id in selected {
                    state.assignments.push(Assignment {
                        asset_id,
                        folder_id: folder_id.clone(),
                    });
                }
            }
        }
        Mutation::Dissolve { id } => {
            let parent = state
                .folders
                .iter()
                .find(|f| f.id == id)
                .ok_or("Unknown folder")?
                .parent_id
                .clone();
            state.folders.retain(|folder| folder.id != id);
            for folder in &mut state.folders {
                if folder.parent_id.as_ref() == Some(&id) {
                    folder.parent_id = parent.clone();
                }
            }
            for assignment in &mut state.assignments {
                if assignment.folder_id == id {
                    assignment.folder_id = parent.clone().unwrap_or_default();
                }
            }
            state.assignments.retain(|item| !item.folder_id.is_empty());
        }
    }
    validate(&state, &request.project_id, &request.asset_ids)?;
    Ok(
        json!({ "operations": [{ "kind": "update-project", "projectId": request.project_id,
        "patch": { "mediaFolders": state } }] }),
    )
}

#[export]
pub fn plan_media_folder_mutation_json(input: String) -> String {
    let result = serde_json::from_str::<Request>(&input)
        .map_err(|e| e.to_string())
        .and_then(plan);
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error": error}).to_string(),
    }
}

#[export]
pub fn validate_media_folders_json(input: String) -> String {
    let result = serde_json::from_str::<Request>(&input)
        .map_err(|e| e.to_string())
        .and_then(|r| match r.media_folders {
            Some(state) => validate(&state, &r.project_id, &r.asset_ids),
            None => Ok(()),
        });
    match result {
        Ok(()) => "[]".into(),
        Err(error) => json!([{"path":"mediaFolders", "message":error}]).to_string(),
    }
}
