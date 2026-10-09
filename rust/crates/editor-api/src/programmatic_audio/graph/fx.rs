//! Native chain admission, matching @hyperframes/core 0.8.139 audioFx.js with
//! explicit Rocut resource bounds. See NOTICE for upstream attribution.
use super::fx_catalog::DEFINITIONS;
use super::fx_model::{FxChain, FxNode, FxValue, Parameter};
use super::fx_numbers::{clamp_number, number_string, replace_overflow_numbers};
use super::fx_tail::static_tail_seconds;
use bridge::export;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const MAX_INPUT_BYTES: usize = 128 * 1024;
const MAX_NODES: usize = 32;
const MAX_DEPTH: usize = 8;
const MAX_VALUES: usize = 4096;
const MAX_KEYS: usize = 64;
const MAX_STRING_BYTES: usize = 4096;
const MAX_METADATA_BYTES: usize = 256;

fn validate_bounds(value: &Value, depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if depth > MAX_DEPTH || *count > MAX_VALUES {
        return Err("HyperFrames FX payload exceeds the depth/value safety limit".into());
    }
    match value {
        Value::Object(object) => {
            if object.len() > MAX_KEYS || object.keys().any(|key| key.len() > MAX_STRING_BYTES) {
                return Err("HyperFrames FX object exceeds the key safety limit".into());
            }
            for child in object.values() {
                validate_bounds(child, depth + 1, count)?;
            }
        }
        Value::Array(array) => {
            for child in array {
                validate_bounds(child, depth + 1, count)?;
            }
        }
        Value::String(string) if string.len() > MAX_STRING_BYTES => {
            return Err("HyperFrames FX string exceeds the byte safety limit".into());
        }
        _ => {}
    }
    Ok(())
}

fn metadata(node: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    let string = node.get(key).and_then(Value::as_str);
    if string.is_some_and(|value| value.len() > MAX_METADATA_BYTES) {
        return Err(format!(
            "HyperFrames FX {key} exceeds the metadata byte safety limit"
        ));
    }
    // Whitespace and duplicate IDs are intentionally not rewritten here. The
    // native parser retains them; automation identity admission is a later step.
    Ok(string.filter(|value| !value.is_empty()).map(str::to_owned))
}

fn params(definitions: &[Parameter], raw: Option<&Value>) -> BTreeMap<&'static str, FxValue> {
    definitions
        .iter()
        .map(|parameter| match parameter {
            Parameter::Number {
                key,
                min,
                max,
                default,
                ..
            } => {
                let number = match raw.and_then(|value| value.get(key)) {
                    Some(Value::Number(number)) => number.as_f64(),
                    Some(Value::String(string)) => number_string(string),
                    _ => None,
                };
                let value = number
                    .filter(|n| n.is_finite())
                    .map_or(*default, |n| clamp_number(n, *min, *max));
                (*key, FxValue::Number(value))
            }
            Parameter::Enum {
                key,
                options,
                default,
            } => {
                let string = raw.and_then(|value| value.get(key)).and_then(Value::as_str);
                let value = options
                    .iter()
                    .find(|option| Some(**option) == string)
                    .copied()
                    .unwrap_or(default);
                (*key, FxValue::Enum(value))
            }
        })
        .collect()
}

fn parse_node(value: &Value, index: usize) -> Result<FxNode, String> {
    let node = value
        .as_object()
        .ok_or_else(|| format!("HyperFrames FX node {index} is not an object"))?;
    let kind = node.get("type").and_then(Value::as_str);
    let definition = DEFINITIONS
        .iter()
        .find(|def| Some(def.id) == kind)
        .ok_or_else(|| format!("HyperFrames FX node {index} has an unknown effect type"))?;
    let only_true = |key| (node.get(key) == Some(&Value::Bool(true))).then_some(true);
    Ok(FxNode {
        kind: definition.id,
        id: metadata(node, "id")?,
        from_carve: only_true("fromCarve"),
        from_preset: metadata(node, "fromPreset")?,
        label: metadata(node, "label")?,
        from_eq: metadata(node, "fromEq")?,
        from_leveller: only_true("fromLeveller"),
        preset_amount: node
            .get("presetAmount")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())
            .map(|n| clamp_number(n, 0.0, 1.0)),
        enabled: node.get("enabled") != Some(&Value::Bool(false)),
        params: params(definition.params, node.get("params")),
    })
}

fn json_error(error: serde_json::Error) -> String {
    let detail = error.to_string();
    // serde_json's private LoneLeadingSurrogateInHexEscape and
    // UnexpectedEndOfHexEscape codes are emitted only for unpaired UTF-16
    // escapes in a UTF-8 String. Map their exact display prefixes, not generic
    // escape/EOF errors (which remain ordinary malformed-JSON errors).
    if detail.starts_with("lone leading surrogate in hex escape at line ")
        || detail.starts_with("unexpected end of hex escape at line ")
    {
        "HyperFrames FX Unicode-scalar safety policy rejects unpaired UTF-16 surrogate escapes"
            .into()
    } else {
        format!("HyperFrames FX chain is not valid JSON: {detail}")
    }
}

pub(super) fn parse_chain_json(input: &str) -> Result<FxChain, String> {
    if input.len() > MAX_INPUT_BYTES {
        return Err("HyperFrames FX payload exceeds the byte safety limit".into());
    }
    let value: Value =
        serde_json::from_str(&replace_overflow_numbers(input)).map_err(json_error)?;
    validate_bounds(&value, 0, &mut 0)?;
    let object = value
        .as_object()
        .ok_or("HyperFrames FX chain must be a JSON object")?;
    if object.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err("Unsupported HyperFrames FX chain version".into());
    }
    let nodes = object
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or("HyperFrames FX chain is missing a nodes array")?;
    if nodes.len() > MAX_NODES {
        return Err("HyperFrames FX chain exceeds the node safety limit".into());
    }
    Ok(FxChain {
        version: 1,
        nodes: nodes
            .iter()
            .enumerate()
            .map(|(i, value)| parse_node(value, i))
            .collect::<Result<_, _>>()?,
    })
}

/// Normalize a native {version,nodes} chain without executing or admitting a
/// graph. staticTailSeconds excludes automation and is NOT a render duration.
/// Every Rocut safety-limit violation is an error, never a silent truncation.
/// Rocut additionally requires Unicode-scalar strings: paired UTF-16 surrogate
/// escapes are accepted, unpaired ones are rejected, never replaced by U+FFFD.
#[export]
pub fn normalize_hyperframes_fx_chain_json(input: String) -> String {
    match parse_chain_json(&input) {
        Ok(chain) => serde_json::json!({
            "staticTailSeconds": static_tail_seconds(&chain), "chain": chain,
        })
        .to_string(),
        Err(error) => serde_json::json!({"error": error}).to_string(),
    }
}
