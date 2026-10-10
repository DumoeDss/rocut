//! Standalone effect optical animation: native catalog admission and scalar sampling.
use crate::model::{Issue, Param, Request};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    version: u8,
    effect_type: String,
    params: BTreeMap<String, Value>,
    animations: BTreeMap<String, Value>,
    local_ticks: f64,
}

pub(crate) fn native_params(kind: &str) -> Option<Vec<Param>> {
    // Blur predates the stylized catalog. Its sole scalar authoring field is
    // native-owned here; pass construction remains the existing renderer's job.
    if kind == "blur" {
        return Some(vec![Param {
            key: "intensity".into(),
            kind: "number".into(),
            min: Some(0.0),
            max: Some(100.0),
            display_multiplier: None,
            keyframable: Some(true),
            required: Some(true),
            options: vec![],
        }]);
    }
    let catalog: Value = serde_json::from_str(&effects::stylized_effect_catalog_json()).ok()?;
    let fields = catalog
        .as_array()?
        .iter()
        .find(|entry| entry["id"] == kind)?["fields"]
        .as_array()?;
    fields
        .iter()
        .map(|field| {
            let mut field = field.clone();
            field["type"] = json!("number");
            serde_json::from_value(field).ok()
        })
        .collect()
}

/// `localTicks` is already clip-local: no trim, offset, frame quantization or retime.
#[bridge::export]
pub fn resolve_effect_layer_params_json(input: String) -> String {
    let result = resolve(&input);
    let output = match result {
        Ok(params) => json!({"version":1,"params":params}),
        Err(error) => json!({"version":1,"error":error}),
    };
    output.to_string()
}

fn resolve(input: &str) -> Result<BTreeMap<String, Value>, Issue> {
    if input.len() > crate::animation_boundary::MAX_INPUT_BYTES {
        return Err(Issue::new(
            "request",
            "Effect animation request exceeds 8 MiB",
        ));
    }
    let input: Input = serde_json::from_str(input).map_err(|error| {
        Issue::new(
            "request",
            &format!("Invalid effect animation schema: {error}"),
        )
    })?;
    if input.version != 1 {
        return Err(Issue::new("version", "Only version 1 is supported"));
    }
    if !input.local_ticks.is_finite()
        || !(0.0..=9_007_199_254_740_991.0).contains(&input.local_ticks)
    {
        return Err(Issue::new(
            "localTicks",
            "Expected nonnegative finite safe clip-local ticks",
        ));
    }
    let fields = native_params(&input.effect_type)
        .ok_or_else(|| Issue::new("effectType", "Unknown native effect type"))?;
    // The same admission path validates static completeness, native schedules,
    // key IDs, ordered times, catalog ranges and legacy channel metadata.
    let request: Request = serde_json::from_value(json!({
        "editing":{"type":"effect","effectType":input.effect_type,"params":input.params,"animations":input.animations},
        "duration":9_007_199_254_740_991_u64,"trackKind":"effect","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{input.effect_type.clone():fields_json(&fields)}}
    })).map_err(|error| Issue::new("request", &error.to_string()))?;
    if let Some(issue) = crate::validate(&request).into_iter().next() {
        return Err(issue);
    }
    let mut items = Vec::new();
    for (path, channel) in &input.animations {
        let key = path.strip_prefix("params.").expect("admitted path");
        let mut channel = channel.clone();
        // Legacy metadata has already been validated. The explicit scalar DTO
        // intentionally excludes IDs/tangent modes, and requires edge defaults.
        for key in channel["keys"].as_array_mut().expect("admitted keys") {
            let key = key.as_object_mut().expect("admitted key");
            key.remove("id");
            key.remove("tangentMode");
        }
        if channel.get("extrapolation").is_none() {
            channel["extrapolation"] = json!({"before":"hold","after":"hold"});
        }
        items.push(json!({"id":path,"channel":channel,"fallbackValue":input.params[key],"times":[input.local_ticks]}));
    }
    let sampled: Value = serde_json::from_str(
        &crate::animation_boundary::sample_scalar_animation_batch_json(
            json!({"version":1,"numericSemantics":"scalar-f64-v1","items":items}).to_string(),
        ),
    )
    .map_err(|error| Issue::new("animations", &error.to_string()))?;
    let results = sampled["results"]
        .as_array()
        .ok_or_else(|| Issue::new("animations", &sampled["error"].to_string()))?;
    let mut params = input.params;
    for result in results {
        let path = result["id"].as_str().expect("sample item ID");
        if result["status"] != "values" {
            return Err(Issue::new(path, &result["error"].to_string()));
        }
        let value = result["values"][0].clone();
        let key = path.strip_prefix("params.").expect("admitted path");
        let param = fields
            .iter()
            .find(|field| field.key == key)
            .expect("admitted native field");
        let mut issues = Vec::new();
        crate::validate_value(&value, param, path, &mut issues);
        if let Some(issue) = issues.into_iter().next() {
            return Err(issue);
        }
        params.insert(key.to_owned(), value);
    }
    Ok(params)
}

fn fields_json(fields: &[Param]) -> Value {
    json!(
        fields
            .iter()
            .map(
                |field| json!({"key":field.key,"type":field.kind,"min":field.min,
        "max":field.max,"keyframable":field.keyframable,"required":field.required})
            )
            .collect::<Vec<_>>()
    )
}
