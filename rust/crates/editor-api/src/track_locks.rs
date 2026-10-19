//! Platform-independent edit admission. Locks protect the pre-edit snapshot;
//! unlocking and editing in the same batch cannot bypass this boundary.
use bridge::export;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    tracks: Vec<Value>,
    clips: Vec<Value>,
    #[serde(default)]
    assets: Vec<Value>,
    #[serde(default)]
    motion_text_sequences: Vec<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    before: Snapshot,
    after: Snapshot,
}
fn keyed(values: &[Value]) -> Result<BTreeMap<&str, &Value>, String> {
    let mut map = BTreeMap::new();
    for value in values {
        let id = value["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("invalid entity id")?;
        if map.insert(id, value).is_some() {
            return Err("duplicate entity id".into());
        }
    }
    Ok(map)
}
fn metadata(value: &Value) -> Value {
    let mut value = value.clone();
    if let Some(object) = value.as_object_mut() {
        for key in ["locked", "muted", "hidden"] {
            object.remove(key);
        }
    }
    value
}
fn validate(request: Request) -> Result<Vec<Value>, String> {
    let before = request.before;
    let after = request.after;
    let old_tracks = keyed(&before.tracks)?;
    let new_tracks = keyed(&after.tracks)?;
    let old_clips = keyed(&before.clips)?;
    let new_clips = keyed(&after.clips)?;
    let old_assets = keyed(&before.assets)?;
    let new_assets = keyed(&after.assets)?;
    let old_sequences = keyed(&before.motion_text_sequences)?;
    let new_sequences = keyed(&after.motion_text_sequences)?;
    for track in before.tracks.iter().chain(&after.tracks) {
        if track.get("locked").is_some_and(|v| !v.is_boolean()) {
            return Err("locked must be boolean".into());
        }
    }
    let mut issues = Vec::new();
    for (id, track) in &old_tracks {
        if track["locked"] != true {
            continue;
        }
        let changed_track = new_tracks
            .get(id)
            .is_none_or(|next| metadata(track) != metadata(next));
        // Compare relative order only among surviving pre-existing tracks. New
        // lanes and unrelated lane deletion do not constitute a locked move.
        let relative = |tracks: &[Value]| -> Vec<String> {
            tracks
                .iter()
                .filter_map(|t| t["id"].as_str())
                .filter(|other| old_tracks.contains_key(other) && new_tracks.contains_key(other))
                .filter(|other| {
                    *other == *id || {
                        let old = old_tracks[other];
                        old.get("sceneId") == track.get("sceneId")
                            && old.get("lane") == track.get("lane")
                    }
                })
                .map(str::to_owned)
                .collect()
        };
        let old_order = relative(&before.tracks);
        let new_order = relative(&after.tracks);
        let side = |order: &[String]| {
            order
                .iter()
                .take_while(|other| other.as_str() != *id)
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
        };
        let reordered = side(&old_order) != side(&new_order);
        let locked_clips = old_clips
            .iter()
            .filter(|(_, clip)| clip["trackId"] == *id)
            .collect::<Vec<_>>();
        let changed_clips = locked_clips
            .iter()
            .any(|(clip_id, clip)| new_clips.get(*clip_id) != Some(*clip))
            || new_clips.iter().any(|(clip_id, clip)| {
                clip["trackId"] == *id && old_clips.get(clip_id) != Some(clip)
            });
        let changed_dependencies = locked_clips.iter().any(|(_, clip)| {
            let sequence_id = clip["content"]["sequenceId"].as_str();
            let sequence = sequence_id.and_then(|id| old_sequences.get(id));
            let mut asset_ids = std::collections::BTreeSet::new();
            if let Some(id) = clip["assetId"].as_str() {
                asset_ids.insert(id);
            }
            if let Some(sequence) = sequence {
                if let Some(id) = sequence["audioBinding"]["assetId"].as_str() {
                    asset_ids.insert(id);
                }
                if let Some(fonts) = sequence["fonts"].as_array() {
                    for font in fonts {
                        if font["source"] == "project" {
                            if let Some(id) = font["assetId"].as_str() {
                                asset_ids.insert(id);
                            }
                        }
                    }
                }
            }
            let asset_changed = asset_ids.into_iter().any(|asset_id| {
                let old = old_assets.get(asset_id);
                let new = new_assets.get(asset_id);
                // Cache/facts enrichment is not editing. Source identity or
                // attachment removal/relink is; never silently alter a lock.
                match (old, new) {
                    (Some(old), Some(new)) => {
                        old.get("kind") != new.get("kind")
                            || old
                                .get("sourceSha256")
                                .filter(|value| !value.is_null())
                                .is_some_and(|digest| Some(digest) != new.get("sourceSha256"))
                    }
                    (Some(_), None) => true,
                    _ => false,
                }
            });
            let sequence_changed = sequence_id.is_some_and(|sequence_id| {
                old_sequences.get(sequence_id) != new_sequences.get(sequence_id)
            });
            asset_changed || sequence_changed
        });
        if changed_track || reordered || changed_clips || changed_dependencies {
            issues.push(json!({"path":format!("$.tracks.{id}"),"message":"Track is locked; unlock it in a separate edit before changing its content or order.","trackId":id}));
        }
    }
    Ok(issues)
}
#[export]
pub fn validate_track_locks_json(input: String) -> String {
    let result = if input.len() > 64 * 1024 * 1024 {
        Err("track lock input limit".into())
    } else {
        serde_json::from_str::<Request>(&input)
            .map_err(|_| "invalid track lock input".into())
            .and_then(validate)
    };
    match result {
        Ok(issues) => json!(issues).to_string(),
        Err(message) => json!([{"path":"$","message":message}]).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Value {
        json!({"tracks":[{"id":"a","locked":true,"kind":"video","lane":"overlay"},{"id":"b","kind":"video","lane":"overlay"}],"clips":[{"id":"clip","trackId":"a","assetId":"asset","duration":12}],"assets":[{"id":"asset","kind":"video","sourceSha256":"old"}]})
    }
    fn issues(before: Value, after: Value) -> Value {
        serde_json::from_str(&validate_track_locks_json(
            json!({"before":before,"after":after}).to_string(),
        ))
        .unwrap()
    }
    #[test]
    fn protects_all_clip_changes_and_unlock_cannot_bypass() {
        for field in [
            "duration",
            "startTime",
            "trimStart",
            "assetId",
            "editing",
            "trackId",
        ] {
            let before = snapshot();
            let mut after = before.clone();
            after["clips"][0][field] = json!("changed");
            after["tracks"][0]["locked"] = json!(false);
            assert_eq!(
                issues(before, after).as_array().unwrap().len(),
                1,
                "{field}"
            );
        }
        let before = snapshot();
        let mut after = before.clone();
        after["clips"] = json!([]);
        assert_eq!(issues(before, after).as_array().unwrap().len(), 1);
    }
    #[test]
    fn accepts_unlock_visibility_and_unrelated_insert_delete_but_not_reorder() {
        let before = snapshot();
        let mut after = before.clone();
        after["tracks"][0]["locked"] = json!(false);
        after["tracks"][0]["muted"] = json!(true);
        after["tracks"][0]["hidden"] = json!(true);
        assert_eq!(issues(before.clone(), after), json!([]));
        let mut after = before.clone();
        after["tracks"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"id":"new","kind":"video","lane":"overlay"}));
        assert_eq!(issues(before.clone(), after), json!([]));
        let mut after = before.clone();
        after["tracks"].as_array_mut().unwrap().pop();
        assert_eq!(issues(before.clone(), after), json!([]));
        let mut after = before.clone();
        after["tracks"].as_array_mut().unwrap().reverse();
        assert_eq!(issues(before, after).as_array().unwrap().len(), 1);
    }
    #[test]
    fn protects_track_removal_source_relink_and_shared_sequence() {
        let before = snapshot();
        for key in ["tracks", "assets"] {
            let mut after = before.clone();
            after[key] = json!([]);
            assert!(!issues(before.clone(), after).as_array().unwrap().is_empty());
        }
        let mut after = before.clone();
        after["assets"][0]["sourceSha256"] = json!("new");
        assert_eq!(issues(before, after).as_array().unwrap().len(), 1);
        let mut before = snapshot();
        before["clips"][0]["content"] = json!({"kind":"motion-text","sequenceId":"s"});
        before["motionTextSequences"] = json!([{"id":"s","revision":1}]);
        let mut after = before.clone();
        after["motionTextSequences"][0]["revision"] = json!(2);
        assert_eq!(issues(before, after).as_array().unwrap().len(), 1);
    }
    #[test]
    fn legacy_absence_is_unlocked_and_invalid_values_fail_closed() {
        let mut before = snapshot();
        before["tracks"][0]
            .as_object_mut()
            .unwrap()
            .remove("locked");
        let mut after = before.clone();
        after["clips"] = json!([]);
        assert_eq!(issues(before.clone(), after), json!([]));
        before["tracks"][0]["locked"] = json!("true");
        assert!(
            !issues(before.clone(), before)
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn accepts_first_source_identity_enrichment_but_not_known_identity_changes() {
        let mut before = snapshot();
        before["assets"][0]
            .as_object_mut()
            .unwrap()
            .remove("sourceSha256");
        let mut after = before.clone();
        after["assets"][0]["sourceSha256"] = json!("known");
        assert_eq!(issues(before, after.clone()), json!([]));
        for replacement in [json!("different"), Value::Null] {
            let mut changed = after.clone();
            changed["assets"][0]["sourceSha256"] = replacement;
            assert_eq!(issues(after.clone(), changed).as_array().unwrap().len(), 1);
        }
        let mut changed = after.clone();
        changed["assets"][0]
            .as_object_mut()
            .unwrap()
            .remove("sourceSha256");
        assert_eq!(issues(after, changed).as_array().unwrap().len(), 1);
    }
    #[test]
    fn protects_motion_text_audio_and_project_fonts_without_blocking_same_sources() {
        let mut before = snapshot();
        before["clips"][0]["content"] = json!({"kind":"motion-text","sequenceId":"sequence"});
        before["motionTextSequences"] = json!([{"id":"sequence","audioBinding":{"assetId":"audio"},"fonts":[{"source":"project","assetId":"font"}]}]);
        before["assets"].as_array_mut().unwrap().extend([
            json!({"id":"audio","sourceSha256":"audio-hash"}),
            json!({"id":"font","sourceSha256":"font-hash"}),
        ]);
        assert_eq!(issues(before.clone(), before.clone()), json!([]));
        for index in [1, 2] {
            let mut changed = before.clone();
            changed["assets"][index]["sourceSha256"] = json!("changed");
            assert_eq!(issues(before.clone(), changed).as_array().unwrap().len(), 1);
            let mut removed = before.clone();
            removed["assets"].as_array_mut().unwrap().remove(index);
            assert_eq!(issues(before.clone(), removed).as_array().unwrap().len(), 1);
        }
    }
}
