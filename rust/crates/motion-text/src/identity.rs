use std::collections::{BTreeMap, BTreeSet};

use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMotionTextSequenceOptions {
    pub sequence_json: String,
    pub new_sequence_id: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextIdentityReplacement {
    pub source_id: String,
    pub target_id: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextIdentityError {
    pub code: String,
    pub message: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMotionTextSequenceResult {
    pub sequence_json: Option<String>,
    pub sequence_id: Option<MotionTextIdentityReplacement>,
    pub cue_ids: Vec<MotionTextIdentityReplacement>,
    pub cut_ids: Vec<MotionTextIdentityReplacement>,
    pub error: Option<MotionTextIdentityError>,
}

#[export]
pub fn duplicate_motion_text_sequence(
    DuplicateMotionTextSequenceOptions {
        sequence_json,
        new_sequence_id,
    }: DuplicateMotionTextSequenceOptions,
) -> DuplicateMotionTextSequenceResult {
    let value = match serde_json::from_str::<Value>(&sequence_json) {
        Ok(value) => value,
        Err(error) => {
            return failed(
                "invalid-input",
                format!("Motion-text sequence JSON is invalid: {error}"),
            );
        }
    };

    match duplicate_value(value, &new_sequence_id) {
        Ok(duplicated) => duplicated,
        Err(error) => DuplicateMotionTextSequenceResult {
            sequence_json: None,
            sequence_id: None,
            cue_ids: Vec::new(),
            cut_ids: Vec::new(),
            error: Some(error),
        },
    }
}

fn duplicate_value(
    mut sequence: Value,
    new_sequence_id: &str,
) -> Result<DuplicateMotionTextSequenceResult, MotionTextIdentityError> {
    if !valid_id(new_sequence_id) {
        return Err(identity_error(
            "invalid-id",
            "The new motion-text sequence id is invalid",
        ));
    }

    let sequence_object = object_mut(&mut sequence, "Motion-text sequence must be an object")?;
    let old_sequence_id =
        string_field(sequence_object, "id", "Motion-text sequence id is missing")?;
    if old_sequence_id == new_sequence_id {
        return Err(identity_error(
            "same-identity",
            "An independent motion-text copy requires a new sequence id",
        ));
    }

    let cues = sequence_object
        .get_mut("cues")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| identity_error("invalid-input", "Motion-text cues must be an array"))?;
    let mut cue_ids = Vec::with_capacity(cues.len());
    let mut cue_id_map = BTreeMap::new();
    for cue in cues {
        let cue_object = object_mut(cue, "Motion-text cue must be an object")?;
        let source_id = string_field(cue_object, "id", "Motion-text cue id is missing")?;
        if cue_id_map.contains_key(&source_id) {
            return Err(identity_error(
                "duplicate-id",
                format!("Duplicate motion-text cue id {source_id}"),
            ));
        }
        let target_id = derived_identity("mtcue", new_sequence_id, &source_id);
        cue_object.insert("id".to_owned(), Value::String(target_id.clone()));
        cue_id_map.insert(source_id.clone(), target_id.clone());
        cue_ids.push(MotionTextIdentityReplacement {
            source_id,
            target_id,
        });
    }

    let mut cut_ids = Vec::new();
    if let Some(plan) = sequence_object.get_mut("resolvedPlan") {
        let plan_object = object_mut(plan, "Motion-text resolved plan must be an object")?;
        let cuts = plan_object
            .get_mut("cuts")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                identity_error(
                    "invalid-input",
                    "Motion-text resolved cuts must be an array",
                )
            })?;
        let mut seen_cut_ids = BTreeSet::new();
        cut_ids.reserve(cuts.len());
        for cut in cuts {
            let cut_object = object_mut(cut, "Motion-text cut must be an object")?;
            let source_id = string_field(cut_object, "id", "Motion-text cut id is missing")?;
            if !seen_cut_ids.insert(source_id.clone()) {
                return Err(identity_error(
                    "duplicate-id",
                    format!("Duplicate motion-text cut id {source_id}"),
                ));
            }
            let source_cue_id = string_field(
                cut_object,
                "cueId",
                "Motion-text cut cue reference is missing",
            )?;
            let target_cue_id = cue_id_map.get(&source_cue_id).ok_or_else(|| {
                identity_error(
                    "missing-relation",
                    format!("Motion-text cut references missing cue {source_cue_id}"),
                )
            })?;
            let target_id = derived_identity("mtcut", new_sequence_id, &source_id);
            cut_object.insert("id".to_owned(), Value::String(target_id.clone()));
            cut_object.insert("cueId".to_owned(), Value::String(target_cue_id.clone()));
            cut_ids.push(MotionTextIdentityReplacement {
                source_id,
                target_id,
            });
        }
        plan_object.insert(
            "sequenceRevision".to_owned(),
            Value::Number(Number::from(0)),
        );
    }

    sequence_object.insert("id".to_owned(), Value::String(new_sequence_id.to_owned()));
    sequence_object.insert("revision".to_owned(), Value::Number(Number::from(0)));
    let sequence_json = serde_json::to_string(&sequence).map_err(|error| {
        identity_error(
            "serialization-failed",
            format!("Duplicated motion-text sequence could not be serialized: {error}"),
        )
    })?;

    Ok(DuplicateMotionTextSequenceResult {
        sequence_json: Some(sequence_json),
        sequence_id: Some(MotionTextIdentityReplacement {
            source_id: old_sequence_id,
            target_id: new_sequence_id.to_owned(),
        }),
        cue_ids,
        cut_ids,
        error: None,
    })
}

