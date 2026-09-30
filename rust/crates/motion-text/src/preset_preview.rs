use bridge::export;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::factory::{
    CreateMotionTextSequenceOptions, CreateMotionTextSequenceResult,
    MotionTextSequenceBuildDiagnostic, MotionTextSequenceBuildDiagnosticSeverity,
    MotionTextSourceFormat, MotionTextStarterPreset, create_motion_text_sequence,
};
use crate::identity::valid_id;
use crate::planner::{MotionTextPresetGroup, MotionTextRendererPresetSupport};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMotionTextPresetPreviewOptions {
    pub sequence_id: String,
    pub preview_text: String,
    pub language: String,
    pub duration: i64,
    pub seed: Option<u32>,
    pub preset_group: MotionTextPresetGroup,
    pub preset_id: String,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[export]
pub fn create_motion_text_preset_preview(
    options: CreateMotionTextPresetPreviewOptions,
) -> CreateMotionTextSequenceResult {
    if !valid_id(&options.preset_id) {
        return failed_preview(
            "invalid-preview-preset",
            "The motion-text preview preset id is invalid.",
        );
    }
    if !options
        .renderer_support
        .iter()
        .any(|entry| entry.group == options.preset_group && entry.id == options.preset_id)
    {
        return failed_preview(
            "unsupported-preview-preset",
            format!(
                "The motion-text renderer does not support {}:{}.",
                group_key(options.preset_group),
                options.preset_id
            ),
        );
    }

    let preview_lines = preview_source(&options.preview_text);
    if preview_lines.is_empty() {
        return failed_preview(
            "empty-preview-text",
            "Motion-text preset preview text must not be empty.",
        );
    }

    let mut created = create_motion_text_sequence(CreateMotionTextSequenceOptions {
        sequence_id: options.sequence_id,
        source: preview_lines,
        source_format: MotionTextSourceFormat::Plain,
        language: options.language,
        duration: options.duration,
        seed: options.seed,
        starter_preset: MotionTextStarterPreset::CleanCaption,
        renderer_support: options.renderer_support,
    });
    let Some(sequence_json) = created.sequence_json.take() else {
        return created;
    };
    let mut document = match serde_json::from_str::<Value>(&sequence_json) {
        Ok(Value::Object(document)) => document,
        Ok(_) | Err(_) => {
            return failed_preview(
                "preview-sequence-invalid",
                "The generated motion-text preview sequence is invalid.",
            );
        }
    };

    if !apply_preview_preset(&mut document, options.preset_group, &options.preset_id) {
        return failed_preview(
            "preview-sequence-invalid",
            "The generated motion-text preview sequence is missing required fields.",
        );
    }
    match serde_json::to_string(&document) {
        Ok(sequence_json) => {
            created.sequence_json = Some(sequence_json);
            created
        }
        Err(error) => failed_preview(
            "preview-serialization-failed",
            format!("Motion-text preview serialization failed: {error}"),
        ),
    }
}

fn preview_source(value: &str) -> String {
    let mut lines = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(2);
    let Some(first) = lines.next() else {
        return String::new();
    };
    let second = lines.next().unwrap_or(first);
    format!("{first}\n{second}")
}

fn apply_preview_preset(
    document: &mut Map<String, Value>,
    group: MotionTextPresetGroup,
    preset_id: &str,
) -> bool {
    let Some(default_preset) = document
        .get_mut("defaults")
        .and_then(Value::as_object_mut)
        .and_then(|defaults| defaults.get_mut("preset"))
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    set_preset_value(default_preset, group, preset_id);

    let Some(cues) = document.get_mut("cues").and_then(Value::as_array_mut) else {
        return false;
    };
    if group == MotionTextPresetGroup::Trans {
        for (index, cue) in cues.iter_mut().enumerate() {
            let Some(overrides) = cue
                .as_object_mut()
                .and_then(|cue| cue.get_mut("overrides"))
                .and_then(Value::as_object_mut)
            else {
                return false;
            };
            let preset = overrides
                .entry("preset")
                .or_insert_with(|| Value::Object(Map::new()));
            let Some(preset) = preset.as_object_mut() else {
                return false;
            };
            preset.insert(
                "trans".to_owned(),
                if index == 0 {
                    Value::Null
                } else {
                    Value::String(preset_id.to_owned())
                },
            );
        }
    }

    let Some(cuts) = document
        .get_mut("resolvedPlan")
        .and_then(Value::as_object_mut)
        .and_then(|plan| plan.get_mut("cuts"))
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    for (index, cut) in cuts.iter_mut().enumerate() {
        let Some(preset) = cut
            .as_object_mut()
            .and_then(|cut| cut.get_mut("preset"))
            .and_then(Value::as_object_mut)
        else {
            return false;
        };
        if group == MotionTextPresetGroup::Trans && index == 0 {
            preset.insert("trans".to_owned(), Value::Null);
        } else {
            set_preset_value(preset, group, preset_id);
        }
    }
    true
}

fn set_preset_value(
    preset: &mut Map<String, Value>,
    group: MotionTextPresetGroup,
    preset_id: &str,
) {
    let value = match group {
        MotionTextPresetGroup::Decor | MotionTextPresetGroup::Fx => {
            Value::Array(vec![Value::String(preset_id.to_owned())])
        }
        _ => Value::String(preset_id.to_owned()),
    };
    preset.insert(group_key(group).to_owned(), value);
}

fn group_key(group: MotionTextPresetGroup) -> &'static str {
    match group {
        MotionTextPresetGroup::Style => "style",
        MotionTextPresetGroup::Layout => "layout",
        MotionTextPresetGroup::Enter => "enter",
        MotionTextPresetGroup::Hold => "hold",
        MotionTextPresetGroup::Exit => "exit",
        MotionTextPresetGroup::Decor => "decor",
        MotionTextPresetGroup::Treat => "treat",
        MotionTextPresetGroup::Bg => "bg",
        MotionTextPresetGroup::Cam => "cam",
        MotionTextPresetGroup::Fx => "fx",
        MotionTextPresetGroup::Trans => "trans",
    }
}

