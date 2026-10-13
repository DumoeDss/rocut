//! Composition-only admission. Export fingerprints/codecs/publication remain in native_export.
use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Archive {
    source: Value,
    manifest_sha256: String,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u8,
    idempotency_key: String,
    archive: Archive,
    options: Value,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema_version: u8,
    request_id: String,
    request_hash: String,
    archive_digest: String,
    request: Request,
    phase: String,
    compiled_source: Option<Value>,
    source: Option<Value>,
    error: Option<String>,
    created_at: u64,
    updated_at: u64,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Input {
    Admit {
        request: Request,
        now: u64,
        #[serde(default)]
        existing: Option<Value>,
    },
    Transition {
        record: Value,
        event: Value,
        now: u64,
    },
    Verify {
        record: Value,
    },
}
fn canonical(v: &Value) -> String {
    match v {
        Value::Object(m) => format!(
            "{{{}}}",
            m.iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(k, v)| format!("{}:{}", serde_json::to_string(k).unwrap(), canonical(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        _ => v.to_string(),
    }
}
fn hash(domain: &str, v: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{domain}\n{}", canonical(v)))
    )
}
fn digest(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn validate_source(v: &Value) -> Result<(), String> {
    let source: crate::programmatic::Source =
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    let issues = source.validate();
    if !issues.is_empty() {
        return Err("Invalid fixed programmatic source".into());
    }
    if v["runtime"] != "html-document" {
        return Err("Only saved HTML/Remotion compositions are admitted".into());
    }
    if let Some(build) = v.get("build") {
        if build["engine"] != "remotion" && build["engine"] != "hyperframes" {
            return Err("Unsupported composition engine".into());
        }
    }
    Ok(())
}
fn isolated(source: &Value, id: &str) -> Result<Value, String> {
    validate_source(source)?;
    let frames = source["durationFrames"].as_u64().ok_or("Invalid frames")?;
    let num = source["frameRate"]["numerator"]
        .as_u64()
        .ok_or("Invalid rate")?;
    let den = source["frameRate"]["denominator"]
        .as_u64()
        .ok_or("Invalid rate")?;
    let duration = frames
        .checked_mul(120000)
        .and_then(|v| v.checked_mul(den))
        .ok_or("Duration overflow")?;
    if num == 0
        || duration % num != 0
        || duration / num == 0
        || duration / num > 9_007_199_254_740_991
    {
        return Err("Composition duration must be exact safe integer ticks".into());
    }
    let ticks = duration / num;
    let stamp = "2026-01-01T00:00:00.000Z";
    let project_id = format!("composition:{id}");
    Ok(json!({"projectId":project_id,"revision":0,"data":{
        "metadata":{"id":project_id,"name":"Fixed composition","duration":ticks,"createdAt":stamp,"updatedAt":stamp},
        "version":2,"currentSceneId":"composition-scene","motionTextSequences":[],
        "settings":{"fps":source["frameRate"],"canvasSize":{"width":source["width"],"height":source["height"]},"background":{"type":"color","color":"#000000"}},
        "scenes":[{"id":"composition-scene","name":"Fixed composition","isMain":true,"createdAt":stamp,"updatedAt":stamp,"bookmarks":[],"tracks":{
            "main":{"id":"composition-main","name":"Main","type":"video","muted":false,"hidden":false,"elements":[]},
            "audio":[],"overlay":[{"id":"composition-graphics","name":"Composition","type":"graphic","hidden":false,"elements":[{
                "id":"composition-clip","name":"Fixed composition","type":"graphic","definitionId":"programmatic","params":{},"programmatic":source,
                "startTime":0,"duration":ticks,"trimStart":0,"trimEnd":0
            }]}]
        }}]
    }}))
}
fn normalize(mut request: Request, now: u64) -> Result<Record, String> {
    if request.schema_version != 1
        || request.idempotency_key.is_empty()
        || request.idempotency_key.len() > 200
        || request.idempotency_key.chars().any(char::is_control)
        || !digest(&request.archive.manifest_sha256)
        || now > 9_007_199_254_740_991
    {
        return Err("Invalid composition request identity".into());
    }
    validate_source(&request.archive.source)?;
    let source = isolated(&request.archive.source, "admission")?;
    let result: Value=serde_json::from_str(&crate::native_export::resolve_native_export_job_json(json!({"action":"admit","request":{
        "schemaVersion":1,"projectId":source["projectId"],"expectedRevision":0,"idempotencyKey":request.idempotency_key,"options":request.options
    },"source":source,"jobId":"composition-admission","now":now}).to_string())).map_err(|e|e.to_string())?;
    if result["status"] != "reserved" {
        return Err(result["error"]["code"]
            .as_str()
            .unwrap_or("Invalid export options")
            .into());
    }
    request.options = result["record"]["request"]["options"].clone();
    if request.options.get("range").is_some() {
        return Err("Composition export requires its full isolated duration".into());
    }
    let request_hash = hash(
        "rocut-composition-request/1",
        &serde_json::to_value(&request).unwrap(),
    );
    let archive_digest = hash(
        "rocut-composition-archive/1",
        &serde_json::to_value(&request.archive).unwrap(),
    );
    Ok(Record {
        schema_version: 1,
        request_id: request_hash.clone(),
        request_hash,
        archive_digest,
        request,
        phase: "reserved".into(),
        compiled_source: None,
        source: None,
        error: None,
        created_at: now,
        updated_at: now,
    })
}
fn compiled_matches(request: &Request, compiled: &Value) -> Result<(), String> {
    validate_source(compiled)?;
    let original = &request.archive.source;
    if original.get("build").is_none() {
        if original != compiled {
            return Err("Document source changed".into());
        }
        return Ok(());
    }
    let strip = |v: &Value| {
        let mut v = v.clone();
        let m = v.as_object_mut().unwrap();
        m.remove("code");
        m.remove("documentId");
        m.remove("resources");
        v
    };
    if strip(original) != strip(compiled)
        || compiled["code"] != ""
        || compiled["documentId"] != "_rocut/compiled.html"
    {
        return Err("Compiled archive binding differs".into());
    }
    let attachments = |v: &Value| {
        v["resources"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|r| r["id"] != v["documentId"])
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    if attachments(original) != attachments(compiled) {
        return Err("Compiled media bindings differ".into());
    }
    Ok(())
}
fn checked(v: Value) -> Result<Record, String> {
    let r: Record = serde_json::from_value(v).map_err(|e| e.to_string())?;
    let expected = normalize(r.request.clone(), r.created_at)?;
    if r.schema_version != 1
        || r.request_hash != expected.request_hash
        || r.request_id != expected.request_id
        || r.archive_digest != expected.archive_digest
        || r.request != expected.request
        || r.updated_at < r.created_at
        || r.updated_at > 9_007_199_254_740_991
        || !matches!(
            r.phase.as_str(),
            "reserved" | "compiling" | "compiled" | "exporting" | "failed" | "outcome-unknown"
        )
    {
        return Err("Invalid composition ledger binding".into());
    }
    match (&r.compiled_source, &r.source) {
        (Some(c), Some(s)) if !matches!(r.phase.as_str(), "reserved" | "compiling") => {
            compiled_matches(&r.request, c)?;
            if isolated(c, &r.request_id)? != *s {
                return Err("Isolated source binding differs".into());
            }
        }
        (None, None) if !matches!(r.phase.as_str(), "compiled" | "exporting") => {}
        _ => return Err("Incomplete compiled source binding".into()),
    }
    Ok(r)
}
fn resolve(input: Input) -> Result<Value, String> {
    match input {
        Input::Admit {
            request,
            now,
            existing,
        } => {
            let r = normalize(request, now)?;
            if let Some(existing) = existing {
                let old = checked(existing)?;
                if old.request != r.request {
                    return Err("Composition idempotency conflict".into());
                }
                return Ok(json!({"schemaVersion":1,"status":"replay","record":old}));
            }
            Ok(json!({"schemaVersion":1,"status":"reserved","record":r}))
        }
        Input::Verify { record } => {
            Ok(json!({"schemaVersion":1,"status":"verified","record":checked(record)?}))
        }
        Input::Transition { record, event, now } => {
            let mut r = checked(record)?;
            if now < r.updated_at || now > 9_007_199_254_740_991 {
                return Err("Invalid transition clock".into());
            }
            let kind = event["kind"].as_str().ok_or("Missing event kind")?;
            match kind {
                "compileIntent" if r.phase == "reserved" => r.phase = "compiling".into(),
                "compiled" if r.phase == "compiling" => {
                    let c = event.get("source").ok_or("Missing compiled source")?;
                    compiled_matches(&r.request, c)?;
                    r.source = Some(isolated(c, &r.request_id)?);
                    r.compiled_source = Some(c.clone());
                    r.phase = "compiled".into();
                }
                "exportIntent" if r.phase == "compiled" => r.phase = "exporting".into(),
                "failed" if matches!(r.phase.as_str(), "reserved" | "compiling" | "compiled") => {
                    r.phase = "failed".into();
                    r.error = Some(
                        event["error"]
                            .as_str()
                            .unwrap_or("composition-failed")
                            .chars()
                            .take(1000)
                            .collect(),
                    );
                }
                "dispatchUnknown" if r.phase == "exporting" => {
                    r.phase = "outcome-unknown".into();
                    r.error = Some("Export dispatch intent has no durable native receipt; never automatically replay".into());
                }
                "recover" => {
                    if matches!(r.phase.as_str(), "reserved" | "compiling" | "compiled") {
                        r.phase = "outcome-unknown".into();
                        r.error = Some(
                            "Compilation or dispatch outcome unknown; never automatically replay"
                                .into(),
                        );
                    }
                }
                _ => return Err("Invalid composition production transition".into()),
            }
            r.updated_at = now;
            Ok(json!({"schemaVersion":1,"status":"updated","record":r}))
        }
    }
}
#[export]
pub fn resolve_composition_production_json(input: String) -> String {
    if input.len() > 4 * 1024 * 1024 {
        return json!({"schemaVersion":1,"status":"rejected","error":{"code":"composition-production-input-limit","message":"Composition request exceeds its size limit"}}).to_string();
    }
    let result = serde_json::from_str::<Input>(&input)
        .map_err(|e| e.to_string())
        .and_then(resolve);
    result.unwrap_or_else(|message|json!({"schemaVersion":1,"status":"rejected","error":{"code":"composition-production-rejected","message":message}})).to_string()
}
