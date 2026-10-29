mod edit;
mod model;
mod projection;
mod query;
mod tempo;
use bridge::export;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope<T> {
    document: model::Document,
    request: T,
}
pub(crate) fn query_value(document: Value, request: Value) -> Result<Value, String> {
    let doc = serde_json::from_value(document).map_err(|_| "music-grid-document-invalid")?;
    let query = serde_json::from_value(request).map_err(|_| "music-grid-query-schema-invalid")?;
    query::query(doc, query)
}
fn encode(result: Result<Value, String>) -> String {
    match result { Ok(value) => value, Err(reason) => json!({"status":if reason.contains("conflict") {"conflict"} else {"unavailable"},"reason":reason}) }.to_string()
}
#[export]
pub fn query_music_grid_json(input: String) -> String {
    encode((|| {
        let value: Envelope<query::Query> =
            serde_json::from_str(&input).map_err(|_| "music-grid-query-schema-invalid")?;
        query::query(value.document, value.request)
    })())
}
#[export]
pub fn plan_music_grid_edit_json(input: String) -> String {
    encode((|| {
        let value: Envelope<edit::EditRequest> =
            serde_json::from_str(&input).map_err(|_| "music-grid-edit-schema-invalid")?;
        edit::edit(value.document, value.request)
    })())
}
/// Shape/provenance guard for transaction updates and persisted project loading.
#[export]
pub fn validate_music_grid_state_json(input: String) -> String {
    let result = serde_json::from_str::<model::State>(&input)
        .map_err(|_| "music-grid-state-invalid".to_owned())
        .and_then(|s| s.validate());
    match result {
        Ok(()) => json!([]),
        Err(reason) => json!([{"path":"musicGridState","message":reason}]),
    }
    .to_string()
}