fn object_mut<'a>(
    value: &'a mut Value,
    message: &str,
) -> Result<&'a mut Map<String, Value>, MotionTextIdentityError> {
    value
        .as_object_mut()
        .ok_or_else(|| identity_error("invalid-input", message))
}

fn string_field(
    object: &Map<String, Value>,
    field: &str,
    message: &str,
) -> Result<String, MotionTextIdentityError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| valid_id(value))
        .map(str::to_owned)
        .ok_or_else(|| identity_error("invalid-id", message))
}

pub(crate) fn valid_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.len() <= 128
        && first.is_ascii_alphanumeric()
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
}

fn derived_identity(kind: &str, new_sequence_id: &str, source_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"motion-text-independent-copy-v1\0");
    digest.update(kind.as_bytes());
    digest.update(b"\0");
    digest.update(new_sequence_id.as_bytes());
    digest.update(b"\0");
    digest.update(source_id.as_bytes());
    let encoded = format!("{:x}", digest.finalize());
    format!("{kind}:{}", &encoded[..32])
}

fn identity_error(code: &str, message: impl Into<String>) -> MotionTextIdentityError {
    MotionTextIdentityError {
        code: code.to_owned(),
        message: message.into(),
    }
}

fn failed(code: &str, message: impl Into<String>) -> DuplicateMotionTextSequenceResult {
    DuplicateMotionTextSequenceResult {
        sequence_json: None,
        sequence_id: None,
        cue_ids: Vec::new(),
        cut_ids: Vec::new(),
        error: Some(identity_error(code, message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sequence() -> Value {
        json!({
            "id": "sequence:original",
            "revision": 7,
            "futureExtension": { "preserve": [1, 2, 3] },
            "cues": [
                {
                    "id": "cue:first",
                    "locks": [{ "scope": "preset-group", "key": "trans" }],
                    "overrides": { "preset": { "trans": "flash" } }
                },
                { "id": "cue:second", "locks": [], "overrides": {} }
            ],
            "resolvedPlan": {
                "version": 1,
                "sequenceRevision": 7,
                "opaquePlanField": "keep",
                "cuts": [
                    {
                        "id": "cut:first",
                        "cueId": "cue:first",
                        "preset": { "trans": "flash" }
                    },
                    {
                        "id": "cut:second",
                        "cueId": "cue:second",
                        "preset": { "trans": null }
                    }
                ]
            }
        })
    }

    #[test]
    fn rebuilds_sequence_cue_and_cut_identity_without_losing_opaque_semantics() {
        let first = duplicate_value(sequence(), "sequence:independent").expect("copy succeeds");
        let second = duplicate_value(sequence(), "sequence:independent").expect("copy repeats");
        assert_eq!(first, second);
        assert_eq!(first.cue_ids.len(), 2);
        assert_eq!(first.cut_ids.len(), 2);

        let duplicated: Value = serde_json::from_str(
            first
                .sequence_json
                .as_deref()
                .expect("successful copy has JSON"),
        )
        .expect("copy is JSON");
        assert_eq!(duplicated["id"], "sequence:independent");
        assert_eq!(duplicated["revision"], 0);
        assert_eq!(duplicated["resolvedPlan"]["sequenceRevision"], 0);
        assert_eq!(
            duplicated["resolvedPlan"]["cuts"][0]["cueId"],
            duplicated["cues"][0]["id"]
        );
        assert_eq!(duplicated["futureExtension"]["preserve"], json!([1, 2, 3]));
        assert_eq!(duplicated["resolvedPlan"]["opaquePlanField"], "keep");
        assert_eq!(duplicated["cues"][0]["locks"][0]["key"], "trans");
        assert_eq!(
            duplicated["resolvedPlan"]["cuts"][0]["preset"]["trans"],
            "flash"
        );
    }

    #[test]
    fn fails_closed_when_a_cut_references_an_unknown_cue() {
        let mut invalid = sequence();
        invalid["resolvedPlan"]["cuts"][0]["cueId"] = json!("cue:missing");
        let error = duplicate_value(invalid, "sequence:independent")
            .expect_err("missing relation must fail");
        assert_eq!(error.code, "missing-relation");
    }

    #[test]
    fn requires_a_distinct_valid_sequence_identity() {
        let same =
            duplicate_value(sequence(), "sequence:original").expect_err("same identity must fail");
        assert_eq!(same.code, "same-identity");
        let invalid =
            duplicate_value(sequence(), "not valid!").expect_err("invalid identity must fail");
        assert_eq!(invalid.code, "invalid-id");
    }
}
