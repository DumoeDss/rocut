//! Final replacement guard. The caller must pin snapshot and bytes inside its shared write queue.
use bridge::export;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Target {
    asset_id: String,
    byte_length: u64,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    intent_id: String,
    idempotency_key: String,
    execution_hash: String,
    project_id: String,
    scene_id: String,
    expected_revision: u64,
    target: Target,
    clips: Vec<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    request: Request,
    project: Value,
    revision: u64,
    assets: Vec<Value>,
    tracks: Vec<Value>,
    clips: Vec<Value>,
    media_metadata: Value,
}
fn text(s: &str) -> bool {
    !s.is_empty() && s.len() <= 500 && !s.chars().any(char::is_control)
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn guard(input: &str, bytes: &[u8]) -> Result<Value, String> {
    if input.len() > 4 * 1024 * 1024 {
        return Err("replacement-input-limit".into());
    }
    let input: Input = serde_json::from_str(input).map_err(|_| "replacement-input-invalid")?;
    let r = input.request;
    if r.idempotency_key != format!("replacement:{}:{}", r.intent_id, r.execution_hash) {
        return Err("replacement-idempotency-conflict".into());
    }
    if r.schema_version != 1
        || ![
            &r.intent_id,
            &r.idempotency_key,
            &r.project_id,
            &r.scene_id,
            &r.target.asset_id,
        ]
        .iter()
        .all(|s| text(s))
        || !hash(&r.execution_hash)
        || !hash(&r.target.sha256)
        || r.clips.is_empty()
        || r.clips.len() > 10000
    {
        return Err("replacement-request-invalid".into());
    }
    if input.revision != r.expected_revision
        || input.revision >= 9007199254740991
        || input.project["id"] != r.project_id
        || input.project["sceneState"]["currentSceneId"] != r.scene_id
    {
        return Err("replacement-context-conflict".into());
    }
    if r.target.byte_length == 0
        || r.target.byte_length > 1024 * 1024 * 1024
        || bytes.len() as u64 != r.target.byte_length
        || format!("{:x}", Sha256::digest(bytes)) != r.target.sha256
    {
        return Err("replacement-media-conflict".into());
    }
    let target = input
        .assets
        .iter()
        .find(|a| a["id"] == r.target.asset_id)
        .ok_or("replacement-target-missing")?;
    let kind = target["kind"].as_str().ok_or("replacement-target-kind")?;
    if input.media_metadata["id"] != r.target.asset_id
        || input.media_metadata["type"] != target["kind"]
    {
        return Err("replacement-media-metadata-conflict".into());
    }
    if !["image", "audio", "video"].contains(&kind) {
        return Err("replacement-target-kind".into());
    }
    let mut selected = HashSet::new();
    let mut operations = Vec::new();
    for expected in &r.clips {
        let id = expected["id"]
            .as_str()
            .filter(|s| text(s))
            .ok_or("replacement-clip-invalid")?;
        if !selected.insert(id) {
            return Err("replacement-clip-duplicate".into());
        }
        let actual = input
            .clips
            .iter()
            .find(|c| c["id"] == id)
            .ok_or("replacement-clip-missing")?;
        if actual != expected {
            return Err("replacement-clip-conflict".into());
        }
        let track = input
            .tracks
            .iter()
            .find(|t| t["id"] == actual["trackId"])
            .ok_or("replacement-track-missing")?;
        if track["sceneId"] != r.scene_id {
            return Err("replacement-scene-conflict".into());
        }
        let previous = input
            .assets
            .iter()
            .find(|a| a["id"] == actual["assetId"])
            .ok_or("replacement-source-missing")?;
        if previous["kind"] != target["kind"] || actual["assetId"] == r.target.asset_id {
            return Err("replacement-kind-or-noop".into());
        }
        operations
            .push(json!({"kind":"update-clip","clipId":id,"patch":{"assetId":r.target.asset_id}}));
    }
    Ok(
        json!({"schemaVersion":1,"status":"admitted","intentId":r.intent_id,"executionHash":r.execution_hash,"beforeRevision":r.expected_revision,"batch":{"expectedRevision":r.expected_revision,"idempotencyKey":r.idempotency_key,"operations":operations}}),
    )
}
#[export]
pub fn resolve_timeline_replacement_bytes(input: Vec<u8>) -> String {
    let result = (|| {
        if input.len() < 4 || input.len() as u64 > 1024 * 1024 * 1024 + 4 * 1024 * 1024 + 4 {
            return Err("replacement-envelope-limit".into());
        }
        let length = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
        if length == 0 || length > 4 * 1024 * 1024 || length + 4 > input.len() {
            return Err("replacement-envelope-invalid".into());
        }
        let header =
            std::str::from_utf8(&input[4..4 + length]).map_err(|_| "replacement-envelope-utf8")?;
        guard(header, &input[4 + length..])
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(code) => {
            json!({"schemaVersion":1,"status":"rejected","error":{"code":code}}).to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> Value {
        let digest = format!("{:x}", Sha256::digest(b"actual-media"));
        let execution = "a".repeat(64);
        let clip = json!({"id":"clip","trackId":"track","assetId":"old","startTime":0,"duration":100,"trimStart":0,"trimEnd":0,"editing":{"opacity":0.5}});
        json!({"request":{"schemaVersion":1,"intentId":"intent","idempotencyKey":format!("replacement:intent:{execution}"),"executionHash":execution,"projectId":"project","sceneId":"scene","expectedRevision":2,"target":{"assetId":"new","byteLength":12,"sha256":digest},"clips":[clip.clone()]},"project":{"id":"project","sceneState":{"currentSceneId":"scene"}},"revision":2,"assets":[{"id":"old","kind":"video"},{"id":"new","kind":"video"}],"tracks":[{"id":"track","sceneId":"scene"}],"clips":[clip],"mediaMetadata":{"id":"new","type":"video"}})
    }
    #[test]
    fn only_asset_id_changes() {
        let out = guard(&input().to_string(), b"actual-media").unwrap();
        assert_eq!(
            out["batch"]["operations"],
            json!([{"kind":"update-clip","clipId":"clip","patch":{"assetId":"new"}}])
        );
    }
    #[test]
    fn actual_bytes_not_declared_hash() {
        assert!(guard(&input().to_string(), b"wrong-media!").is_err());
    }
    #[test]
    fn complete_clip_and_revision_guard() {
        let mut i = input();
        i["clips"][0]["editing"]["opacity"] = json!(0.9);
        assert!(guard(&i.to_string(), b"actual-media").is_err());
        let mut i = input();
        i["revision"] = json!(3);
        assert!(guard(&i.to_string(), b"actual-media").is_err());
    }
    #[test]
    fn idempotency_is_bound_to_execution() {
        let mut i = input();
        i["request"]["executionHash"] = json!("b".repeat(64));
        assert!(guard(&i.to_string(), b"actual-media").is_err());
    }
    #[test]
    fn duplicate_and_scene_and_kind_refused() {
        let mut i = input();
        let clip = i["request"]["clips"][0].clone();
        i["request"]["clips"].as_array_mut().unwrap().push(clip);
        assert!(guard(&i.to_string(), b"actual-media").is_err());
        let mut i = input();
        i["tracks"][0]["sceneId"] = json!("other");
        assert!(guard(&i.to_string(), b"actual-media").is_err());
        let mut i = input();
        i["assets"][1]["kind"] = json!("audio");
        assert!(guard(&i.to_string(), b"actual-media").is_err());
    }
}
