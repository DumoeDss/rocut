//! Synthetic decoded facts for geometry/clock integration fixtures, not pixels.
//! Exercise the public pending -> complete handshake instead of bypassing it.
use editor_api::resolve_programmatic_frame_json;
use serde_json::{Value, json};

pub fn resolve_with_image_facts(mut request: Value) -> Value {
    let pending: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
    let Some(images) = pending["frame"]["imageDimensionRequests"].as_array() else {
        return pending;
    };
    if images.is_empty() {
        return pending;
    }
    assert!(pending["frame"].get("recipePlan").is_none());
    request["imageDimensions"] = images
        .iter()
        .map(|image| json!({"resource":image["resource"],"width":320,"height":180}))
        .collect();
    serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap()
}
