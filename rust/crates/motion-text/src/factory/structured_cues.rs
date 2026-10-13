use super::*;
use sha2::{Digest, Sha256};
#[cfg(test)]
mod tests;

const MAX_SAFE_TICKS: i64 = 9_007_199_254_740_991;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionTextStructuredCue {
    pub line_id: String,
    pub source_line: u32,
    pub text: String,
    pub start_ticks: i64,
    pub end_ticks: i64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMotionTextStructuredCuesOptions {
    pub sequence_id: String,
    pub source: String,
    pub cues: Vec<MotionTextStructuredCue>,
    pub language: String,
    pub duration_ticks: i64,
    pub seed: Option<u32>,
    pub starter_preset: MotionTextStarterPreset,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextLineMapping {
    pub line_id: String,
    pub source_line: u32,
    pub cue_id: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMotionTextStructuredCuesResult {
    pub sequence_json: Option<String>,
    pub diagnostics: Vec<MotionTextSequenceBuildDiagnostic>,
    pub line_mappings: Vec<MotionTextLineMapping>,
}

fn cue_id(sequence_id: &str, line_id: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"motion-text-structured-cue\0");
    hash.update(sequence_id.as_bytes());
    hash.update(b"\0");
    hash.update(line_id.as_bytes());
    format!("cue:{:x}", hash.finalize())
}

#[export]
pub fn create_motion_text_structured_cues(
    options: CreateMotionTextStructuredCuesOptions,
) -> CreateMotionTextStructuredCuesResult {
    let base = CreateMotionTextSequenceOptions {
        sequence_id: options.sequence_id.clone(),
        source: options.source.clone(),
        source_format: MotionTextSourceFormat::Plain,
        language: options.language,
        duration: options.duration_ticks,
        seed: options.seed,
        starter_preset: options.starter_preset,
        renderer_support: options.renderer_support,
    };
    let mut diagnostics = validate_factory_input(&base);
    if options.duration_ticks > MAX_SAFE_TICKS
        || options.cues.is_empty()
        || options.cues.len() > MAX_CUES
    {
        diagnostics.push(error(
            "invalid-structured-cues",
            "Structured cues require a bounded positive duration and non-empty cue list.",
        ));
    }
    // split preserves blank lines and exact text; only line delimiters are removed.
    let normalized = options.source.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut seen = BTreeSet::new();
    let mut previous_line = 0;
    let mut previous_end = 0;
    let mut timed = Vec::new();
    let mut mappings = Vec::new();
    for cue in options.cues {
        let source_text = cue
            .source_line
            .checked_sub(1)
            .and_then(|i| lines.get(i as usize));
        if cue.line_id.is_empty()
            || cue.line_id.len() > 500
            || cue.line_id.contains('\0')
            || !seen.insert(cue.line_id.clone())
            || cue.source_line <= previous_line
            || source_text.copied() != Some(cue.text.as_str())
            || cue.text.trim().is_empty()
            || cue.text.chars().count() > MAX_CUE_CHARACTERS
            || cue.start_ticks < previous_end
            || cue.start_ticks < 0
            || cue.end_ticks <= cue.start_ticks
            || cue.end_ticks > options.duration_ticks
            || cue.end_ticks > MAX_SAFE_TICKS
        {
            diagnostics.push(error(
                "invalid-structured-cue",
                "Cue identity, exact source line, order, or integer timing is invalid.",
            ));
            continue;
        }
        let id = cue_id(&options.sequence_id, &cue.line_id);
        mappings.push(MotionTextLineMapping {
            line_id: cue.line_id,
            source_line: cue.source_line,
            cue_id: id.clone(),
        });
        previous_line = cue.source_line;
        previous_end = cue.end_ticks;
        timed.push(TimedSourceCue {
            source: MotionTextSourceCue {
                id,
                source_line: cue.source_line,
                text: cue.text,
                start_ticks: Some(cue.start_ticks),
                interlude: false,
                interlude_duration_ticks: None,
                note: None,
                impact: false,
                emphasis: Vec::new(),
                manual_segments: None,
                gap_before: false,
            },
            start_time: cue.start_ticks,
            duration: cue.end_ticks - cue.start_ticks,
            timing_source: MotionTextCueTimingSourceDocument::Manual,
        });
    }
    if has_errors(&diagnostics) {
        return CreateMotionTextStructuredCuesResult {
            sequence_json: None,
            diagnostics,
            line_mappings: Vec::new(),
        };
    }
    let built = build_timed_sequence(base, timed, diagnostics);
    CreateMotionTextStructuredCuesResult {
        line_mappings: if built.sequence_json.is_some() {
            mappings
        } else {
            Vec::new()
        },
        sequence_json: built.sequence_json,
        diagnostics: built.diagnostics,
    }
}
