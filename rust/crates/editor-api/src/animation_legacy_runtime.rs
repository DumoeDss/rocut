//! Transient legacy scalar DTO normalization. No document writes or domain admission.
//! Missing channel/empty keys use fallback; null is not missing. Only known legacy
//! id/tangentMode metadata is accepted. Duplicate times/IDs are errors, not merges.
//! Sorting/defaults/effective handle spans are native-owned; values/dv are not clamped.
mod normalize;
use crate::animation_boundary as boundary;
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub(super) fn error(code: &str, path: &str, message: &str) -> Value {
    json!({"code":code,"path":path,"message":message})
}
pub(super) fn object<'a>(value: &'a Value, path: &str, allowed: &[&str]) -> Result<&'a serde_json::Map<String, Value>, Value> {
    let fields = value.as_object().ok_or_else(|| error("invalid-object", path, "Expected an object"))?;
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(error("unknown-field", path, "Unknown legacy DTO field"));
    }
    Ok(fields)
}
pub(super) fn required<'a>(fields: &'a serde_json::Map<String, Value>, key: &str, path: &str) -> Result<&'a Value, Value> {
    fields.get(key).ok_or_else(|| error("missing-field", &format!("{path}/{key}"), "Required field missing"))
}

/// Request errors are atomic; sampling/normalization errors are isolated per item.
/// This is scalar sampling only; no Safe/Violation/Unresolved interpretation.
#[bridge::export]
pub fn sample_legacy_scalar_animation_batch_json(input: String) -> String {
    let result = if input.len() > boundary::MAX_INPUT_BYTES || input.capacity() > boundary::MAX_INPUT_BYTES {
        Err(error("input-bytes", "$", "Input exceeds 8 MiB"))
    } else {
        boundary::parse_runtime_json(&input).and_then(prepare)
    };
    drop(input);
    let response = result.unwrap_or_else(|error| json!({"kind":"request-error","version":1,"error":error}));
    let output = response.to_string();
    if output.len() > boundary::MAX_OUTPUT_BYTES {
        json!({"kind":"request-error","version":1,"error":error("output-bytes","$","Output exceeds 4 MiB")}).to_string()
    } else { output }
}

fn prepare(input: Value) -> Result<Value, Value> {
    let fields = object(&input, "$", &["version", "numericSemantics", "items"])?;
    if required(fields, "version", "$")?.as_u64() != Some(1) {
        return Err(error("unsupported-version", "$/version", "Only version 1 is supported"));
    }
    if required(fields, "numericSemantics", "$")?.as_str() != Some(boundary::NUMERIC_SEMANTICS) {
        return Err(error("unsupported-semantics", "$/numericSemantics", "Expected scalar-f64-v1"));
    }
    let items = required(fields, "items", "$")?.as_array().ok_or_else(|| error("invalid-array", "$/items", "Expected items array"))?;
    if items.len() > boundary::MAX_ITEMS { return Err(error("item-count", "$/items", "Request exceeds 128 items")); }
    let mut ids = BTreeSet::new();
    let mut key_count = 0;
    let mut sample_count = 0;
    for (index, item) in items.iter().enumerate() {
        let id = item.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= boundary::MAX_STRING_BYTES)
            .ok_or_else(|| error("invalid-id", &format!("$/items/{index}/id"), "Expected nonempty bounded ID"))?;
        if !ids.insert(id) { return Err(error("duplicate-id", &format!("$/items/{index}/id"), "Item IDs must be unique")); }
        key_count += item.get("channel").and_then(|value| value.get("keys")).and_then(Value::as_array).map_or(0, Vec::len);
        sample_count += item.get("times").and_then(Value::as_array).map_or(0, Vec::len);
    }
    if key_count > boundary::MAX_REQUEST_KEYS { return Err(error("request-key-count", "$/items", "Request exceeds 32768 keys")); }
    if sample_count > boundary::MAX_REQUEST_SAMPLES { return Err(error("request-sample-count", "$/items", "Request exceeds 65536 samples")); }
    let mut canonical = Vec::new();
    let mut failures = std::collections::BTreeMap::new();
    for (index, item) in items.iter().enumerate() {
        let path = format!("$/items/{index}");
        let id = item["id"].as_str().expect("validated ID");
        match normalize::item(item, &path) {
            Ok(item) => canonical.push(item),
            Err(issue) => { failures.insert(id, json!({"id":id,"status":"error","error":issue})); }
        }
    }
    // Existing boundary/numeric sampler is the only numerical evaluator.
    let sampled: Value = serde_json::from_str(&boundary::sample_scalar_animation_batch_json(
        json!({"version":1,"numericSemantics":boundary::NUMERIC_SEMANTICS,"items":canonical}).to_string(),
    )).map_err(|_| error("core-response", "$", "Scalar sampler returned invalid JSON"))?;
    let results = sampled["results"].as_array().ok_or_else(|| sampled["error"].clone())?;
    let by_id: std::collections::BTreeMap<_, _> = results.iter().map(|result| (result["id"].as_str().expect("sampler ID"), result)).collect();
    let ordered: Vec<_> = items.iter().map(|item| {
        let id = item["id"].as_str().expect("validated ID");
        failures.get(id).cloned().unwrap_or_else(|| (*by_id[id]).clone())
    }).collect();
    Ok(json!({"kind":"batch-result","version":1,"numericSemantics":boundary::NUMERIC_SEMANTICS,"results":ordered}))
}
