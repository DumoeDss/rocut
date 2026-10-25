//! Immutable project font admission shared by ordinary text and text masks.
use bridge::export;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) fn validate_selection(
    params: &BTreeMap<String, Value>,
    path: &str,
    issues: &mut Vec<crate::model::Issue>,
) {
    let Some(value) = params.get("mv.fontResource") else {
        return;
    };
    let error = match resource(value) {
        Err(error) => Some(error),
        Ok(Some(resource)) if params.get("fontFamily") != resource["font"].get("family") => Some(
            "Text font selection differs from its fixed source; choose the matching font file"
                .into(),
        ),
        _ => None,
    };
    if let Some(error) = error {
        issues.push(crate::model::Issue::new(
            &format!("{path}.mv.fontResource"),
            &error,
        ));
    }
}

pub(crate) fn resource(value: &Value) -> Result<Option<Value>, String> {
    if value.as_str() == Some("") {
        return Ok(None);
    }
    let encoded = value
        .as_str()
        .ok_or("Invalid pinned text font descriptor")?;
    if encoded.len() > 4096 {
        return Err("Invalid pinned text font descriptor".into());
    }
    let parsed: Value =
        serde_json::from_str(encoded).map_err(|_| "Invalid pinned text font JSON")?;
    let descriptor: crate::programmatic_resources::Resource =
        serde_json::from_value(parsed.clone()).map_err(|_| "Invalid pinned text font resource")?;
    if !crate::programmatic_resources::validate(&[descriptor]).is_empty()
        || parsed["kind"] != "font"
        || !matches!(parsed["mimeType"].as_str(), Some("font/ttf" | "font/otf"))
        || parsed["font"].get("axes").is_some()
    {
        return Err(
            "Invalid pinned text font resource; use a static TTF or OTF project attachment".into(),
        );
    }
    Ok(Some(parsed))
}

#[export]
pub fn resolve_pinned_text_font_json(input: String) -> String {
    let result = serde_json::from_str::<Value>(&input)
        .map_err(|_| "Invalid pinned text font request".to_owned())
        .and_then(|request| {
            if request["version"] != 1 {
                return Err("Unsupported pinned text font request version".into());
            }
            let Some(resource) = resource(&request["value"])? else {
                return Ok(json!({"version":1,"font":null}));
            };
            if let Some(family) = request.get("family") {
                if family != &resource["font"]["family"] {
                    return Err("Text font selection differs from its fixed source; choose the matching font file".into());
                }
            }
            Ok(json!({"version":1,"font":{
                "id":resource["id"], "source":"project", "assetId":resource["attachmentKey"],
                "contentDigest":resource["sha256"], "family":resource["font"]["family"],
                "style":resource["font"]["style"], "weight":resource["font"]["weight"]
            }}))
        });
    serde_json::to_string(&result.unwrap_or_else(|error| json!({"version":1,"error":error})))
        .expect("serializable font admission")
}
