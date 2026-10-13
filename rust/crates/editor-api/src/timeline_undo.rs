//! Narrow inverse planning. Authorization belongs to the trusted caller, not this transport.
use bridge::export;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const MAX_SAFE: u64 = 9007199254740991;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClipUndo {
    clip_id: String,
    after_digest: String,
    after_asset_id: String,
    before_asset_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreAsset {
    asset_id: String,
    byte_length: u64,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    intent_id: String,
    original_operation_id: String,
    execution_hash: String,
    idempotency_key: String,
    project_id: String,
    scene_id: String,
    expected_revision: u64,
    kind: String,
    clips: Vec<ClipUndo>,
    #[serde(default)]
    restore_assets: Vec<RestoreAsset>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attachment {
    asset_id: String,
    metadata: Value,
    byte_length: usize,
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
    attachments: Vec<Attachment>,
}
fn text(s: &str) -> bool {
    !s.is_empty() && s.len() <= 500 && !s.chars().any(char::is_control)
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// Versioned cross-language digest: typed UTF-8 framing; numbers are normalized f64 bits.
fn canonical(v: &Value, out: &mut Vec<u8>) -> Result<(), String> {
    match v {
        Value::Null => out.push(b'n'),
        Value::Bool(b) => out.push(if *b { b't' } else { b'f' }),
        Value::Number(n) => {
            let mut f = n.as_f64().ok_or("undo-number-invalid")?;
            if !f.is_finite() || (f.fract() == 0.0 && f.abs() > MAX_SAFE as f64) {
                return Err("undo-number-unsafe".into());
            }
            if f == 0.0 {
                f = 0.0;
            }
            out.extend_from_slice(format!("d{:016x}", f.to_bits()).as_bytes());
        }
        Value::String(s) => {
            out.extend_from_slice(format!("s{}:", s.len()).as_bytes());
            out.extend_from_slice(s.as_bytes());
        }
        Value::Array(a) => {
            out.extend_from_slice(format!("a{}:", a.len()).as_bytes());
            for item in a {
                canonical(item, out)?;
            }
        }
        Value::Object(o) => {
            out.extend_from_slice(format!("o{}:", o.len()).as_bytes());
            let mut keys: Vec<_> = o.keys().collect();
            keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            for key in keys {
                canonical(&Value::String(key.clone()), out)?;
                canonical(&o[key], out)?;
            }
        }
    }
    Ok(())
}
fn digest(v: &Value) -> Result<String, String> {
    let mut bytes = b"rocut-json-f64be-v1:".to_vec();
    canonical(v, &mut bytes)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn guard(header: &str, bytes: &[u8]) -> Result<Value, String> {
    let i: Input = serde_json::from_str(header).map_err(|_| "undo-input-invalid")?;
    let r = i.request;
    if r.schema_version != 1
        || ![
            &r.intent_id,
            &r.original_operation_id,
            &r.project_id,
            &r.scene_id,
        ]
        .iter()
        .all(|s| text(s))
        || !hash(&r.execution_hash)
        || r.idempotency_key != format!("undo:{}:{}", r.intent_id, r.execution_hash)
        || r.clips.is_empty()
        || r.clips.len() > 10000
        || r.restore_assets.len() > 10000
        || !["placement", "replacement"].contains(&r.kind.as_str())
    {
        return Err("undo-request-invalid".into());
    }
    if i.revision != r.expected_revision
        || i.revision >= MAX_SAFE
        || i.project["id"] != r.project_id
        || i.project["sceneState"]["currentSceneId"] != r.scene_id
    {
        return Err("undo-context-conflict".into());
    }
    if r.kind == "placement"
        && (r.clips.len() != 1 || !r.restore_assets.is_empty() || !i.attachments.is_empty())
    {
        return Err("undo-placement-shape".into());
    }
    let mut media = HashMap::new();
    let mut offset = 0usize;
    for a in &i.attachments {
        let end = offset
            .checked_add(a.byte_length)
            .ok_or("undo-media-limit")?;
        if a.byte_length == 0 || end > bytes.len() || media.contains_key(&a.asset_id) {
            return Err("undo-media-invalid".into());
        }
        media.insert(a.asset_id.clone(), (a, &bytes[offset..end]));
        offset = end;
    }
    if offset != bytes.len() {
        return Err("undo-media-extra".into());
    }
    let mut restore = HashMap::new();
    for a in &r.restore_assets {
        if !text(&a.asset_id)
            || !hash(&a.sha256)
            || a.byte_length == 0
            || a.byte_length > 1024 * 1024 * 1024
            || restore.insert(a.asset_id.clone(), a).is_some()
        {
            return Err("undo-restore-invalid".into());
        }
        let (actual, data) = media.get(&a.asset_id).ok_or("undo-media-missing")?;
        if data.len() as u64 != a.byte_length
            || format!("{:x}", Sha256::digest(data)) != a.sha256
            || actual.metadata["id"] != a.asset_id
        {
            return Err("undo-media-conflict".into());
        }
    }
    if media.len() != restore.len() {
        return Err("undo-media-extra".into());
    }
    let mut seen = HashSet::new();
    let mut used = HashSet::new();
    let mut operations = Vec::new();
    for c in &r.clips {
        if !text(&c.clip_id)
            || !text(&c.after_asset_id)
            || !hash(&c.after_digest)
            || !seen.insert(c.clip_id.clone())
        {
            return Err("undo-clip-invalid".into());
        }
        let found: Vec<_> = i
            .clips
            .iter()
            .filter(|clip| clip["id"] == c.clip_id)
            .collect();
        if found.len() != 1 {
            return Err("undo-clip-missing-or-duplicate".into());
        }
        let clip = found[0];
        if clip["assetId"] != c.after_asset_id || digest(clip)? != c.after_digest {
            return Err("undo-current-after-conflict".into());
        }
        let track = i
            .tracks
            .iter()
            .find(|t| t["id"] == clip["trackId"])
            .ok_or("undo-track-missing")?;
        if track["sceneId"] != r.scene_id {
            return Err("undo-scene-conflict".into());
        }
        let after = i
            .assets
            .iter()
            .find(|a| a["id"] == c.after_asset_id)
            .ok_or("undo-after-asset-missing")?;
        let kind = after["kind"].as_str().ok_or("undo-kind-invalid")?;
        if !["image", "video", "audio"].contains(&kind) {
            return Err("undo-kind-invalid".into());
        }
        if r.kind == "placement" {
            if c.before_asset_id.is_some() {
                return Err("undo-placement-shape".into());
            }
            operations.push(json!({"kind":"delete-clip","clipId":c.clip_id}));
        } else {
            let previous = c
                .before_asset_id
                .as_ref()
                .filter(|s| text(s) && **s != c.after_asset_id)
                .ok_or("undo-before-asset-invalid")?;
            let old = i
                .assets
                .iter()
                .find(|a| a["id"] == *previous)
                .ok_or("undo-before-asset-missing")?;
            let (attachment, _) = media.get(previous).ok_or("undo-media-missing")?;
            if old["kind"] != kind || attachment.metadata["type"] != kind {
                return Err("undo-kind-conflict".into());
            }
            used.insert(previous.clone());
            operations.push(
                json!({"kind":"update-clip","clipId":c.clip_id,"patch":{"assetId":previous}}),
            );
        }
    }
    if used.len() != restore.len() || used.iter().any(|id| !restore.contains_key(id)) {
        return Err("undo-restore-set-conflict".into());
    }
    Ok(
        json!({"schemaVersion":1,"status":"admitted","intentId":r.intent_id,"originalOperationId":r.original_operation_id,"executionHash":r.execution_hash,"beforeRevision":r.expected_revision,"batch":{"expectedRevision":r.expected_revision,"idempotencyKey":r.idempotency_key,"operations":operations}}),
    )
}
#[export]
pub fn resolve_timeline_undo_bytes(input: Vec<u8>) -> String {
    let result = (|| {
        if input.len() < 4 || input.len() as u64 > 1024 * 1024 * 1024 + 4 * 1024 * 1024 + 4 {
            return Err("undo-envelope-limit".into());
        }
        let len = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
        if len == 0 || len > 4 * 1024 * 1024 || len + 4 > input.len() {
            return Err("undo-envelope-invalid".into());
        }
        let header = std::str::from_utf8(&input[4..4 + len]).map_err(|_| "undo-envelope-utf8")?;
        guard(header, &input[4 + len..])
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
        let clip = json!({"id":"clip","trackId":"track","assetId":"new","startTime":0,"duration":100,"trimStart":0,"trimEnd":0,"editing":{"opacity":0.5}});
        json!({"request":{"schemaVersion":1,"intentId":"intent","originalOperationId":"original","executionHash":"a".repeat(64),"idempotencyKey":format!("undo:intent:{}","a".repeat(64)),"projectId":"project","sceneId":"scene","expectedRevision":2,"kind":"placement","clips":[{"clipId":"clip","afterAssetId":"new","afterDigest":digest(&clip).unwrap()}]},"project":{"id":"project","sceneState":{"currentSceneId":"scene"}},"revision":2,"assets":[{"id":"new","kind":"video"},{"id":"old","kind":"video"}],"tracks":[{"id":"track","sceneId":"scene"}],"clips":[clip],"attachments":[]})
    }
    #[test]
    fn placement_only_deletes_exact_original_clip() {
        let i = input();
        let r = guard(&i.to_string(), b"").unwrap();
        assert_eq!(
            r["batch"]["operations"],
            json!([{"kind":"delete-clip","clipId":"clip"}])
        );
    }
    #[test]
    fn replacement_restores_only_each_asset_with_real_bytes() {
        let mut i = input();
        i["request"]["kind"] = json!("replacement");
        i["request"]["clips"][0]["beforeAssetId"] = json!("old");
        i["request"]["restoreAssets"] = json!([{"assetId":"old","byteLength":5,"sha256":format!("{:x}",Sha256::digest(b"bytes"))}]);
        i["attachments"] =
            json!([{"assetId":"old","metadata":{"id":"old","type":"video"},"byteLength":5}]);
        assert_eq!(
            guard(&i.to_string(), b"bytes").unwrap()["batch"]["operations"],
            json!([{"kind":"update-clip","clipId":"clip","patch":{"assetId":"old"}}])
        );
        assert!(guard(&i.to_string(), b"other").is_err());
        i["assets"][1]["kind"] = json!("audio");
        assert!(guard(&i.to_string(), b"bytes").is_err());
    }
    #[test]
    fn rejects_drift_stale_scope_arbitrary_fields_and_extra_restores() {
        let original = input();
        for (path, value) in [("revision", json!(3)), ("clips", json!([]))] {
            let mut i = original.clone();
            i[path] = value;
            assert!(guard(&i.to_string(), b"").is_err());
        }
        let mut i = original.clone();
        i["clips"][0]["editing"]["opacity"] = json!(0.7);
        assert!(guard(&i.to_string(), b"").is_err());
        let mut i = original.clone();
        i["request"]["patch"] = json!({});
        assert!(guard(&i.to_string(), b"").is_err());
        let mut i = original;
        i["request"]["clips"][0]["beforeAssetId"] = json!("old");
        assert!(guard(&i.to_string(), b"").is_err());
    }
    #[test]
    fn canonical_numbers_key_order_unicode_and_array_order_are_stable() {
        assert_eq!(
            digest(&json!({"z":1,"a":-0.0})).unwrap(),
            "cb996a1cb72349c2614a3b6a275c863a5493ce820e65aa15c454e593defb8eb8"
        );
        assert_eq!(
            digest(&json!({"中":"🙂"})).unwrap(),
            "a3df734d0f2dae6913e396db0f065b51fbdc11bc243fae143ad029ef8c634c89"
        );
        assert_eq!(
            digest(&json!({"z":1,"a":-0.0})).unwrap(),
            digest(&json!({"a":0,"z":1.0})).unwrap()
        );
        assert_ne!(
            digest(&json!([1, 2])).unwrap(),
            digest(&json!([2, 1])).unwrap()
        );
        assert_eq!(digest(&json!({"中":"🙂"})).unwrap().len(), 64);
    }
}