fn failed_preview(code: &str, message: impl Into<String>) -> CreateMotionTextSequenceResult {
    CreateMotionTextSequenceResult {
        sequence_json: None,
        diagnostics: vec![MotionTextSequenceBuildDiagnostic {
            severity: MotionTextSequenceBuildDiagnosticSeverity::Error,
            code: code.to_owned(),
            message: message.into(),
            source_line: None,
            cue_id: None,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn support(group: MotionTextPresetGroup, id: &str) -> Vec<MotionTextRendererPresetSupport> {
        let mut entries = [
            (MotionTextPresetGroup::Style, "base"),
            (MotionTextPresetGroup::Layout, "center"),
            (MotionTextPresetGroup::Enter, "fade"),
            (MotionTextPresetGroup::Hold, "still"),
            (MotionTextPresetGroup::Exit, "fade"),
            (MotionTextPresetGroup::Treat, "none"),
            (MotionTextPresetGroup::Bg, "transparent"),
            (MotionTextPresetGroup::Cam, "static"),
        ]
        .into_iter()
        .map(|(group, id)| MotionTextRendererPresetSupport {
            group,
            id: id.to_owned(),
        })
        .collect::<Vec<_>>();
        entries.push(MotionTextRendererPresetSupport {
            group,
            id: id.to_owned(),
        });
        entries
    }

    fn options(group: MotionTextPresetGroup, id: &str) -> CreateMotionTextPresetPreviewOptions {
        CreateMotionTextPresetPreviewOptions {
            sequence_id: format!("preview:{}:{id}", group_key(group)),
            preview_text: "RO CUT\nNEXT FRAME".to_owned(),
            language: "en".to_owned(),
            duration: 720_000,
            seed: Some(17),
            preset_group: group,
            preset_id: id.to_owned(),
            renderer_support: support(group, id),
        }
    }

    #[test]
    fn applies_a_supported_scalar_preset_to_defaults_and_every_cut() {
        let result =
            create_motion_text_preset_preview(options(MotionTextPresetGroup::Layout, "huge"));
        let document: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("supported preview creates a sequence"),
        )
        .expect("preview is JSON");
        assert_eq!(document["defaults"]["preset"]["layout"], "huge");
        let cuts = document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("preview has cuts");
        assert_eq!(cuts.len(), 2);
        assert!(cuts.iter().all(|cut| cut["preset"]["layout"] == "huge"));
    }

    #[test]
    fn applies_a_transition_only_when_a_previous_cut_exists() {
        let result =
            create_motion_text_preset_preview(options(MotionTextPresetGroup::Trans, "wipe"));
        let document: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("supported preview creates a sequence"),
        )
        .expect("preview is JSON");
        assert_eq!(document["defaults"]["preset"]["trans"], "wipe");
        assert_eq!(
            document["cues"][0]["overrides"]["preset"]["trans"],
            Value::Null
        );
        assert_eq!(document["cues"][1]["overrides"]["preset"]["trans"], "wipe");
        assert_eq!(
            document["resolvedPlan"]["cuts"][0]["preset"]["trans"],
            Value::Null
        );
        assert_eq!(
            document["resolvedPlan"]["cuts"][1]["preset"]["trans"],
            "wipe"
        );
    }

    #[test]
    fn rejects_a_preset_missing_from_renderer_support() {
        let mut input = options(MotionTextPresetGroup::Enter, "pop");
        input
            .renderer_support
            .retain(|entry| entry.group != MotionTextPresetGroup::Enter || entry.id != "pop");
        let result = create_motion_text_preset_preview(input);
        assert!(result.sequence_json.is_none());
        assert_eq!(result.diagnostics[0].code, "unsupported-preview-preset");
    }
}
