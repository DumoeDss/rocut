use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

mod preset_application;
mod text_edit;

use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::identity::valid_id;
use crate::planner::{
    MOTION_TEXT_PLAN_VERSION, MOTION_TEXT_TOKENIZER_VERSION, MotionTextCueInput,
    MotionTextDefaultsInput, MotionTextEngineInput, MotionTextOverridesInput,
    MotionTextParameterValue, MotionTextPlanDiagnosticSeverity, MotionTextPlanOptions,
    MotionTextPlannerCatalog, MotionTextPlanningControls, MotionTextPresetChoice,
    MotionTextPresetGroup, MotionTextPresetSelection, MotionTextRendererPresetSupport,
    MotionTextResolvedCut, MotionTextSequenceInput, MotionTextVariation, plan_motion_text_sequence,
    tokenize_motion_text,
};
use crate::source::{
    MOTION_TEXT_SCHEMA_VERSION, MotionTextDiagnosticSeverity, MotionTextSourceCue,
    ParseMotionTextSourceOptions, parse_motion_text_source,
};

pub const JIZURA_ENGINE_VERSION: &str = "0.9.0";
pub const JIZURA_CATALOG_HASH: &str =
    "sha256:9ec6f3be1a297152ccd377456348900fe0f4cc3b7629d21ec319976740f33d12";

const MAX_SOURCE_CHARACTERS: usize = 1_000_000;
const MAX_CUES: usize = 10_000;
const MAX_CUE_CHARACTERS: usize = 20_000;
const STARTER_PRESET_PARAMETER: &str = "rocut.starterPreset";
const DEFAULT_BUILTIN_FONT_ROLE_ID: &str = "gothic_bold";
const JIZURA_FONT_CATALOG_JSON: &str = include_str!("../resources/jizura-font-catalog.json");
const JIZURA_PLANNER_CATALOG_JSON: &str = include_str!("../resources/jizura-planner-catalog.json");

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTextSourceFormat {
    Plain,
    Lrc,
    Jizura,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTextStarterPreset {
    CleanCaption,
    ImpactTitle,
    EditorialPaper,
    MonoMarquee,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMotionTextSequenceOptions {
    pub sequence_id: String,
    pub source: String,
    pub source_format: MotionTextSourceFormat,
    pub language: String,
    pub duration: i64,
    pub seed: Option<u32>,
    pub starter_preset: MotionTextStarterPreset,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MotionTextSequenceBuildDiagnosticSeverity {
    Warning,
    Error,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextSequenceBuildDiagnostic {
    pub severity: MotionTextSequenceBuildDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub source_line: Option<u32>,
    pub cue_id: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMotionTextSequenceResult {
    pub sequence_json: Option<String>,
    pub diagnostics: Vec<MotionTextSequenceBuildDiagnostic>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestyleMotionTextSequenceOptions {
    pub sequence_json: String,
    pub starter_preset: MotionTextStarterPreset,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MutateMotionTextSequenceOptions {
    pub sequence_json: String,
    pub mutation_json: String,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMotionTextVariationCandidateOptions {
    pub sequence_json: String,
    pub salt: u32,
    #[serde(default)]
    pub cue_ids: Vec<String>,
    pub groups: Vec<MotionTextPresetGroup>,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextVariationCandidateResult {
    pub base_revision: Option<u32>,
    pub candidate_revision: Option<u32>,
    pub salt: u32,
    pub sequence_json: Option<String>,
    pub diagnostics: Vec<MotionTextSequenceBuildDiagnostic>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum MotionTextSequenceMutation {
    ApplyPreset {
        group: MotionTextPresetGroup,
        preset_id: String,
        #[serde(default)]
        cue_ids: Vec<String>,
    },
    UpdatePlanningControls {
        controls: MotionTextPlanningControls,
    },
    UpdateDefaults {
        font: OptionalFontMutation,
        colors: ColorMutation,
    },
    UpdateCue {
        cue_id: String,
        text: String,
        start_time: i64,
        duration: i64,
        preset: CuePresetMutation,
        font: OptionalFontMutation,
        colors: ColorMutation,
    },
    SetCutBoundary {
        cut_id: String,
        end_time: i64,
    },
    SetCueLock {
        cue_id: String,
        scope: String,
        key: String,
        locked: bool,
    },
    ApplyCueTaps {
        start_cue_id: String,
        tap_times: Vec<i64>,
    },
    SyncAudioTiming {
        asset_id: String,
        clip_id: Option<String>,
        source_offset: i64,
        duration: Option<i64>,
        content_digest: String,
        analysis: Option<AudioAnalysisMutation>,
    },
    SetAudioBinding {
        asset_id: String,
        clip_id: Option<String>,
        source_offset: i64,
        duration: Option<i64>,
        content_digest: String,
        analysis: Option<AudioAnalysisMutation>,
    },
    SetAudioBeatOverride {
        bpm: Option<f64>,
        first_beat: Option<i64>,
    },
    ClearAudioBinding,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AudioAnalysisMutation {
    version: u32,
    content_digest: String,
    bpm: Option<f64>,
    first_beat: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(
    tag = "mode",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum OptionalFontMutation {
    Keep,
    Inherit,
    Set { font_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(
    tag = "mode",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum CuePresetMutation {
    Keep,
    Inherit,
    Starter {
        starter_preset: MotionTextStarterPreset,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case")]
enum ColorMutation {
    Keep,
    Inherit,
    Set { foreground: String, accent: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextSequenceDocument {
    id: String,
    schema_version: u32,
    revision: u32,
    source: MotionTextSourceDocument,
    language: String,
    planning_controls: MotionTextPlanningControls,
    duration: i64,
    composition_mode: &'static str,
    seed: u32,
    engine: MotionTextEngineDocument,
    fonts: Vec<MotionTextFontDocument>,
    defaults: MotionTextDefaultsDocument,
    cues: Vec<MotionTextCueDocument>,
    resolved_plan: MotionTextResolvedPlanDocument,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextSourceDocument {
    format: MotionTextSourceFormat,
    text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextEngineDocument {
    id: &'static str,
    version: &'static str,
    catalog_hash: &'static str,
    planner_version: u32,
    tokenizer_version: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextFontDocument {
    id: String,
    #[serde(default = "builtin_font_source")]
    source: String,
    family: String,
    style: String,
    weight: u16,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    supported_languages: Vec<String>,
    builtin_path: String,
    content_digest: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextFontCatalogDocument {
    schema_version: u32,
    fonts: Vec<MotionTextBuiltinFontCatalogEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextBuiltinFontCatalogEntry {
    #[serde(flatten)]
    asset: MotionTextFontDocument,
    #[serde(default)]
    role_id: Option<String>,
    #[serde(default)]
    default_for_languages: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextPlannerCatalogDocument {
    schema_version: u32,
    choices: Vec<MotionTextPresetChoice>,
}

fn builtin_font_source() -> String {
    "builtin".to_owned()
}

fn builtin_font_catalog() -> &'static [MotionTextBuiltinFontCatalogEntry] {
    static FONTS: OnceLock<Vec<MotionTextBuiltinFontCatalogEntry>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let catalog: MotionTextFontCatalogDocument =
                serde_json::from_str(JIZURA_FONT_CATALOG_JSON)
                    .expect("the embedded JIZURA font catalog must be valid JSON");
            assert_eq!(catalog.schema_version, 1, "unsupported JIZURA font catalog");
            let mut seen = BTreeMap::new();
            let mut roles = BTreeSet::new();
            let mut base_roles = BTreeSet::new();
            let mut language_defaults = BTreeMap::new();
            for entry in &catalog.fonts {
                let font = &entry.asset;
                let role_id = builtin_font_role_id(entry);
                assert!(valid_id(&font.id), "invalid builtin font id: {}", font.id);
                assert!(valid_id(role_id), "invalid builtin font role id: {role_id}");
                assert_eq!(font.source, "builtin", "builtin font source drift");
                assert!(
                    font.builtin_path.starts_with("motion-text/fonts/")
                        && font.builtin_path.ends_with(".ttf")
                        && !font.builtin_path.contains(".."),
                    "invalid builtin font path: {}",
                    font.builtin_path
                );
                assert!(
                    font.content_digest.starts_with("sha256:") && font.content_digest.len() == 71,
                    "invalid builtin font digest: {}",
                    font.id
                );
                assert!(
                    seen.insert(font.id.clone(), ()).is_none(),
                    "duplicate builtin font id: {}",
                    font.id
                );
                roles.insert(role_id.to_owned());
                if font.id == role_id {
                    base_roles.insert(role_id.to_owned());
                }
                for language in &entry.default_for_languages {
                    assert!(
                        font.supported_languages
                            .iter()
                            .any(|supported| supported.eq_ignore_ascii_case(language)),
                        "builtin font {} defaults for undeclared language {language}",
                        font.id
                    );
                    let key = (role_id.to_owned(), language.to_ascii_lowercase());
                    assert!(
                        language_defaults.insert(key, font.id.clone()).is_none(),
                        "duplicate builtin language default for role {role_id} and {language}"
                    );
                }
            }
            assert_eq!(roles.len(), 23, "JIZURA font role catalog drift");
            assert_eq!(
                base_roles, roles,
                "each JIZURA font role must retain its stable base asset id"
            );
            catalog.fonts
        })
        .as_slice()
}

fn builtin_fonts() -> Vec<MotionTextFontDocument> {
    builtin_font_catalog()
        .iter()
        .map(|entry| entry.asset.clone())
        .collect()
}

fn builtin_font_role_id(entry: &MotionTextBuiltinFontCatalogEntry) -> &str {
    entry.role_id.as_deref().unwrap_or(&entry.asset.id)
}

fn language_range_matches(language: &str, range: &str) -> bool {
    let language = language.to_ascii_lowercase();
    let range = range.to_ascii_lowercase();
    language == range
        || language
            .strip_prefix(&range)
            .is_some_and(|suffix| suffix.starts_with('-'))
}

fn resolve_builtin_font_id_from_catalog(
    catalog: &[MotionTextBuiltinFontCatalogEntry],
    role_or_asset_id: &str,
    language: &str,
) -> Option<String> {
    if let Some(asset) = catalog.iter().find(|entry| {
        entry.asset.id == role_or_asset_id && builtin_font_role_id(entry) != role_or_asset_id
    }) {
        return Some(asset.asset.id.clone());
    }

    let mut language_match: Option<(&MotionTextBuiltinFontCatalogEntry, usize)> = None;
    for entry in catalog
        .iter()
        .filter(|entry| builtin_font_role_id(entry) == role_or_asset_id)
    {
        let specificity = entry
            .default_for_languages
            .iter()
            .filter(|range| language_range_matches(language, range))
            .map(|range| range.len())
            .max();
        if let Some(specificity) = specificity
            && language_match
                .as_ref()
                .is_none_or(|(_, current)| specificity > *current)
        {
            language_match = Some((entry, specificity));
        }
    }
    language_match
        .map(|(entry, _)| entry.asset.id.clone())
        .or_else(|| {
            catalog
                .iter()
                .find(|entry| entry.asset.id == role_or_asset_id)
                .map(|entry| entry.asset.id.clone())
        })
}

pub(crate) fn resolve_builtin_font_id(role_or_asset_id: &str, language: &str) -> String {
    resolve_builtin_font_id_from_catalog(builtin_font_catalog(), role_or_asset_id, language)
        .unwrap_or_else(|| role_or_asset_id.to_owned())
}

fn builtin_font_supports_language_from_catalog(
    catalog: &[MotionTextBuiltinFontCatalogEntry],
    font_id: &str,
    language: &str,
) -> bool {
    catalog
        .iter()
        .find(|entry| entry.asset.id == font_id)
        .is_some_and(|entry| {
            entry
                .asset
                .supported_languages
                .iter()
                .any(|range| language_range_matches(language, range))
        })
}

pub(crate) fn builtin_font_supports_language(font_id: &str, language: &str) -> bool {
    builtin_font_supports_language_from_catalog(builtin_font_catalog(), font_id, language)
}

fn jizura_planner_catalog() -> MotionTextPlannerCatalog {
    static CATALOG: OnceLock<MotionTextPlannerCatalog> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            let catalog: MotionTextPlannerCatalogDocument =
                serde_json::from_str(JIZURA_PLANNER_CATALOG_JSON)
                    .expect("the embedded JIZURA planner catalog must be valid JSON");
            assert_eq!(
                catalog.schema_version, 1,
                "unsupported JIZURA planner catalog"
            );
            assert_eq!(catalog.choices.len(), 887, "JIZURA planner catalog drift");
            MotionTextPlannerCatalog {
                choices: catalog.choices,
            }
        })
        .clone()
}

pub(crate) fn builtin_fonts_json() -> Value {
    serde_json::to_value(builtin_fonts()).expect("builtin fonts serialize infallibly")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextDefaultsDocument {
    preset: MotionTextPresetSelection,
    font_id: Option<String>,
    colors: BTreeMap<String, String>,
    parameters: BTreeMap<String, MotionTextParameterValue>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextCueDocument {
    id: String,
    text: String,
    start_time: i64,
    duration: i64,
    timing_source: MotionTextCueTimingSourceDocument,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_line: Option<u32>,
    interlude: bool,
    gap_before: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    impact: bool,
    emphasis: Vec<String>,
    segments: Vec<String>,
    locks: Vec<MotionTextLockDocument>,
    overrides: MotionTextOverridesDocument,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum MotionTextCueTimingSourceDocument {
    Lrc,
    Estimated,
}

#[derive(Clone, Debug, Serialize)]
struct MotionTextLockDocument;

#[derive(Clone, Debug, Serialize)]
struct MotionTextOverridesDocument {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextResolvedPlanDocument {
    version: u32,
    sequence_revision: u32,
    cuts: Vec<MotionTextResolvedCutDocument>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionTextResolvedCutDocument {
    id: String,
    cue_id: String,
    text: String,
    start_time: i64,
    duration: i64,
    seed: u32,
    preset: MotionTextPresetSelection,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_id: Option<String>,
    parameters: BTreeMap<String, MotionTextParameterValue>,
}

#[derive(Clone, Debug)]
struct TimedSourceCue {
    source: MotionTextSourceCue,
    start_time: i64,
    duration: i64,
    timing_source: MotionTextCueTimingSourceDocument,
}

#[export]
pub fn create_motion_text_sequence(
    options: CreateMotionTextSequenceOptions,
) -> CreateMotionTextSequenceResult {
    let mut diagnostics = validate_factory_input(&options);
    if has_errors(&diagnostics) {
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    }

    let parsed = parse_motion_text_source(ParseMotionTextSourceOptions {
        sequence_id: options.sequence_id.clone(),
        source: options.source.clone(),
    });
    diagnostics.extend(parsed.diagnostics.into_iter().map(|diagnostic| {
        MotionTextSequenceBuildDiagnostic {
            severity: match diagnostic.severity {
                MotionTextDiagnosticSeverity::Warning => {
                    MotionTextSequenceBuildDiagnosticSeverity::Warning
                }
                MotionTextDiagnosticSeverity::Error => {
                    MotionTextSequenceBuildDiagnosticSeverity::Error
                }
            },
            code: diagnostic.code,
            message: diagnostic.message,
            source_line: diagnostic.source_line,
            cue_id: None,
        }
    }));
    if has_errors(&diagnostics) {
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    }
    if parsed.cues.is_empty() {
        diagnostics.push(error(
            "empty-source",
            "Enter at least one renderable lyric line.",
        ));
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    }

    let timed_cues = match assign_cue_timing(parsed.cues, options.duration) {
        Ok(value) => value,
        Err(diagnostic) => {
            diagnostics.push(diagnostic);
            return CreateMotionTextSequenceResult {
                sequence_json: None,
                diagnostics,
            };
        }
    };
    let preset = starter_preset(options.starter_preset);
    let seed = options
        .seed
        .unwrap_or_else(|| stable_sequence_seed(&options.sequence_id));
    let default_parameters = starter_parameters(options.starter_preset);
    let fonts = builtin_fonts();
    let default_font_id =
        resolve_builtin_font_id(DEFAULT_BUILTIN_FONT_ROLE_ID, options.language.as_str());
    let cue_inputs: Vec<MotionTextCueInput> = timed_cues
        .iter()
        .map(|cue| MotionTextCueInput {
            id: cue.source.id.clone(),
            text: cue.source.text.clone(),
            start_time: cue.start_time,
            duration: cue.duration,
            interlude: cue.source.interlude,
            gap_before: cue.source.gap_before,
            impact: cue.source.impact,
            segments: cue.source.manual_segments.clone().unwrap_or_default(),
            cut_durations: Vec::new(),
            locks: Vec::new(),
            overrides: MotionTextOverridesInput::default(),
        })
        .collect();
    let plan_result = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: MotionTextSequenceInput {
            id: options.sequence_id.clone(),
            revision: 0,
            duration: options.duration,
            seed,
            language: options.language.clone(),
            planning_controls: MotionTextPlanningControls::default(),
            engine: MotionTextEngineInput {
                tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
            },
            defaults: MotionTextDefaultsInput {
                preset: preset.clone(),
                font_id: Some(default_font_id.clone()),
                parameters: default_parameters.clone(),
            },
            cues: cue_inputs,
            resolved_plan: None,
        },
        catalog: Default::default(),
        renderer_support: Some(options.renderer_support.clone()),
        randomize_groups: Vec::new(),
        variation: None,
    });
    diagnostics.extend(plan_result.diagnostics.into_iter().map(|diagnostic| {
        MotionTextSequenceBuildDiagnostic {
            severity: match diagnostic.severity {
                MotionTextPlanDiagnosticSeverity::Warning => {
                    MotionTextSequenceBuildDiagnosticSeverity::Warning
                }
                MotionTextPlanDiagnosticSeverity::Error => {
                    MotionTextSequenceBuildDiagnosticSeverity::Error
                }
            },
            code: diagnostic.code,
            message: diagnostic.message,
            source_line: None,
            cue_id: diagnostic.cue_id,
        }
    }));
    let Some(plan) = plan_result.plan else {
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    };

    let cue_language = options.language.clone();
    let document = MotionTextSequenceDocument {
        id: options.sequence_id,
        schema_version: MOTION_TEXT_SCHEMA_VERSION,
        revision: 0,
        source: MotionTextSourceDocument {
            format: options.source_format,
            text: options.source,
        },
        language: options.language,
        planning_controls: MotionTextPlanningControls::default(),
        duration: options.duration,
        composition_mode: "overlay",
        seed,
        engine: MotionTextEngineDocument {
            id: "jizura",
            version: JIZURA_ENGINE_VERSION,
            catalog_hash: JIZURA_CATALOG_HASH,
            planner_version: MOTION_TEXT_PLAN_VERSION,
            tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION,
        },
        fonts,
        defaults: MotionTextDefaultsDocument {
            preset,
            font_id: Some(default_font_id),
            colors: BTreeMap::new(),
            parameters: default_parameters,
        },
        cues: timed_cues
            .into_iter()
            .map(|cue| {
                let segments = if cue.source.interlude {
                    Vec::new()
                } else {
                    tokenize_motion_text(crate::planner::TokenizeMotionTextOptions {
                        text: cue.source.text.clone(),
                        language: cue_language.clone(),
                        explicit_segments: cue.source.manual_segments.clone().unwrap_or_default(),
                    })
                    .segments
                };
                MotionTextCueDocument {
                    id: cue.source.id,
                    text: cue.source.text,
                    start_time: cue.start_time,
                    duration: cue.duration,
                    timing_source: cue.timing_source,
                    source_line: Some(cue.source.source_line),
                    interlude: cue.source.interlude,
                    gap_before: cue.source.gap_before,
                    note: cue.source.note,
                    impact: cue.source.impact,
                    emphasis: cue.source.emphasis,
                    segments,
                    locks: Vec::new(),
                    overrides: MotionTextOverridesDocument {},
                }
            })
            .collect(),
        resolved_plan: MotionTextResolvedPlanDocument {
            version: plan.version,
            sequence_revision: plan.sequence_revision,
            cuts: plan.cuts.into_iter().map(resolved_cut_document).collect(),
        },
    };

    match serde_json::to_string(&document) {
        Ok(sequence_json) => CreateMotionTextSequenceResult {
            sequence_json: Some(sequence_json),
            diagnostics,
        },
        Err(serialization_error) => {
            diagnostics.push(error(
                "serialization-failed",
                format!("Motion-text sequence serialization failed: {serialization_error}"),
            ));
            CreateMotionTextSequenceResult {
                sequence_json: None,
                diagnostics,
            }
        }
    }
}

#[export]
pub fn restyle_motion_text_sequence(
    RestyleMotionTextSequenceOptions {
        sequence_json,
        starter_preset: starter_preset_id,
        renderer_support,
    }: RestyleMotionTextSequenceOptions,
) -> CreateMotionTextSequenceResult {
    let mut diagnostics = Vec::new();
    let mut document = match serde_json::from_str::<Value>(&sequence_json) {
        Ok(Value::Object(document)) => document,
        Ok(_) => {
            return failed_build(
                "invalid-sequence",
                "Motion-text sequence must be a JSON object.",
            );
        }
        Err(parse_error) => {
            return failed_build(
                "invalid-sequence-json",
                format!("Motion-text sequence JSON is invalid: {parse_error}"),
            );
        }
    };
    let mut input =
        match serde_json::from_value::<MotionTextSequenceInput>(Value::Object(document.clone())) {
            Ok(input) => input,
            Err(parse_error) => {
                return failed_build(
                    "invalid-sequence",
                    format!("Motion-text sequence cannot be planned: {parse_error}"),
                );
            }
        };
    let Some(next_revision) = input.revision.checked_add(1) else {
        return failed_build(
            "revision-overflow",
            "Motion-text sequence revision cannot be incremented.",
        );
    };
    let preset = starter_preset(starter_preset_id);
    let mut parameters = input.defaults.parameters.clone();
    parameters.extend(starter_parameters(starter_preset_id));
    input.revision = next_revision;
    input.defaults.preset = preset.clone();
    input.defaults.parameters = parameters.clone();
    seed_restyle_plan_for_locks(&mut input, &preset, &parameters);
    let plan_result = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: input,
        catalog: Default::default(),
        renderer_support: Some(renderer_support),
        randomize_groups: Vec::new(),
        variation: None,
    });
    diagnostics.extend(plan_result.diagnostics.into_iter().map(|diagnostic| {
        MotionTextSequenceBuildDiagnostic {
            severity: match diagnostic.severity {
                MotionTextPlanDiagnosticSeverity::Warning => {
                    MotionTextSequenceBuildDiagnosticSeverity::Warning
                }
                MotionTextPlanDiagnosticSeverity::Error => {
                    MotionTextSequenceBuildDiagnosticSeverity::Error
                }
            },
            code: diagnostic.code,
            message: diagnostic.message,
            source_line: None,
            cue_id: diagnostic.cue_id,
        }
    }));
    let Some(plan) = plan_result.plan else {
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    };
    document.insert("revision".to_owned(), Value::from(next_revision));
    let Some(Value::Object(defaults)) = document.get_mut("defaults") else {
        return failed_build(
            "invalid-sequence",
            "Motion-text sequence defaults must be an object.",
        );
    };
    defaults.insert(
        "preset".to_owned(),
        serde_json::to_value(preset).expect("preset serialization is infallible"),
    );
    defaults.insert(
        "parameters".to_owned(),
        serde_json::to_value(parameters).expect("parameter serialization is infallible"),
    );
    document.insert(
        "resolvedPlan".to_owned(),
        serde_json::to_value(MotionTextResolvedPlanDocument {
            version: plan.version,
            sequence_revision: plan.sequence_revision,
            cuts: plan.cuts.into_iter().map(resolved_cut_document).collect(),
        })
        .expect("resolved plan serialization is infallible"),
    );
    match serde_json::to_string(&Value::Object(document)) {
        Ok(sequence_json) => CreateMotionTextSequenceResult {
            sequence_json: Some(sequence_json),
            diagnostics,
        },
        Err(serialization_error) => failed_build(
            "serialization-failed",
            format!("Motion-text sequence serialization failed: {serialization_error}"),
        ),
    }
}

fn seed_restyle_plan_for_locks(
    input: &mut MotionTextSequenceInput,
    preset: &MotionTextPresetSelection,
    parameters: &BTreeMap<String, MotionTextParameterValue>,
) {
    let Some(plan) = input.resolved_plan.as_mut() else {
        return;
    };
    for cut in &mut plan.cuts {
        let Some(cue) = input.cues.iter().find(|cue| cue.id == cut.cue_id) else {
            continue;
        };
        let previous_preset = cut.preset.clone();
        let previous_parameters = cut.parameters.clone();
        let fully_locked = cue.locks.iter().any(|lock| {
            (lock.scope == "cue" && lock.key == "all")
                || (lock.scope == "cut" && lock.key == cut.id)
        });
        if fully_locked {
            continue;
        }
        cut.preset.clone_from(preset);
        cut.parameters.clone_from(parameters);
        if cue
            .locks
            .iter()
            .any(|lock| lock.scope == "cue" && lock.key == "preset")
        {
            cut.preset.clone_from(&previous_preset);
        } else {
            for lock in cue.locks.iter().filter(|lock| lock.scope == "preset-group") {
                restore_locked_preset_group(&mut cut.preset, &previous_preset, &lock.key);
            }
        }
        if cue
            .locks
            .iter()
            .any(|lock| lock.scope == "cue" && lock.key == "parameters")
        {
            cut.parameters.clone_from(&previous_parameters);
        } else {
            for lock in cue.locks.iter().filter(|lock| lock.scope == "parameter") {
                if let Some(value) = previous_parameters.get(&lock.key) {
                    cut.parameters.insert(lock.key.clone(), value.clone());
                }
            }
        }
    }
}

fn restore_locked_preset_group(
    target: &mut MotionTextPresetSelection,
    previous: &MotionTextPresetSelection,
    key: &str,
) {
    match key {
        "style" => target.style.clone_from(&previous.style),
        "layout" => target.layout.clone_from(&previous.layout),
        "enter" => target.enter.clone_from(&previous.enter),
        "hold" => target.hold.clone_from(&previous.hold),
        "exit" => target.exit.clone_from(&previous.exit),
        "decor" => target.decor.clone_from(&previous.decor),
        "treat" => target.treat.clone_from(&previous.treat),
        "bg" => target.bg.clone_from(&previous.bg),
        "cam" => target.cam.clone_from(&previous.cam),
        "fx" => target.fx.clone_from(&previous.fx),
        "trans" => target.trans.clone_from(&previous.trans),
        _ => {}
    }
}

#[export]
pub fn mutate_motion_text_sequence(
    MutateMotionTextSequenceOptions {
        sequence_json,
        mutation_json,
        renderer_support,
    }: MutateMotionTextSequenceOptions,
) -> CreateMotionTextSequenceResult {
    let mut document = match serde_json::from_str::<Value>(&sequence_json) {
        Ok(Value::Object(document)) => document,
        Ok(_) => {
            return failed_build(
                "invalid-sequence",
                "Motion-text sequence must be a JSON object.",
            );
        }
        Err(parse_error) => {
            return failed_build(
                "invalid-sequence-json",
                format!("Motion-text sequence JSON is invalid: {parse_error}"),
            );
        }
    };
    let mutation = match serde_json::from_str::<MotionTextSequenceMutation>(&mutation_json) {
        Ok(mutation) => mutation,
        Err(parse_error) => {
            return failed_build(
                "invalid-mutation",
                format!("Motion-text mutation is invalid: {parse_error}"),
            );
        }
    };
    let reset_plan_for_cue = match &mutation {
        MotionTextSequenceMutation::UpdateCue {
            cue_id,
            preset: CuePresetMutation::Inherit,
            ..
        } => Some(cue_id.clone()),
        _ => None,
    };
    let original = document.clone();
    if let MotionTextSequenceMutation::ApplyPreset {
        group, preset_id, ..
    } = &mutation
    {
        if !renderer_support
            .iter()
            .any(|entry| entry.group == *group && entry.id == *preset_id)
        {
            return failed_build(
                "unsupported-preset",
                "The selected preset is not supported by the active renderer.",
            );
        }
    }
    if let Err(result) = apply_sequence_mutation(&mut document, mutation) {
        return result;
    }
    if document == original {
        return failed_build(
            "no-changes",
            "The motion-text mutation has no changes to apply.",
        );
    }
    if let Some(cue_id) = reset_plan_for_cue {
        if let Err(result) = seed_cue_preset_inheritance(&mut document, &cue_id) {
            return result;
        }
    }
    replan_sequence_document(document, renderer_support)
}

#[export]
pub fn create_motion_text_variation_candidate(
    CreateMotionTextVariationCandidateOptions {
        sequence_json,
        salt,
        cue_ids,
        groups,
        renderer_support,
    }: CreateMotionTextVariationCandidateOptions,
) -> MotionTextVariationCandidateResult {
    let mut document = match serde_json::from_str::<Value>(&sequence_json) {
        Ok(Value::Object(document)) => document,
        Ok(_) => {
            return failed_variation_candidate(
                salt,
                None,
                "invalid-sequence",
                "Motion-text sequence must be a JSON object.",
            );
        }
        Err(parse_error) => {
            return failed_variation_candidate(
                salt,
                None,
                "invalid-sequence-json",
                format!("Motion-text sequence JSON is invalid: {parse_error}"),
            );
        }
    };
    let mut input =
        match serde_json::from_value::<MotionTextSequenceInput>(Value::Object(document.clone())) {
            Ok(input) => input,
            Err(parse_error) => {
                return failed_variation_candidate(
                    salt,
                    None,
                    "invalid-sequence",
                    format!("Motion-text sequence cannot be planned: {parse_error}"),
                );
            }
        };
    let base_revision = input.revision;
    let Some(candidate_revision) = base_revision.checked_add(1) else {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "revision-overflow",
            "Motion-text sequence revision cannot be incremented.",
        );
    };
    if groups.is_empty() {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "empty-variation-groups",
            "Select at least one preset group to vary.",
        );
    }
    let unique_groups: std::collections::BTreeSet<_> = groups.iter().copied().collect();
    if unique_groups.len() != groups.len() {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "duplicate-variation-group",
            "Motion-text variation groups must be unique.",
        );
    }
    let supported_groups: std::collections::BTreeSet<_> =
        renderer_support.iter().map(|entry| entry.group).collect();
    if unique_groups
        .iter()
        .any(|group| !supported_groups.contains(group))
    {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "unsupported-variation-group",
            "The active renderer has no candidates for a selected preset group.",
        );
    }

    let known_cue_ids: std::collections::BTreeSet<_> =
        input.cues.iter().map(|cue| cue.id.as_str()).collect();
    let unique_cue_ids: std::collections::BTreeSet<_> =
        cue_ids.iter().map(String::as_str).collect();
    if unique_cue_ids.len() != cue_ids.len() {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "duplicate-variation-cue",
            "Motion-text variation cue IDs must be unique.",
        );
    }
    if let Some(cue_id) = unique_cue_ids
        .iter()
        .find(|cue_id| !known_cue_ids.contains(**cue_id))
    {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "missing-variation-cue",
            format!("Motion-text variation cue {cue_id} does not exist."),
        );
    }

    let previous_cuts = input.resolved_plan.as_ref().map(|plan| plan.cuts.clone());
    input.revision = candidate_revision;
    let supported: std::collections::BTreeSet<_> = renderer_support
        .iter()
        .map(|entry| (entry.group, entry.id.as_str()))
        .collect();
    let mut catalog = jizura_planner_catalog();
    catalog
        .choices
        .retain(|choice| supported.contains(&(choice.group, choice.id.as_str())));
    let plan_result = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: input,
        catalog,
        renderer_support: Some(renderer_support),
        randomize_groups: Vec::new(),
        variation: Some(MotionTextVariation {
            salt,
            cue_ids,
            groups,
        }),
    });
    let diagnostics: Vec<_> = plan_result
        .diagnostics
        .into_iter()
        .map(plan_diagnostic_to_build_diagnostic)
        .collect();
    let Some(plan) = plan_result.plan else {
        return MotionTextVariationCandidateResult {
            base_revision: Some(base_revision),
            candidate_revision: None,
            salt,
            sequence_json: None,
            diagnostics,
        };
    };
    if previous_cuts
        .as_ref()
        .is_some_and(|cuts| cuts == &plan.cuts)
    {
        return failed_variation_candidate(
            salt,
            Some(base_revision),
            "no-variation",
            "The selected cues and preset groups are fully locked or have no alternative variation.",
        );
    }

    document.insert("revision".to_owned(), Value::from(candidate_revision));
    document.insert(
        "resolvedPlan".to_owned(),
        serde_json::to_value(MotionTextResolvedPlanDocument {
            version: plan.version,
            sequence_revision: plan.sequence_revision,
            cuts: plan.cuts.into_iter().map(resolved_cut_document).collect(),
        })
        .expect("resolved plan serialization is infallible"),
    );
    match serde_json::to_string(&Value::Object(document)) {
        Ok(sequence_json) => MotionTextVariationCandidateResult {
            base_revision: Some(base_revision),
            candidate_revision: Some(candidate_revision),
            salt,
            sequence_json: Some(sequence_json),
            diagnostics,
        },
        Err(serialization_error) => failed_variation_candidate(
            salt,
            Some(base_revision),
            "serialization-failed",
            format!("Motion-text sequence serialization failed: {serialization_error}"),
        ),
    }
}

fn apply_sequence_mutation(
    document: &mut Map<String, Value>,
    mutation: MotionTextSequenceMutation,
) -> Result<(), CreateMotionTextSequenceResult> {
    match mutation {
        MotionTextSequenceMutation::ApplyPreset {
            group,
            preset_id,
            cue_ids,
        } => {
            preset_application::apply(&mut *document, group, &preset_id, &cue_ids)?;
        }
        MotionTextSequenceMutation::UpdatePlanningControls { controls } => {
            document.insert(
                "planningControls".to_owned(),
                serde_json::to_value(controls)
                    .expect("motion-text planning controls serialize infallibly"),
            );
        }
        MotionTextSequenceMutation::UpdateDefaults { font, colors } => {
            if !matches!(colors, ColorMutation::Keep) && sequence_has_full_cue_lock(document) {
                return Err(failed_build(
                    "locked-default-colors",
                    "A fully locked cue prevents changing sequence colors because palettes are resolved at render time.",
                ));
            }
            validate_font_mutation(document, &font)?;
            let Some(Value::Object(defaults)) = document.get_mut("defaults") else {
                return Err(failed_build(
                    "invalid-sequence",
                    "Motion-text sequence defaults must be an object.",
                ));
            };
            apply_font_mutation(defaults, font);
            apply_default_color_mutation(defaults, colors)?;
        }
        MotionTextSequenceMutation::UpdateCue {
            cue_id,
            text,
            start_time,
            duration,
            preset,
            font,
            colors,
        } => {
            if !valid_id(&cue_id) {
                return Err(failed_build(
                    "invalid-cue-id",
                    "The motion-text cue id is invalid.",
                ));
            }
            let trimmed_text = text.trim();
            if trimmed_text.is_empty() {
                return Err(failed_cue_build(
                    "empty-cue-text",
                    "A lyric cue must contain text.",
                    &cue_id,
                ));
            }
            if trimmed_text.chars().count() > MAX_CUE_CHARACTERS {
                return Err(failed_cue_build(
                    "cue-text-limit",
                    "The lyric cue exceeds the supported character limit.",
                    &cue_id,
                ));
            }
            if start_time < 0 || duration <= 0 {
                return Err(failed_cue_build(
                    "invalid-cue-time",
                    "Cue start time must be non-negative and duration must be positive.",
                    &cue_id,
                ));
            }
            let sequence_duration = document
                .get("duration")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            if start_time >= sequence_duration
                || start_time.saturating_add(duration) > sequence_duration
            {
                return Err(failed_cue_build(
                    "cue-out-of-range",
                    "Cue timing must stay within the motion-text sequence.",
                    &cue_id,
                ));
            }
            validate_font_mutation(document, &font)?;
            let Some(cues) = document.get_mut("cues").and_then(Value::as_array_mut) else {
                return Err(failed_build(
                    "invalid-sequence",
                    "Motion-text sequence cues must be an array.",
                ));
            };
            let Some(Value::Object(cue)) = cues.iter_mut().find(|candidate| {
                candidate.get("id").and_then(Value::as_str) == Some(cue_id.as_str())
            }) else {
                return Err(failed_cue_build(
                    "missing-cue",
                    "The selected lyric cue no longer exists.",
                    &cue_id,
                ));
            };
            if cue_has_lock(cue, "cue", "all") {
                return Err(failed_cue_build(
                    "locked-cue",
                    "Unlock the whole cue before editing it.",
                    &cue_id,
                ));
            }
            let text_changed = cue.get("text").and_then(Value::as_str) != Some(trimmed_text);
            if text_changed && cue_has_lock_scope(cue, "cut") {
                return Err(failed_cue_build(
                    "locked-cue-cuts",
                    "Unlock this cue's cuts before changing text that defines their stable ids.",
                    &cue_id,
                ));
            }
            if !matches!(&preset, CuePresetMutation::Keep) && cue_preset_is_locked(cue) {
                return Err(failed_cue_build(
                    "locked-cue-preset",
                    "Unlock this cue's preset groups before changing its local style.",
                    &cue_id,
                ));
            }
            cue.insert("text".to_owned(), Value::String(trimmed_text.to_owned()));
            if text_changed {
                text_edit::refresh_segments(cue, trimmed_text, duration);
            }
            let previous_duration = cue.get("duration").and_then(Value::as_i64);
            let timing_changed = cue.get("startTime").and_then(Value::as_i64) != Some(start_time)
                || previous_duration != Some(duration);
            cue.insert("startTime".to_owned(), Value::from(start_time));
            cue.insert("duration".to_owned(), Value::from(duration));
            if previous_duration != Some(duration) {
                cue.remove("cutDurations");
            }
            if timing_changed {
                cue.insert(
                    "timingSource".to_owned(),
                    Value::String("manual".to_owned()),
                );
            }
            let overrides = object_field_mut(cue, "overrides")?;
            match preset {
                CuePresetMutation::Keep => {}
                CuePresetMutation::Inherit => {
                    overrides.remove("preset");
                }
                CuePresetMutation::Starter {
                    starter_preset: selected_starter_preset,
                } => {
                    overrides.insert(
                        "preset".to_owned(),
                        serde_json::to_value(starter_preset(selected_starter_preset))
                            .expect("preset serialization is infallible"),
                    );
                }
            }
            apply_font_mutation(overrides, font);
            apply_color_mutation(overrides, colors)?;
        }
        MotionTextSequenceMutation::SetCutBoundary { cut_id, end_time } => {
            apply_cut_boundary_mutation(document, &cut_id, end_time)?;
        }
        MotionTextSequenceMutation::SetCueLock {
            cue_id,
            scope,
            key,
            locked,
        } => {
            apply_cue_lock_mutation(document, &cue_id, &scope, &key, locked)?;
        }
        MotionTextSequenceMutation::ApplyCueTaps {
            start_cue_id,
            tap_times,
        } => {
            if !valid_id(&start_cue_id) {
                return Err(failed_build(
                    "invalid-cue-id",
                    "The first tapped motion-text cue id is invalid.",
                ));
            }
            if tap_times.is_empty() {
                return Err(failed_cue_build(
                    "empty-cue-taps",
                    "Record at least one cue tap before applying timing.",
                    &start_cue_id,
                ));
            }
            let sequence_duration = document
                .get("duration")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            if tap_times
                .iter()
                .any(|time| *time < 0 || *time >= sequence_duration)
                || tap_times.windows(2).any(|pair| pair[0] >= pair[1])
            {
                return Err(failed_cue_build(
                    "invalid-cue-taps",
                    "Cue taps must be strictly increasing and remain inside the sequence.",
                    &start_cue_id,
                ));
            }
            let Some(cues) = document.get_mut("cues").and_then(Value::as_array_mut) else {
                return Err(failed_build(
                    "invalid-sequence",
                    "Motion-text sequence cues must be an array.",
                ));
            };
            let Some(start_index) = cues.iter().position(|candidate| {
                candidate.get("id").and_then(Value::as_str) == Some(start_cue_id.as_str())
            }) else {
                return Err(failed_cue_build(
                    "missing-cue",
                    "The first tapped lyric cue no longer exists.",
                    &start_cue_id,
                ));
            };
            if tap_times.len() > cues.len().saturating_sub(start_index) {
                return Err(failed_cue_build(
                    "too-many-cue-taps",
                    "More cue taps were recorded than remaining lyric cues.",
                    &start_cue_id,
                ));
            }
            if start_index > 0 {
                let previous = &cues[start_index - 1];
                let previous_end = previous
                    .get("startTime")
                    .and_then(Value::as_i64)
                    .and_then(|start| {
                        previous
                            .get("duration")
                            .and_then(Value::as_i64)
                            .and_then(|duration| start.checked_add(duration))
                    })
                    .unwrap_or(i64::MAX);
                if previous_end > tap_times[0] {
                    return Err(failed_cue_build(
                        "cue-tap-overlap",
                        "The first tap overlaps the previous cue; start tapping from an earlier cue.",
                        &start_cue_id,
                    ));
                }
            }
            let untouched_next_start = cues
                .get(start_index + tap_times.len())
                .and_then(|cue| cue.get("startTime"))
                .and_then(Value::as_i64);
            for (offset, tap_time) in tap_times.iter().copied().enumerate() {
                let cue_index = start_index + offset;
                let cue_id = cues[cue_index]
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or(&start_cue_id)
                    .to_owned();
                if cues[cue_index]
                    .as_object()
                    .is_some_and(|cue| cue_has_lock(cue, "cue", "all"))
                {
                    return Err(failed_cue_build(
                        "locked-cue",
                        "Unlock the whole cue before applying tapped timing.",
                        &cue_id,
                    ));
                }
                let end_time = tap_times
                    .get(offset + 1)
                    .copied()
                    .or(untouched_next_start)
                    .unwrap_or(sequence_duration);
                let Some(duration) = end_time.checked_sub(tap_time) else {
                    return Err(failed_cue_build(
                        "cue-tap-overflow",
                        "Tapped cue timing overflowed.",
                        &cue_id,
                    ));
                };
                if duration <= 0 {
                    return Err(failed_cue_build(
                        "cue-tap-overlap",
                        "Tapped cue timing overlaps the next untouched cue.",
                        &cue_id,
                    ));
                }
                let Some(cue) = cues[cue_index].as_object_mut() else {
                    return Err(failed_build(
                        "invalid-sequence",
                        "Motion-text sequence cues must be objects.",
                    ));
                };
                cue.insert("startTime".to_owned(), Value::from(tap_time));
                cue.insert("duration".to_owned(), Value::from(duration));
                cue.insert("timingSource".to_owned(), Value::String("tap".to_owned()));
                cue.remove("cutDurations");
            }
        }
        MotionTextSequenceMutation::SyncAudioTiming {
            asset_id,
            clip_id,
            source_offset,
            duration,
            content_digest,
            analysis,
        } => {
            apply_audio_timing_sync(document, source_offset, analysis.as_ref())?;
            apply_audio_binding_mutation(
                document,
                asset_id,
                clip_id,
                source_offset,
                duration,
                content_digest,
                analysis,
            )?;
        }
        MotionTextSequenceMutation::SetAudioBinding {
            asset_id,
            clip_id,
            source_offset,
            duration,
            content_digest,
            analysis,
        } => {
            apply_audio_binding_mutation(
                document,
                asset_id,
                clip_id,
                source_offset,
                duration,
                content_digest,
                analysis,
            )?;
        }
        MotionTextSequenceMutation::SetAudioBeatOverride { bpm, first_beat } => {
            if bpm.is_some_and(|value| !value.is_finite() || !(20.0..=400.0).contains(&value))
                || first_beat.is_some_and(|value| value < 0)
            {
                return Err(failed_build(
                    "invalid-audio-beat-override",
                    "The manual motion-text BPM must be between 20 and 400 and its first beat must be non-negative.",
                ));
            }
            let Some(binding) = document
                .get_mut("audioBinding")
                .and_then(Value::as_object_mut)
            else {
                return Err(failed_build(
                    "missing-audio-binding",
                    "Bind an audio clip before setting a manual motion-text beat override.",
                ));
            };
            if bpm.is_none() && first_beat.is_none() {
                binding.remove("beatOverride");
            } else {
                let mut beat_override = Map::new();
                if let Some(bpm) = bpm {
                    beat_override.insert("bpm".to_owned(), Value::from(bpm));
                }
                if let Some(first_beat) = first_beat {
                    beat_override.insert("firstBeat".to_owned(), Value::from(first_beat));
                }
                binding.insert("beatOverride".to_owned(), Value::Object(beat_override));
            }
        }
        MotionTextSequenceMutation::ClearAudioBinding => {
            document.remove("audioBinding");
        }
    }
    Ok(())
}

fn apply_audio_timing_sync(
    document: &mut Map<String, Value>,
    new_source_offset: i64,
    new_analysis: Option<&AudioAnalysisMutation>,
) -> Result<(), CreateMotionTextSequenceResult> {
    let Some(binding) = document.get("audioBinding").and_then(Value::as_object) else {
        return Err(failed_build(
            "missing-audio-binding",
            "Bind an audio clip before previewing motion-text timing synchronization.",
        ));
    };
    let Some(old_source_offset) = binding.get("sourceOffset").and_then(Value::as_i64) else {
        return Err(failed_build(
            "invalid-audio-binding",
            "The existing motion-text audio binding has no valid source offset.",
        ));
    };
    let desired_delta =
        audio_sync_alignment_delta(binding, old_source_offset, new_source_offset, new_analysis)?;
    if desired_delta == 0 {
        return Ok(());
    }

    let sequence_duration = document
        .get("duration")
        .and_then(Value::as_i64)
        .filter(|duration| *duration > 0)
        .ok_or_else(|| {
            failed_build(
                "invalid-sequence",
                "Motion-text timing synchronization requires a positive sequence duration.",
            )
        })?;
    let Some(cues) = document.get_mut("cues").and_then(Value::as_array_mut) else {
        return Err(failed_build(
            "invalid-sequence",
            "Motion-text sequence cues must be an array.",
        ));
    };

    let mut index = 0;
    while index < cues.len() {
        if !cue_allows_audio_timing_sync(&cues[index]) {
            index += 1;
            continue;
        }
        let run_start = index;
        while index < cues.len() && cue_allows_audio_timing_sync(&cues[index]) {
            index += 1;
        }
        let run_end = index;
        let (first_start, _) = cue_time_range(&cues[run_start])?;
        let (_, last_end) = cue_time_range(&cues[run_end - 1])?;
        let left_boundary = if run_start == 0 {
            0
        } else {
            cue_time_range(&cues[run_start - 1])?.1
        };
        let right_boundary = if run_end == cues.len() {
            sequence_duration
        } else {
            cue_time_range(&cues[run_end])?.0
        };
        let Some(minimum_delta) = left_boundary.checked_sub(first_start) else {
            return Err(failed_build(
                "audio-sync-overflow",
                "The motion-text synchronization boundary overflowed.",
            ));
        };
        let Some(maximum_delta) = right_boundary.checked_sub(last_end) else {
            return Err(failed_build(
                "audio-sync-overflow",
                "The motion-text synchronization boundary overflowed.",
            ));
        };
        if minimum_delta > maximum_delta {
            return Err(failed_build(
                "invalid-cue-timing",
                "The existing cue timing cannot be synchronized without crossing a protected cue.",
            ));
        }
        let applied_delta = desired_delta.clamp(minimum_delta, maximum_delta);
        if applied_delta == 0 {
            continue;
        }
        for cue in &mut cues[run_start..run_end] {
            let (start_time, _) = cue_time_range(cue)?;
            let Some(next_start_time) = start_time.checked_add(applied_delta) else {
                return Err(failed_build(
                    "audio-sync-overflow",
                    "The synchronized cue time overflowed.",
                ));
            };
            let Some(cue) = cue.as_object_mut() else {
                return Err(failed_build(
                    "invalid-sequence",
                    "Motion-text sequence cues must be objects.",
                ));
            };
            cue.insert("startTime".to_owned(), Value::from(next_start_time));
        }
    }
    Ok(())
}

fn audio_sync_alignment_delta(
    binding: &Map<String, Value>,
    old_source_offset: i64,
    new_source_offset: i64,
    new_analysis: Option<&AudioAnalysisMutation>,
) -> Result<i64, CreateMotionTextSequenceResult> {
    if old_source_offset != new_source_offset {
        return i64::try_from(i128::from(old_source_offset) - i128::from(new_source_offset))
            .map_err(|_| {
                failed_build(
                    "audio-sync-overflow",
                    "The audio source alignment change overflowed.",
                )
            });
    }
    if binding
        .get("beatOverride")
        .and_then(Value::as_object)
        .and_then(|beat_override| beat_override.get("firstBeat"))
        .and_then(Value::as_i64)
        .is_some()
    {
        return Ok(0);
    }
    let old_first_beat = binding
        .get("analysis")
        .and_then(Value::as_object)
        .and_then(|analysis| analysis.get("firstBeat"))
        .and_then(Value::as_i64);
    let new_first_beat = new_analysis.and_then(|analysis| analysis.first_beat);
    let (Some(old_first_beat), Some(new_first_beat)) = (old_first_beat, new_first_beat) else {
        return Ok(0);
    };
    i64::try_from(
        (i128::from(new_first_beat) - i128::from(new_source_offset))
            - (i128::from(old_first_beat) - i128::from(old_source_offset)),
    )
    .map_err(|_| {
        failed_build(
            "audio-sync-overflow",
            "The detected audio beat alignment change overflowed.",
        )
    })
}

fn cue_allows_audio_timing_sync(cue: &Value) -> bool {
    let Some(cue) = cue.as_object() else {
        return false;
    };
    let timing_is_derived = matches!(
        cue.get("timingSource").and_then(Value::as_str),
        Some("lrc" | "estimated")
    );
    let is_locked = cue_has_lock(cue, "cue", "all");
    timing_is_derived && !is_locked
}

fn cue_time_range(cue: &Value) -> Result<(i64, i64), CreateMotionTextSequenceResult> {
    let Some(cue) = cue.as_object() else {
        return Err(failed_build(
            "invalid-sequence",
            "Motion-text sequence cues must be objects.",
        ));
    };
    let start_time = cue.get("startTime").and_then(Value::as_i64);
    let duration = cue.get("duration").and_then(Value::as_i64);
    let (Some(start_time), Some(duration)) = (start_time, duration) else {
        return Err(failed_build(
            "invalid-cue-timing",
            "Motion-text cue timing must contain integer start and duration values.",
        ));
    };
    if start_time < 0 || duration <= 0 {
        return Err(failed_build(
            "invalid-cue-timing",
            "Motion-text cue timing must be non-negative with a positive duration.",
        ));
    }
    let Some(end_time) = start_time.checked_add(duration) else {
        return Err(failed_build(
            "audio-sync-overflow",
            "The motion-text cue end time overflowed.",
        ));
    };
    Ok((start_time, end_time))
}

fn apply_audio_binding_mutation(
    document: &mut Map<String, Value>,
    asset_id: String,
    clip_id: Option<String>,
    source_offset: i64,
    duration: Option<i64>,
    content_digest: String,
    analysis: Option<AudioAnalysisMutation>,
) -> Result<(), CreateMotionTextSequenceResult> {
    if !valid_id(&asset_id) {
        return Err(failed_build(
            "invalid-audio-asset-id",
            "The motion-text audio asset id is invalid.",
        ));
    }
    if clip_id.as_ref().is_some_and(|id| !valid_id(id)) {
        return Err(failed_build(
            "invalid-audio-clip-id",
            "The motion-text audio clip id is invalid.",
        ));
    }
    if source_offset < 0 || duration.is_some_and(|value| value <= 0) {
        return Err(failed_build(
            "invalid-audio-range",
            "The motion-text audio source offset must be non-negative and its duration must be positive.",
        ));
    }
    if !valid_content_digest(&content_digest) {
        return Err(failed_build(
            "invalid-audio-digest",
            "The motion-text audio content digest must be a SHA-256 digest.",
        ));
    }
    if let Some(analysis) = &analysis {
        if analysis.version == 0
            || analysis.content_digest != content_digest
            || !valid_content_digest(&analysis.content_digest)
            || analysis
                .bpm
                .is_some_and(|bpm| !bpm.is_finite() || !(20.0..=400.0).contains(&bpm))
            || analysis.first_beat.is_some_and(|value| value < 0)
        {
            return Err(failed_build(
                "invalid-audio-analysis",
                "The motion-text audio analysis must match the bound content and contain valid timing values.",
            ));
        }
    }
    let mut binding = document
        .get("audioBinding")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    binding.insert("assetId".to_owned(), Value::String(asset_id));
    if let Some(clip_id) = clip_id {
        binding.insert("clipId".to_owned(), Value::String(clip_id));
    } else {
        binding.remove("clipId");
    }
    binding.insert("sourceOffset".to_owned(), Value::from(source_offset));
    if let Some(duration) = duration {
        binding.insert("duration".to_owned(), Value::from(duration));
    } else {
        binding.remove("duration");
    }
    binding.insert("contentDigest".to_owned(), Value::String(content_digest));
    if let Some(analysis) = analysis {
        binding.insert(
            "analysis".to_owned(),
            serde_json::to_value(analysis).expect("audio analysis serialization is infallible"),
        );
    } else {
        binding.remove("analysis");
    }
    document.insert("audioBinding".to_owned(), Value::Object(binding));
    Ok(())
}

fn valid_content_digest(digest: &str) -> bool {
    digest
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn apply_cut_boundary_mutation(
    document: &mut Map<String, Value>,
    cut_id: &str,
    end_time: i64,
) -> Result<(), CreateMotionTextSequenceResult> {
    if !valid_id(cut_id) {
        return Err(failed_build(
            "invalid-cut-id",
            "The motion-text cut id is invalid.",
        ));
    }
    if end_time <= 0 {
        return Err(failed_build(
            "invalid-cut-boundary",
            "A motion-text cut boundary must be a positive sequence time.",
        ));
    }
    let cuts = document
        .get("resolvedPlan")
        .and_then(Value::as_object)
        .and_then(|plan| plan.get("cuts"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            failed_build(
                "missing-resolved-plan",
                "Plan the motion-text sequence before editing a cut boundary.",
            )
        })?;
    let cue_id = cuts
        .iter()
        .find(|cut| cut.get("id").and_then(Value::as_str) == Some(cut_id))
        .and_then(|cut| cut.get("cueId"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            failed_build(
                "missing-cut",
                "The selected motion-text cut no longer exists.",
            )
        })?;
    let cue = document
        .get("cues")
        .and_then(Value::as_array)
        .and_then(|cues| {
            cues.iter()
                .find(|cue| cue.get("id").and_then(Value::as_str) == Some(cue_id.as_str()))
        })
        .and_then(Value::as_object)
        .ok_or_else(|| {
            failed_cue_build(
                "missing-cue",
                "The cut's lyric cue no longer exists.",
                &cue_id,
            )
        })?;
    let cue_start = cue
        .get("startTime")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            failed_cue_build(
                "invalid-cue-time",
                "The cut's lyric cue has no valid start time.",
                &cue_id,
            )
        })?;
    let cue_duration = cue.get("duration").and_then(Value::as_i64).ok_or_else(|| {
        failed_cue_build(
            "invalid-cue-time",
            "The cut's lyric cue has no valid duration.",
            &cue_id,
        )
    })?;
    let cue_end = cue_start.checked_add(cue_duration).ok_or_else(|| {
        failed_cue_build(
            "cue-time-overflow",
            "The cut's lyric cue time overflowed.",
            &cue_id,
        )
    })?;
    let locks = cue
        .get("locks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut cue_cuts: Vec<(String, i64, i64)> = cuts
        .iter()
        .filter(|cut| cut.get("cueId").and_then(Value::as_str) == Some(cue_id.as_str()))
        .map(|cut| {
            let id = cut.get("id").and_then(Value::as_str)?.to_owned();
            let start = cut.get("startTime").and_then(Value::as_i64)?;
            let duration = cut.get("duration").and_then(Value::as_i64)?;
            Some((id, start, duration))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| {
            failed_cue_build(
                "invalid-resolved-plan",
                "The cue's resolved cuts contain invalid timing.",
                &cue_id,
            )
        })?;
    cue_cuts.sort_by_key(|(_, start, _)| *start);
    let target_index = cue_cuts
        .iter()
        .position(|(id, _, _)| id == cut_id)
        .ok_or_else(|| {
            failed_build(
                "missing-cut",
                "The selected motion-text cut no longer exists.",
            )
        })?;
    let Some((next_cut_id, next_start, next_duration)) = cue_cuts.get(target_index + 1) else {
        return Err(failed_cue_build(
            "final-cut-boundary",
            "The final cut ends with its cue; edit an earlier cut boundary instead.",
            &cue_id,
        ));
    };
    let mut expected_start = cue_start;
    for (_, start, duration) in &cue_cuts {
        if *start != expected_start || *duration <= 0 {
            return Err(failed_cue_build(
                "noncontiguous-cuts",
                "Resolved cuts must exactly partition their cue before a boundary can be edited.",
                &cue_id,
            ));
        }
        expected_start = expected_start.checked_add(*duration).ok_or_else(|| {
            failed_cue_build(
                "cut-time-overflow",
                "The resolved cut timing overflowed.",
                &cue_id,
            )
        })?;
    }
    if expected_start != cue_end {
        return Err(failed_cue_build(
            "noncontiguous-cuts",
            "Resolved cuts must exactly partition their cue before a boundary can be edited.",
            &cue_id,
        ));
    }
    let (_, current_start, _) = &cue_cuts[target_index];
    let next_end = next_start.checked_add(*next_duration).ok_or_else(|| {
        failed_cue_build(
            "cut-time-overflow",
            "The following cut timing overflowed.",
            &cue_id,
        )
    })?;
    if end_time <= *current_start || end_time >= next_end {
        return Err(failed_cue_build(
            "invalid-cut-boundary",
            "A cut boundary must remain between the current cut start and the following cut end.",
            &cue_id,
        ));
    }
    let boundary_locked = locks.iter().any(|lock| {
        let Some(lock) = lock.as_object() else {
            return true;
        };
        match (
            lock.get("scope").and_then(Value::as_str),
            lock.get("key").and_then(Value::as_str),
        ) {
            (Some("cue"), Some("all")) => true,
            (Some("cut"), Some(key)) => key == cut_id || key == next_cut_id,
            _ => false,
        }
    });
    if boundary_locked {
        return Err(failed_cue_build(
            "locked-cut-boundary",
            "Clear the adjacent cut locks before moving this boundary.",
            &cue_id,
        ));
    }

    let mut durations: Vec<i64> = cue_cuts.iter().map(|(_, _, duration)| *duration).collect();
    durations[target_index] = end_time - *current_start;
    durations[target_index + 1] = next_end - end_time;
    let cue = document
        .get_mut("cues")
        .and_then(Value::as_array_mut)
        .and_then(|cues| {
            cues.iter_mut()
                .find(|cue| cue.get("id").and_then(Value::as_str) == Some(cue_id.as_str()))
        })
        .and_then(Value::as_object_mut)
        .expect("the validated cue remains present");
    cue.insert(
        "cutDurations".to_owned(),
        serde_json::to_value(durations).expect("cut durations serialize infallibly"),
    );
    Ok(())
}

fn replan_sequence_document(
    mut document: Map<String, Value>,
    renderer_support: Vec<MotionTextRendererPresetSupport>,
) -> CreateMotionTextSequenceResult {
    let mut input =
        match serde_json::from_value::<MotionTextSequenceInput>(Value::Object(document.clone())) {
            Ok(input) => input,
            Err(parse_error) => {
                return failed_build(
                    "invalid-sequence",
                    format!("Motion-text sequence cannot be planned: {parse_error}"),
                );
            }
        };
    let Some(next_revision) = input.revision.checked_add(1) else {
        return failed_build(
            "revision-overflow",
            "Motion-text sequence revision cannot be incremented.",
        );
    };
    input.revision = next_revision;
    let plan_result = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: input,
        catalog: jizura_planner_catalog(),
        renderer_support: Some(renderer_support),
        randomize_groups: Vec::new(),
        variation: None,
    });
    let diagnostics: Vec<_> = plan_result
        .diagnostics
        .into_iter()
        .map(|diagnostic| MotionTextSequenceBuildDiagnostic {
            severity: match diagnostic.severity {
                MotionTextPlanDiagnosticSeverity::Warning => {
                    MotionTextSequenceBuildDiagnosticSeverity::Warning
                }
                MotionTextPlanDiagnosticSeverity::Error => {
                    MotionTextSequenceBuildDiagnosticSeverity::Error
                }
            },
            code: diagnostic.code,
            message: diagnostic.message,
            source_line: None,
            cue_id: diagnostic.cue_id,
        })
        .collect();
    let Some(plan) = plan_result.plan else {
        return CreateMotionTextSequenceResult {
            sequence_json: None,
            diagnostics,
        };
    };
    document.insert("revision".to_owned(), Value::from(next_revision));
    document.insert(
        "resolvedPlan".to_owned(),
        serde_json::to_value(MotionTextResolvedPlanDocument {
            version: plan.version,
            sequence_revision: plan.sequence_revision,
            cuts: plan.cuts.into_iter().map(resolved_cut_document).collect(),
        })
        .expect("resolved plan serialization is infallible"),
    );
    match serde_json::to_string(&Value::Object(document)) {
        Ok(sequence_json) => CreateMotionTextSequenceResult {
            sequence_json: Some(sequence_json),
            diagnostics,
        },
        Err(serialization_error) => failed_build(
            "serialization-failed",
            format!("Motion-text sequence serialization failed: {serialization_error}"),
        ),
    }
}

fn seed_cue_preset_inheritance(
    document: &mut Map<String, Value>,
    cue_id: &str,
) -> Result<(), CreateMotionTextSequenceResult> {
    let mut input =
        serde_json::from_value::<MotionTextSequenceInput>(Value::Object(document.clone()))
            .map_err(|parse_error| {
                failed_build(
                    "invalid-sequence",
                    format!(
                        "Motion-text sequence cannot restore preset inheritance: {parse_error}"
                    ),
                )
            })?;
    let Some(cue) = input.cues.iter().find(|cue| cue.id == cue_id) else {
        return Err(failed_cue_build(
            "missing-cue",
            "The selected lyric cue no longer exists.",
            cue_id,
        ));
    };
    let Some(plan) = input.resolved_plan.as_mut() else {
        return Ok(());
    };
    for cut in plan.cuts.iter_mut().filter(|cut| cut.cue_id == cue_id) {
        let previous_preset = cut.preset.clone();
        let fully_locked = cue.locks.iter().any(|lock| {
            (lock.scope == "cue" && lock.key == "all")
                || (lock.scope == "cut" && lock.key == cut.id)
        });
        if fully_locked {
            continue;
        }
        cut.preset.clone_from(&input.defaults.preset);
        if cue
            .locks
            .iter()
            .any(|lock| lock.scope == "cue" && lock.key == "preset")
        {
            cut.preset.clone_from(&previous_preset);
            continue;
        }
        for lock in cue.locks.iter().filter(|lock| lock.scope == "preset-group") {
            restore_locked_preset_group(&mut cut.preset, &previous_preset, &lock.key);
        }
    }
    document.insert(
        "resolvedPlan".to_owned(),
        serde_json::to_value(input.resolved_plan)
            .expect("motion-text resolved plan serialization is infallible"),
    );
    Ok(())
}

fn sequence_has_full_cue_lock(document: &Map<String, Value>) -> bool {
    document
        .get("cues")
        .and_then(Value::as_array)
        .is_some_and(|cues| {
            cues.iter()
                .filter_map(Value::as_object)
                .any(|cue| cue_has_lock(cue, "cue", "all"))
        })
}

fn cue_has_lock(cue: &Map<String, Value>, scope: &str, key: &str) -> bool {
    cue.get("locks")
        .and_then(Value::as_array)
        .is_some_and(|locks| {
            locks.iter().any(|lock| {
                lock.get("scope").and_then(Value::as_str) == Some(scope)
                    && lock.get("key").and_then(Value::as_str) == Some(key)
            })
        })
}

fn cue_has_lock_scope(cue: &Map<String, Value>, scope: &str) -> bool {
    cue.get("locks")
        .and_then(Value::as_array)
        .is_some_and(|locks| {
            locks
                .iter()
                .any(|lock| lock.get("scope").and_then(Value::as_str) == Some(scope))
        })
}

fn cue_preset_is_locked(cue: &Map<String, Value>) -> bool {
    cue_has_lock(cue, "cue", "preset") || cue_has_lock_scope(cue, "preset-group")
}

fn apply_cue_lock_mutation(
    document: &mut Map<String, Value>,
    cue_id: &str,
    scope: &str,
    key: &str,
    locked: bool,
) -> Result<(), CreateMotionTextSequenceResult> {
    if !valid_id(cue_id) {
        return Err(failed_build(
            "invalid-cue-id",
            "The motion-text cue id is invalid.",
        ));
    }
    validate_lock_identity(scope, key)?;
    let cue_exists = document
        .get("cues")
        .and_then(Value::as_array)
        .is_some_and(|cues| {
            cues.iter()
                .any(|cue| cue.get("id").and_then(Value::as_str) == Some(cue_id))
        });
    if !cue_exists {
        return Err(failed_cue_build(
            "missing-cue",
            "The selected lyric cue no longer exists.",
            cue_id,
        ));
    }
    if locked && scope == "cut" && !resolved_cut_belongs_to_cue(document, cue_id, key) {
        return Err(failed_cue_build(
            "missing-lock-cut",
            "A cut lock must target a resolved cut that belongs to this cue.",
            cue_id,
        ));
    }
    if locked && scope == "parameter" && !resolved_parameter_belongs_to_cue(document, cue_id, key) {
        return Err(failed_cue_build(
            "missing-lock-parameter",
            "A parameter lock must target a resolved parameter used by this cue.",
            cue_id,
        ));
    }

    let cue = document
        .get_mut("cues")
        .and_then(Value::as_array_mut)
        .and_then(|cues| {
            cues.iter_mut()
                .find(|cue| cue.get("id").and_then(Value::as_str) == Some(cue_id))
        })
        .and_then(Value::as_object_mut)
        .expect("the validated cue remains present");
    let locks = cue
        .get_mut("locks")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            failed_cue_build(
                "invalid-cue-locks",
                "Motion-text cue locks must be an array.",
                cue_id,
            )
        })?;
    for lock in locks.iter() {
        let Some(lock) = lock.as_object() else {
            return Err(failed_cue_build(
                "invalid-cue-lock",
                "Motion-text cue locks must contain scope and key strings.",
                cue_id,
            ));
        };
        let Some(existing_scope) = lock.get("scope").and_then(Value::as_str) else {
            return Err(failed_cue_build(
                "invalid-cue-lock",
                "Motion-text cue locks must contain scope and key strings.",
                cue_id,
            ));
        };
        let Some(existing_key) = lock.get("key").and_then(Value::as_str) else {
            return Err(failed_cue_build(
                "invalid-cue-lock",
                "Motion-text cue locks must contain scope and key strings.",
                cue_id,
            ));
        };
        validate_lock_identity(existing_scope, existing_key)?;
    }
    locks.retain(|lock| {
        lock.get("scope").and_then(Value::as_str) != Some(scope)
            || lock.get("key").and_then(Value::as_str) != Some(key)
    });
    if locked {
        locks.push(serde_json::json!({ "scope": scope, "key": key }));
    }
    locks.sort_by(|left, right| {
        let left_scope = left
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_scope = right
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or_default();
        lock_scope_rank(left_scope)
            .cmp(&lock_scope_rank(right_scope))
            .then_with(|| left_scope.cmp(right_scope))
            .then_with(|| {
                left.get("key")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .cmp(right.get("key").and_then(Value::as_str).unwrap_or_default())
            })
    });
    Ok(())
}

fn validate_lock_identity(scope: &str, key: &str) -> Result<(), CreateMotionTextSequenceResult> {
    let valid = match scope {
        "cue" => matches!(key, "all" | "preset" | "parameters"),
        "cut" => valid_id(key),
        "preset-group" => matches!(
            key,
            "style"
                | "layout"
                | "enter"
                | "hold"
                | "exit"
                | "decor"
                | "treat"
                | "bg"
                | "cam"
                | "fx"
                | "trans"
        ),
        "parameter" => !key.is_empty() && key.len() <= 256 && !key.chars().any(char::is_control),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(failed_build(
            "invalid-cue-lock",
            "The motion-text cue lock scope or key is unsupported.",
        ))
    }
}

fn resolved_cut_belongs_to_cue(document: &Map<String, Value>, cue_id: &str, cut_id: &str) -> bool {
    document
        .get("resolvedPlan")
        .and_then(Value::as_object)
        .and_then(|plan| plan.get("cuts"))
        .and_then(Value::as_array)
        .is_some_and(|cuts| {
            cuts.iter().any(|cut| {
                cut.get("id").and_then(Value::as_str) == Some(cut_id)
                    && cut.get("cueId").and_then(Value::as_str) == Some(cue_id)
            })
        })
}

fn resolved_parameter_belongs_to_cue(
    document: &Map<String, Value>,
    cue_id: &str,
    key: &str,
) -> bool {
    document
        .get("resolvedPlan")
        .and_then(Value::as_object)
        .and_then(|plan| plan.get("cuts"))
        .and_then(Value::as_array)
        .is_some_and(|cuts| {
            cuts.iter().any(|cut| {
                cut.get("cueId").and_then(Value::as_str) == Some(cue_id)
                    && cut
                        .get("parameters")
                        .and_then(Value::as_object)
                        .is_some_and(|parameters| parameters.contains_key(key))
            })
        })
}

fn lock_scope_rank(scope: &str) -> u8 {
    match scope {
        "cue" => 0,
        "preset-group" => 1,
        "cut" => 2,
        "parameter" => 3,
        _ => 4,
    }
}

fn validate_font_mutation(
    document: &Map<String, Value>,
    font: &OptionalFontMutation,
) -> Result<(), CreateMotionTextSequenceResult> {
    let OptionalFontMutation::Set { font_id } = font else {
        return Ok(());
    };
    if !valid_id(font_id) {
        return Err(failed_build(
            "invalid-font-id",
            "The selected motion-text font id is invalid.",
        ));
    }
    let exists = document
        .get("fonts")
        .and_then(Value::as_array)
        .is_some_and(|fonts| {
            fonts
                .iter()
                .any(|font| font.get("id").and_then(Value::as_str) == Some(font_id.as_str()))
        });
    if !exists {
        return Err(failed_build(
            "missing-font",
            format!("The selected motion-text font {font_id} is not in this sequence."),
        ));
    }
    Ok(())
}

fn apply_font_mutation(document: &mut Map<String, Value>, font: OptionalFontMutation) {
    match font {
        OptionalFontMutation::Keep => {}
        OptionalFontMutation::Inherit => {
            document.remove("fontId");
        }
        OptionalFontMutation::Set { font_id } => {
            document.insert("fontId".to_owned(), Value::String(font_id));
        }
    }
}

fn apply_color_mutation(
    document: &mut Map<String, Value>,
    colors: ColorMutation,
) -> Result<(), CreateMotionTextSequenceResult> {
    match colors {
        ColorMutation::Keep => {}
        ColorMutation::Inherit => {
            document.remove("colors");
        }
        ColorMutation::Set { foreground, accent } => {
            if !valid_hex_color(&foreground) || !valid_hex_color(&accent) {
                return Err(failed_build(
                    "invalid-color",
                    "Motion-text colors must use #RRGGBB or #RRGGBBAA hex notation.",
                ));
            }
            let colors = object_field_mut(document, "colors")?;
            colors.insert("foreground".to_owned(), Value::String(foreground));
            colors.insert("accent".to_owned(), Value::String(accent));
        }
    }
    Ok(())
}

fn apply_default_color_mutation(
    document: &mut Map<String, Value>,
    colors: ColorMutation,
) -> Result<(), CreateMotionTextSequenceResult> {
    match colors {
        ColorMutation::Keep => Ok(()),
        ColorMutation::Inherit => {
            document.insert("colors".to_owned(), Value::Object(Map::new()));
            Ok(())
        }
        colors => apply_color_mutation(document, colors),
    }
}

fn object_field_mut<'a>(
    document: &'a mut Map<String, Value>,
    field: &str,
) -> Result<&'a mut Map<String, Value>, CreateMotionTextSequenceResult> {
    if !document.contains_key(field) {
        document.insert(field.to_owned(), Value::Object(Map::new()));
    }
    document
        .get_mut(field)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            failed_build(
                "invalid-sequence",
                format!("Motion-text {field} must be an object."),
            )
        })
}

fn valid_hex_color(value: &str) -> bool {
    matches!(value.len(), 7 | 9)
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_factory_input(
    options: &CreateMotionTextSequenceOptions,
) -> Vec<MotionTextSequenceBuildDiagnostic> {
    let mut diagnostics = Vec::new();
    if !valid_id(&options.sequence_id) {
        diagnostics.push(error(
            "invalid-sequence-id",
            "The motion-text sequence id is invalid.",
        ));
    }
    if options.duration <= 0 {
        diagnostics.push(error(
            "invalid-duration",
            "Motion-text duration must be positive.",
        ));
    }
    if options.language.trim().is_empty() {
        diagnostics.push(error(
            "invalid-language",
            "Motion-text language must not be empty.",
        ));
    }
    if options.source.chars().count() > MAX_SOURCE_CHARACTERS {
        diagnostics.push(error(
            "source-limit",
            "Motion-text source exceeds the supported character limit.",
        ));
    }
    diagnostics
}

fn assign_cue_timing(
    cues: Vec<MotionTextSourceCue>,
    sequence_duration: i64,
) -> Result<Vec<TimedSourceCue>, MotionTextSequenceBuildDiagnostic> {
    if cues.len() > MAX_CUES {
        return Err(error(
            "cue-limit",
            "Motion-text source exceeds the supported cue limit.",
        ));
    }
    let timed_count = cues.iter().filter(|cue| cue.start_ticks.is_some()).count();
    if timed_count > 0 && timed_count < cues.len() {
        return Err(error(
            "mixed-lrc-timing",
            "Use timestamps on every lyric line or remove all timestamps.",
        ));
    }
    if timed_count == cues.len() {
        return assign_explicit_timing(cues, sequence_duration);
    }
    assign_even_timing(cues, sequence_duration)
}

fn assign_explicit_timing(
    cues: Vec<MotionTextSourceCue>,
    sequence_duration: i64,
) -> Result<Vec<TimedSourceCue>, MotionTextSequenceBuildDiagnostic> {
    let mut timed = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let start_time = cue.start_ticks.unwrap_or_default();
        if start_time < 0 || start_time >= sequence_duration {
            return Err(error(
                "cue-out-of-range",
                "A lyric timestamp falls outside the selected duration.",
            ));
        }
        let next_later_start = cues
            .iter()
            .skip(index + 1)
            .filter_map(|candidate| candidate.start_ticks)
            .find(|candidate| *candidate > start_time)
            .unwrap_or(sequence_duration);
        let duration = cue
            .interlude_duration_ticks
            .unwrap_or_else(|| next_later_start.saturating_sub(start_time));
        if duration <= 0 || start_time.saturating_add(duration) > sequence_duration {
            return Err(error(
                "invalid-cue-duration",
                "A lyric line has no positive duration inside the sequence.",
            ));
        }
        timed.push(TimedSourceCue {
            source: cue.clone(),
            start_time,
            duration,
            timing_source: MotionTextCueTimingSourceDocument::Lrc,
        });
    }
    Ok(timed)
}

fn assign_even_timing(
    cues: Vec<MotionTextSourceCue>,
    sequence_duration: i64,
) -> Result<Vec<TimedSourceCue>, MotionTextSequenceBuildDiagnostic> {
    let fixed_total = cues
        .iter()
        .filter_map(|cue| cue.interlude_duration_ticks)
        .try_fold(0_i64, i64::checked_add)
        .ok_or_else(|| error("duration-overflow", "Interlude durations overflowed."))?;
    let flexible_count = cues
        .iter()
        .filter(|cue| cue.interlude_duration_ticks.is_none())
        .count();
    if fixed_total > sequence_duration {
        return Err(error(
            "interlude-duration-overflow",
            "Interlude durations exceed the selected sequence duration.",
        ));
    }
    let remaining = sequence_duration - fixed_total;
    if flexible_count > 0 && remaining < i64::try_from(flexible_count).unwrap_or(i64::MAX) {
        return Err(error(
            "invalid-cue-duration",
            "The selected duration is too short for every lyric line.",
        ));
    }
    let flexible_count_i64 = i64::try_from(flexible_count).unwrap_or(i64::MAX);
    let base = if flexible_count == 0 {
        0
    } else {
        remaining / flexible_count_i64
    };
    let remainder = if flexible_count == 0 {
        0
    } else {
        remaining % flexible_count_i64
    };
    let mut flexible_index = 0_i64;
    let mut start_time = 0_i64;
    let mut timed = Vec::with_capacity(cues.len());
    for cue in cues {
        let duration = match cue.interlude_duration_ticks {
            Some(duration) => duration,
            None => {
                let duration = base + i64::from(flexible_index < remainder);
                flexible_index += 1;
                duration
            }
        };
        if duration <= 0 {
            return Err(error(
                "invalid-cue-duration",
                "Every lyric line requires a positive duration.",
            ));
        }
        timed.push(TimedSourceCue {
            source: cue,
            start_time,
            duration,
            timing_source: MotionTextCueTimingSourceDocument::Estimated,
        });
        start_time = start_time.saturating_add(duration);
    }
    Ok(timed)
}

pub(crate) fn starter_preset(value: MotionTextStarterPreset) -> MotionTextPresetSelection {
    let (style, layout, enter, hold, exit, treat, cam) = match value {
        MotionTextStarterPreset::CleanCaption => {
            ("base", "center", "fade", "still", "fade", "none", "static")
        }
        MotionTextStarterPreset::ImpactTitle => (
            "crimson", "huge", "pop", "pulse", "shrink", "outline", "push",
        ),
        MotionTextStarterPreset::EditorialPaper => (
            "paper",
            "type",
            "wipe",
            "drift",
            "wipe",
            "underline",
            "static",
        ),
        MotionTextStarterPreset::MonoMarquee => (
            "mono",
            "marquee",
            "slideL",
            "float",
            "slideOutL",
            "outlineFill",
            "static",
        ),
    };
    MotionTextPresetSelection {
        style: style.to_owned(),
        layout: layout.to_owned(),
        enter: enter.to_owned(),
        hold: hold.to_owned(),
        exit: exit.to_owned(),
        decor: Vec::new(),
        treat: treat.to_owned(),
        bg: "transparent".to_owned(),
        cam: cam.to_owned(),
        fx: Vec::new(),
        trans: None,
    }
}

fn starter_parameters(
    value: MotionTextStarterPreset,
) -> BTreeMap<String, MotionTextParameterValue> {
    BTreeMap::from([(
        STARTER_PRESET_PARAMETER.to_owned(),
        MotionTextParameterValue::String(
            match value {
                MotionTextStarterPreset::CleanCaption => "clean-caption",
                MotionTextStarterPreset::ImpactTitle => "impact-title",
                MotionTextStarterPreset::EditorialPaper => "editorial-paper",
                MotionTextStarterPreset::MonoMarquee => "mono-marquee",
            }
            .to_owned(),
        ),
    )])
}

fn resolved_cut_document(cut: MotionTextResolvedCut) -> MotionTextResolvedCutDocument {
    MotionTextResolvedCutDocument {
        id: cut.id,
        cue_id: cut.cue_id,
        text: cut.text,
        start_time: cut.start_time,
        duration: cut.duration,
        seed: cut.seed,
        preset: cut.preset,
        font_id: cut.font_id,
        parameters: cut.parameters,
    }
}

pub(crate) fn stable_sequence_seed(sequence_id: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for byte in sequence_id.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn has_errors(diagnostics: &[MotionTextSequenceBuildDiagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == MotionTextSequenceBuildDiagnosticSeverity::Error)
}

fn plan_diagnostic_to_build_diagnostic(
    diagnostic: crate::planner::MotionTextPlanDiagnostic,
) -> MotionTextSequenceBuildDiagnostic {
    MotionTextSequenceBuildDiagnostic {
        severity: match diagnostic.severity {
            MotionTextPlanDiagnosticSeverity::Warning => {
                MotionTextSequenceBuildDiagnosticSeverity::Warning
            }
            MotionTextPlanDiagnosticSeverity::Error => {
                MotionTextSequenceBuildDiagnosticSeverity::Error
            }
        },
        code: diagnostic.code,
        message: diagnostic.message,
        source_line: None,
        cue_id: diagnostic.cue_id,
    }
}

fn error(code: &str, message: impl Into<String>) -> MotionTextSequenceBuildDiagnostic {
    MotionTextSequenceBuildDiagnostic {
        severity: MotionTextSequenceBuildDiagnosticSeverity::Error,
        code: code.to_owned(),
        message: message.into(),
        source_line: None,
        cue_id: None,
    }
}

fn failed_build(code: &str, message: impl Into<String>) -> CreateMotionTextSequenceResult {
    CreateMotionTextSequenceResult {
        sequence_json: None,
        diagnostics: vec![error(code, message)],
    }
}

fn failed_cue_build(
    code: &str,
    message: impl Into<String>,
    cue_id: &str,
) -> CreateMotionTextSequenceResult {
    CreateMotionTextSequenceResult {
        sequence_json: None,
        diagnostics: vec![MotionTextSequenceBuildDiagnostic {
            severity: MotionTextSequenceBuildDiagnosticSeverity::Error,
            code: code.to_owned(),
            message: message.into(),
            source_line: None,
            cue_id: Some(cue_id.to_owned()),
        }],
    }
}

fn failed_variation_candidate(
    salt: u32,
    base_revision: Option<u32>,
    code: &str,
    message: impl Into<String>,
) -> MotionTextVariationCandidateResult {
    MotionTextVariationCandidateResult {
        base_revision,
        candidate_revision: None,
        salt,
        sequence_json: None,
        diagnostics: vec![error(code, message)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn renderer_support() -> Vec<MotionTextRendererPresetSupport> {
        [
            ("style", ["base", "crimson", "paper", "mono"].as_slice()),
            ("layout", ["center", "huge", "type", "marquee"].as_slice()),
            ("enter", ["fade", "pop", "wipe", "slideL"].as_slice()),
            ("hold", ["still", "pulse", "drift", "float"].as_slice()),
            ("exit", ["fade", "shrink", "wipe", "slideOutL"].as_slice()),
            (
                "treat",
                ["none", "outline", "underline", "outlineFill"].as_slice(),
            ),
            ("bg", ["transparent"].as_slice()),
            ("cam", ["static", "push"].as_slice()),
        ]
        .into_iter()
        .flat_map(|(group, ids)| {
            ids.iter().map(move |id| MotionTextRendererPresetSupport {
                group: match group {
                    "style" => crate::planner::MotionTextPresetGroup::Style,
                    "layout" => crate::planner::MotionTextPresetGroup::Layout,
                    "enter" => crate::planner::MotionTextPresetGroup::Enter,
                    "hold" => crate::planner::MotionTextPresetGroup::Hold,
                    "exit" => crate::planner::MotionTextPresetGroup::Exit,
                    "treat" => crate::planner::MotionTextPresetGroup::Treat,
                    "bg" => crate::planner::MotionTextPresetGroup::Bg,
                    "cam" => crate::planner::MotionTextPresetGroup::Cam,
                    _ => unreachable!("fixture group is valid"),
                },
                id: (*id).to_owned(),
            })
        })
        .collect()
    }

    fn options(source: &str) -> CreateMotionTextSequenceOptions {
        CreateMotionTextSequenceOptions {
            sequence_id: "sequence:starter".to_owned(),
            source: source.to_owned(),
            source_format: MotionTextSourceFormat::Plain,
            language: "zh-Hans".to_owned(),
            duration: 1_800_000,
            seed: Some(7),
            starter_preset: MotionTextStarterPreset::CleanCaption,
            renderer_support: renderer_support(),
        }
    }

    fn catalog_font(
        id: &str,
        role_id: Option<&str>,
        supported_languages: &[&str],
        default_for_languages: &[&str],
    ) -> MotionTextBuiltinFontCatalogEntry {
        MotionTextBuiltinFontCatalogEntry {
            asset: MotionTextFontDocument {
                id: id.to_owned(),
                source: "builtin".to_owned(),
                family: id.to_owned(),
                style: "normal".to_owned(),
                weight: 700,
                supported_languages: supported_languages
                    .iter()
                    .map(|language| (*language).to_owned())
                    .collect(),
                builtin_path: format!("motion-text/fonts/{id}.ttf"),
                content_digest: format!("sha256:{}", "0".repeat(64)),
            },
            role_id: role_id.map(str::to_owned),
            default_for_languages: default_for_languages
                .iter()
                .map(|language| (*language).to_owned())
                .collect(),
        }
    }

    #[test]
    fn resolves_language_variants_without_remapping_explicit_asset_ids() {
        let catalog = vec![
            catalog_font("gothic_bold", None, &["ja", "en"], &[]),
            catalog_font(
                "gothic_bold_zh_hans",
                Some("gothic_bold"),
                &["zh-Hans", "en"],
                &["zh-Hans"],
            ),
        ];

        assert_eq!(
            resolve_builtin_font_id_from_catalog(&catalog, "gothic_bold", "zh-Hans-CN").as_deref(),
            Some("gothic_bold_zh_hans")
        );
        assert_eq!(
            resolve_builtin_font_id_from_catalog(&catalog, "gothic_bold", "ja").as_deref(),
            Some("gothic_bold")
        );
        assert_eq!(
            resolve_builtin_font_id_from_catalog(&catalog, "gothic_bold_zh_hans", "ja").as_deref(),
            Some("gothic_bold_zh_hans")
        );
        assert!(builtin_font_supports_language_from_catalog(
            &catalog,
            "gothic_bold_zh_hans",
            "zh-Hans-CN"
        ));
        assert!(!builtin_font_supports_language_from_catalog(
            &catalog,
            "gothic_bold",
            "zh-Hans"
        ));
    }

    #[test]
    fn creates_a_complete_chinese_sequence_with_even_untimed_cues() {
        let result = create_motion_text_sequence(options("风从城里来\n灯在雨里亮\n我们继续向前"));
        assert!(!has_errors(&result.diagnostics));
        let document: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("valid input creates a sequence"),
        )
        .expect("sequence is JSON");
        assert_eq!(document["schemaVersion"], 1);
        assert_eq!(document["duration"], 1_800_000);
        assert_eq!(document["engine"]["version"], JIZURA_ENGINE_VERSION);
        assert_eq!(document["fonts"].as_array().map(Vec::len), Some(25));
        assert_eq!(document["defaults"]["fontId"], "gothic_bold_zh_hans");
        assert_eq!(document["fonts"][0]["source"], "builtin");
        assert_eq!(document["fonts"][0]["supportedLanguages"][0], "ja");
        assert_eq!(
            document["fonts"][0]["builtinPath"],
            "motion-text/fonts/noto-sans-jp-variable.ttf"
        );
        assert!(
            document["fonts"][0]["contentDigest"]
                .as_str()
                .is_some_and(|digest| digest.starts_with("sha256:"))
        );
        assert_eq!(document["cues"].as_array().map(Vec::len), Some(3));
        assert_eq!(document["cues"][0]["startTime"], 0);
        assert_eq!(document["cues"][0]["duration"], 600_000);
        assert_eq!(document["cues"][0]["timingSource"], "estimated");
        assert!(document["cues"][0]["overrides"].is_object());
        assert_eq!(document["cues"][2]["startTime"], 1_200_000);
        assert!(
            document["resolvedPlan"]["cuts"]
                .as_array()
                .is_some_and(|cuts| !cuts.is_empty())
        );
        assert!(
            document["resolvedPlan"]["cuts"]
                .as_array()
                .is_some_and(|cuts| cuts
                    .iter()
                    .all(|cut| { cut["fontId"].as_str() == Some("gothic_bold_zh_hans") }))
        );
    }

    #[test]
    fn uses_lrc_timestamps_for_cue_boundaries() {
        let mut input = options("[00:01]第一句\n[00:04]第二句");
        input.source_format = MotionTextSourceFormat::Lrc;
        let result = create_motion_text_sequence(input);
        let document: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("valid LRC creates a sequence"),
        )
        .expect("sequence is JSON");
        assert_eq!(document["cues"][0]["startTime"], 120_000);
        assert_eq!(document["cues"][0]["duration"], 360_000);
        assert_eq!(document["cues"][0]["timingSource"], "lrc");
        assert_eq!(document["cues"][1]["startTime"], 480_000);
        assert_eq!(document["cues"][1]["duration"], 1_320_000);
    }

    #[test]
    fn applies_taps_from_a_stable_cue_with_one_revision() {
        let created = create_motion_text_sequence(options("第一句\n第二句\n第三句"));
        let original: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let second_cue_id = original["cues"][1]["id"]
            .as_str()
            .expect("second cue has an id");
        let tapped = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: original.to_string(),
            mutation_json: serde_json::json!({
                "kind": "apply-cue-taps",
                "startCueId": second_cue_id,
                "tapTimes": [720_000, 1_320_000]
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let document: Value = serde_json::from_str(
            tapped
                .sequence_json
                .as_deref()
                .expect("valid taps update the sequence"),
        )
        .expect("tap result is JSON");

        assert_eq!(document["revision"], 1);
        assert_eq!(document["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(document["cues"][0]["startTime"], 0);
        assert_eq!(document["cues"][0]["timingSource"], "estimated");
        assert_eq!(document["cues"][1]["startTime"], 720_000);
        assert_eq!(document["cues"][1]["duration"], 600_000);
        assert_eq!(document["cues"][1]["timingSource"], "tap");
        assert_eq!(document["cues"][2]["startTime"], 1_320_000);
        assert_eq!(document["cues"][2]["duration"], 480_000);
        assert_eq!(document["cues"][2]["timingSource"], "tap");
    }

    #[test]
    fn moves_a_stable_cut_boundary_and_persists_the_partition() {
        let created = create_motion_text_sequence(options("一/二/三\n第四句"));
        let original: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let cue_id = original["cues"][0]["id"]
            .as_str()
            .expect("first cue has an id")
            .to_owned();
        let cut_id = original["resolvedPlan"]["cuts"]
            .as_array()
            .expect("fixture has cuts")
            .iter()
            .find(|cut| cut["cueId"] == cue_id)
            .and_then(|cut| cut["id"].as_str())
            .expect("first cue has a cut")
            .to_owned();
        let moved = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: original.to_string(),
            mutation_json: serde_json::json!({
                "kind": "set-cut-boundary",
                "cutId": cut_id,
                "endTime": 400_000
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let moved: Value = serde_json::from_str(
            moved
                .sequence_json
                .as_deref()
                .expect("valid cut boundary succeeds"),
        )
        .expect("cut mutation is JSON");
        assert_eq!(moved["revision"], 1);
        assert_eq!(
            moved["cues"][0]["cutDurations"],
            serde_json::json!([400_000, 200_000, 300_000])
        );
        let cut_durations: Vec<_> = moved["resolvedPlan"]["cuts"]
            .as_array()
            .expect("replanned cuts exist")
            .iter()
            .filter(|cut| cut["cueId"] == cue_id)
            .map(|cut| cut["duration"].as_i64().expect("cut duration is valid"))
            .collect();
        assert_eq!(cut_durations, vec![400_000, 200_000, 300_000]);

        let updated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: moved.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": "改后一二三",
                "startTime": 0,
                "duration": 900_000,
                "preset": { "mode": "keep" },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let updated: Value = serde_json::from_str(
            updated
                .sequence_json
                .as_deref()
                .expect("later cue edits preserve custom cut timing"),
        )
        .expect("later cue edit is JSON");
        assert_eq!(updated["revision"], 2);
        assert_eq!(
            updated["cues"][0]["cutDurations"],
            serde_json::json!([400_000, 200_000, 300_000])
        );
    }

    #[test]
    fn rejects_empty_and_partially_timed_sources() {
        let empty = create_motion_text_sequence(options("  \n# comment"));
        assert!(empty.sequence_json.is_none());
        assert!(
            empty
                .diagnostics
                .iter()
                .any(|entry| entry.code == "empty-source")
        );

        let mixed = create_motion_text_sequence(options("[00:01]timed\nuntimed"));
        assert!(mixed.sequence_json.is_none());
        assert!(
            mixed
                .diagnostics
                .iter()
                .any(|entry| entry.code == "mixed-lrc-timing")
        );
    }

    #[test]
    fn fails_when_the_renderer_cannot_honor_the_starter_preset() {
        let mut input = options("一行文字");
        input.renderer_support.clear();
        let result = create_motion_text_sequence(input);
        assert!(result.sequence_json.is_none());
        assert!(
            result.diagnostics.iter().any(|entry| {
                entry.severity == MotionTextSequenceBuildDiagnosticSeverity::Error
            })
        );
    }

    #[test]
    fn restyles_a_sequence_with_one_revision_and_preserves_unknown_fields() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        document["futureExtension"] = serde_json::json!({ "keep": [1, 2, 3] });
        let restyled = restyle_motion_text_sequence(RestyleMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            starter_preset: MotionTextStarterPreset::ImpactTitle,
            renderer_support: renderer_support(),
        });
        let restyled: Value =
            serde_json::from_str(restyled.sequence_json.as_deref().expect("restyle succeeds"))
                .expect("restyle is JSON");
        assert_eq!(restyled["revision"], 1);
        assert_eq!(restyled["defaults"]["preset"]["style"], "crimson");
        assert_eq!(
            restyled["defaults"]["parameters"][STARTER_PRESET_PARAMETER],
            "impact-title"
        );
        assert_eq!(restyled["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(
            restyled["resolvedPlan"]["cuts"][0]["preset"]["style"],
            "crimson"
        );
        assert_eq!(
            restyled["futureExtension"]["keep"],
            serde_json::json!([1, 2, 3])
        );
    }

    #[test]
    fn restyle_updates_unlocked_values_and_preserves_locked_snapshots() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        document["cues"][0]["locks"] = serde_json::json!([
            { "scope": "preset-group", "key": "layout" },
            { "scope": "parameter", "key": STARTER_PRESET_PARAMETER }
        ]);
        document["cues"][1]["locks"] = serde_json::json!([{ "scope": "cue", "key": "all" }]);

        let restyled = restyle_motion_text_sequence(RestyleMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            starter_preset: MotionTextStarterPreset::ImpactTitle,
            renderer_support: renderer_support(),
        });
        let restyled: Value = serde_json::from_str(
            restyled
                .sequence_json
                .as_deref()
                .expect("scoped restyle succeeds"),
        )
        .expect("restyle is JSON");
        let first_cue_id = restyled["cues"][0]["id"]
            .as_str()
            .expect("first cue has an id");
        let second_cue_id = restyled["cues"][1]["id"]
            .as_str()
            .expect("second cue has an id");
        let cuts = restyled["resolvedPlan"]["cuts"]
            .as_array()
            .expect("restyle has cuts");
        let first_cut = cuts
            .iter()
            .find(|cut| cut["cueId"] == first_cue_id)
            .expect("first cue has a cut");
        let second_cut = cuts
            .iter()
            .find(|cut| cut["cueId"] == second_cue_id)
            .expect("second cue has a cut");

        assert_eq!(restyled["revision"], 1);
        assert_eq!(restyled["defaults"]["preset"]["style"], "crimson");
        assert_eq!(first_cut["preset"]["style"], "crimson");
        assert_eq!(first_cut["preset"]["layout"], "center");
        assert_eq!(
            first_cut["parameters"][STARTER_PRESET_PARAMETER],
            "clean-caption"
        );
        assert_eq!(second_cut["preset"]["style"], "base");
        assert_eq!(
            second_cut["parameters"][STARTER_PRESET_PARAMETER],
            "clean-caption"
        );
    }

    #[test]
    fn mutates_defaults_and_replans_with_one_revision() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "update-defaults",
                "font": { "mode": "inherit" },
                "colors": {
                    "mode": "set",
                    "foreground": "#112233",
                    "accent": "#445566"
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let document: Value = serde_json::from_str(
            mutated
                .sequence_json
                .as_deref()
                .expect("default mutation succeeds"),
        )
        .expect("mutation result is JSON");

        assert_eq!(document["revision"], 1);
        assert_eq!(document["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(document["defaults"]["colors"]["foreground"], "#112233");
        assert_eq!(document["defaults"]["colors"]["accent"], "#445566");
    }

    #[test]
    fn stored_language_variant_asset_survives_replan_and_json_round_trip() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let variant_id = "gothic_bold_zh_hans";
        let mut variant = document["fonts"][1].clone();
        variant["id"] = Value::String(variant_id.to_owned());
        variant["family"] = Value::String("Noto Sans SC".to_owned());
        variant["supportedLanguages"] = serde_json::json!(["zh-Hans", "en"]);
        document["fonts"]
            .as_array_mut()
            .expect("fonts stay an array")
            .push(variant);
        document["defaults"]["fontId"] = Value::String(variant_id.to_owned());
        for cut in document["resolvedPlan"]["cuts"]
            .as_array_mut()
            .expect("resolved cuts stay an array")
        {
            cut["fontId"] = Value::String(variant_id.to_owned());
        }

        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-defaults",
                "font": { "mode": "keep" },
                "colors": {
                    "mode": "set",
                    "foreground": "#112233",
                    "accent": "#445566"
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let reopened: Value = serde_json::from_str(
            mutated
                .sequence_json
                .as_deref()
                .expect("variant-bearing sequence replans"),
        )
        .expect("replanned sequence round-trips as JSON");

        assert_eq!(reopened["defaults"]["fontId"], variant_id);
        assert!(
            reopened["resolvedPlan"]["cuts"]
                .as_array()
                .is_some_and(|cuts| cuts
                    .iter()
                    .all(|cut| cut["fontId"].as_str() == Some(variant_id)))
        );
    }

    #[test]
    fn planning_controls_use_jizura_defaults_and_mutate_atomically() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let created_document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("created sequence is JSON");
        assert_eq!(
            created_document["planningControls"],
            serde_json::json!({
                "presetSets": { "horror": false, "typo": true, "kinetic": true },
                "unify": false,
                "centerFree": false,
                "centerDirection": "tb"
            })
        );

        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-planning-controls",
                "controls": {
                    "presetSets": { "horror": true, "typo": false, "kinetic": true },
                    "unify": true,
                    "centerFree": true,
                    "centerDirection": "lr"
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let document: Value = serde_json::from_str(
            mutated
                .sequence_json
                .as_deref()
                .expect("planning control mutation succeeds"),
        )
        .expect("mutated sequence is JSON");
        assert_eq!(document["revision"], 1);
        assert_eq!(document["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(document["planningControls"]["presetSets"]["horror"], true);
        assert_eq!(document["planningControls"]["presetSets"]["typo"], false);
        assert_eq!(document["planningControls"]["unify"], true);
        assert_eq!(document["planningControls"]["centerFree"], true);
        assert_eq!(
            document["resolvedPlan"]["cuts"][0]["parameters"]["jizura.centerFree"]["direction"],
            "lr"
        );
    }

    #[test]
    fn binds_and_clears_analyzed_audio_without_losing_opaque_fields() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        document["futureExtension"] = serde_json::json!({ "keep": true });
        let digest = format!("sha256:{}", "a".repeat(64));
        let bound = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 24_000,
                "duration": 1_200_000,
                "contentDigest": digest,
                "analysis": {
                    "version": 1,
                    "contentDigest": digest,
                    "bpm": 120.0,
                    "firstBeat": 12_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let bound_document: Value = serde_json::from_str(
            bound
                .sequence_json
                .as_deref()
                .expect("audio binding succeeds"),
        )
        .expect("binding result is JSON");

        assert_eq!(bound_document["revision"], 1);
        assert_eq!(bound_document["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(bound_document["audioBinding"]["assetId"], "asset:music");
        assert_eq!(bound_document["audioBinding"]["clipId"], "clip:music");
        assert_eq!(bound_document["audioBinding"]["sourceOffset"], 24_000);
        assert_eq!(bound_document["audioBinding"]["analysis"]["bpm"], 120.0);
        assert_eq!(bound_document["futureExtension"]["keep"], true);

        let mut bound_document = bound_document;
        bound_document["audioBinding"]["futureBindingField"] = serde_json::json!({ "keep": true });
        let overridden = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: bound_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "set-audio-beat-override",
                "bpm": 128.0,
                "firstBeat": 30_000
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let overridden_document: Value = serde_json::from_str(
            overridden
                .sequence_json
                .as_deref()
                .expect("beat override succeeds"),
        )
        .expect("beat override result is JSON");
        assert_eq!(overridden_document["revision"], 2);
        assert_eq!(overridden_document["resolvedPlan"]["sequenceRevision"], 2);
        assert_eq!(
            overridden_document["audioBinding"]["beatOverride"]["bpm"],
            128.0
        );
        assert_eq!(
            overridden_document["audioBinding"]["futureBindingField"]["keep"],
            true
        );

        let rebound = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: overridden_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 48_000,
                "duration": 1_200_000,
                "contentDigest": digest,
                "analysis": {
                    "version": 1,
                    "contentDigest": digest,
                    "bpm": 120.0,
                    "firstBeat": 12_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let rebound_document: Value = serde_json::from_str(
            rebound
                .sequence_json
                .as_deref()
                .expect("audio rebinding succeeds"),
        )
        .expect("audio rebinding result is JSON");
        assert_eq!(rebound_document["revision"], 3);
        assert_eq!(
            rebound_document["audioBinding"]["beatOverride"]["bpm"],
            128.0
        );
        assert_eq!(
            rebound_document["audioBinding"]["futureBindingField"]["keep"],
            true
        );

        let cleared = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: rebound_document.to_string(),
            mutation_json: serde_json::json!({ "kind": "clear-audio-binding" }).to_string(),
            renderer_support: renderer_support(),
        });
        let cleared_document: Value = serde_json::from_str(
            cleared
                .sequence_json
                .as_deref()
                .expect("audio binding clear succeeds"),
        )
        .expect("clear result is JSON");
        assert_eq!(cleared_document["revision"], 4);
        assert!(cleared_document.get("audioBinding").is_none());
        assert_eq!(cleared_document["futureExtension"]["keep"], true);
    }

    #[test]
    fn rejects_audio_analysis_from_different_content() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let digest = format!("sha256:{}", "a".repeat(64));
        let different_digest = format!("sha256:{}", "b".repeat(64));
        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:music",
                "clipId": null,
                "sourceOffset": 0,
                "duration": null,
                "contentDigest": digest,
                "analysis": {
                    "version": 1,
                    "contentDigest": different_digest,
                    "bpm": 120.0,
                    "firstBeat": 0
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });

        assert!(mutated.sequence_json.is_none());
        assert_eq!(mutated.diagnostics[0].code, "invalid-audio-analysis");
    }

    #[test]
    fn synchronizes_only_derived_unlocked_cues_and_updates_binding_atomically() {
        let created = create_motion_text_sequence(options("一\n二\n三\n四\n五\n六"));
        let old_digest = format!("sha256:{}", "a".repeat(64));
        let new_digest = format!("sha256:{}", "b".repeat(64));
        let bound = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:old-audio",
                "clipId": "clip:old-audio",
                "sourceOffset": 100_000,
                "duration": 1_500_000,
                "contentDigest": old_digest,
                "analysis": {
                    "version": 1,
                    "contentDigest": old_digest,
                    "bpm": 120.0,
                    "firstBeat": 120_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mut document: Value = serde_json::from_str(
            bound
                .sequence_json
                .as_deref()
                .expect("audio binding succeeds"),
        )
        .expect("binding result is JSON");
        let base_revision = document["revision"].as_u64().expect("revision is valid");
        document["audioBinding"]["beatOverride"] =
            serde_json::json!({ "bpm": 128.0, "firstBeat": 130_000 });
        document["cues"][0]["startTime"] = Value::from(100_000);
        document["cues"][0]["duration"] = Value::from(100_000);
        document["cues"][0]["cutDurations"] = serde_json::json!([100_000]);
        document["cues"][1]["startTime"] = Value::from(250_000);
        document["cues"][1]["duration"] = Value::from(100_000);
        document["cues"][1]["timingSource"] = Value::String("lrc".to_owned());
        document["cues"][2]["startTime"] = Value::from(500_000);
        document["cues"][2]["duration"] = Value::from(100_000);
        document["cues"][2]["timingSource"] = Value::String("manual".to_owned());
        document["cues"][3]["startTime"] = Value::from(700_000);
        document["cues"][3]["duration"] = Value::from(100_000);
        document["cues"][3]["locks"] = serde_json::json!([{ "scope": "cue", "key": "all" }]);
        document["cues"][4]["startTime"] = Value::from(900_000);
        document["cues"][4]["duration"] = Value::from(100_000);
        document["cues"][4]["timingSource"] = Value::String("tap".to_owned());
        document["cues"][5]["startTime"] = Value::from(1_100_000);
        document["cues"][5]["duration"] = Value::from(100_000);
        document["cues"][5]["timingSource"] = Value::String("legacy".to_owned());

        let synchronized = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "sync-audio-timing",
                "assetId": "asset:new-audio",
                "clipId": "clip:new-audio",
                "sourceOffset": 150_000,
                "duration": 1_400_000,
                "contentDigest": new_digest,
                "analysis": {
                    "version": 2,
                    "contentDigest": new_digest,
                    "bpm": 123.0,
                    "firstBeat": 220_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let synchronized: Value = serde_json::from_str(
            synchronized
                .sequence_json
                .as_deref()
                .expect("audio synchronization succeeds"),
        )
        .expect("synchronization result is JSON");

        assert_eq!(synchronized["revision"], base_revision + 1);
        assert_eq!(
            synchronized["resolvedPlan"]["sequenceRevision"],
            base_revision + 1
        );
        assert_eq!(synchronized["cues"][0]["startTime"], 50_000);
        assert_eq!(synchronized["cues"][1]["startTime"], 200_000);
        assert_eq!(synchronized["cues"][2]["startTime"], 500_000);
        assert_eq!(synchronized["cues"][3]["startTime"], 700_000);
        assert_eq!(synchronized["cues"][4]["startTime"], 900_000);
        assert_eq!(synchronized["cues"][5]["startTime"], 1_100_000);
        assert_eq!(
            synchronized["cues"][0]["cutDurations"],
            serde_json::json!([100_000])
        );
        assert_eq!(synchronized["cues"][0]["timingSource"], "estimated");
        assert_eq!(synchronized["cues"][1]["timingSource"], "lrc");
        assert_eq!(synchronized["cues"][2]["timingSource"], "manual");
        assert_eq!(synchronized["cues"][4]["timingSource"], "tap");
        assert_eq!(synchronized["audioBinding"]["assetId"], "asset:new-audio");
        assert_eq!(synchronized["audioBinding"]["clipId"], "clip:new-audio");
        assert_eq!(synchronized["audioBinding"]["sourceOffset"], 150_000);
        assert_eq!(synchronized["audioBinding"]["duration"], 1_400_000);
        assert_eq!(synchronized["audioBinding"]["contentDigest"], new_digest);
        assert_eq!(synchronized["audioBinding"]["analysis"]["version"], 2);
        assert_eq!(
            synchronized["audioBinding"]["beatOverride"],
            serde_json::json!({ "bpm": 128.0, "firstBeat": 130_000 })
        );
    }

    #[test]
    fn clamps_each_synchronized_run_between_protected_cues() {
        let created = create_motion_text_sequence(options("一\n二\n三\n四\n五"));
        let digest = format!("sha256:{}", "c".repeat(64));
        let bound = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 300_000,
                "duration": 1_500_000,
                "contentDigest": digest,
                "analysis": null
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mut document: Value = serde_json::from_str(
            bound
                .sequence_json
                .as_deref()
                .expect("audio binding succeeds"),
        )
        .expect("binding result is JSON");
        document["cues"][0]["startTime"] = Value::from(100_000);
        document["cues"][0]["duration"] = Value::from(200_000);
        document["cues"][0]["timingSource"] = Value::String("manual".to_owned());
        document["cues"][1]["startTime"] = Value::from(350_000);
        document["cues"][1]["duration"] = Value::from(100_000);
        document["cues"][2]["startTime"] = Value::from(500_000);
        document["cues"][2]["duration"] = Value::from(100_000);
        document["cues"][2]["timingSource"] = Value::String("lrc".to_owned());
        document["cues"][3]["startTime"] = Value::from(650_000);
        document["cues"][3]["duration"] = Value::from(100_000);
        document["cues"][3]["timingSource"] = Value::String("tap".to_owned());
        document["cues"][4]["startTime"] = Value::from(800_000);
        document["cues"][4]["duration"] = Value::from(100_000);

        let synchronized = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "sync-audio-timing",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 100_000,
                "duration": 1_500_000,
                "contentDigest": digest,
                "analysis": null
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let synchronized: Value = serde_json::from_str(
            synchronized
                .sequence_json
                .as_deref()
                .expect("clamped synchronization succeeds"),
        )
        .expect("synchronization result is JSON");

        assert_eq!(synchronized["cues"][0]["startTime"], 100_000);
        assert_eq!(synchronized["cues"][1]["startTime"], 400_000);
        assert_eq!(synchronized["cues"][2]["startTime"], 550_000);
        assert_eq!(synchronized["cues"][3]["startTime"], 650_000);
        assert_eq!(synchronized["cues"][4]["startTime"], 1_000_000);
    }

    #[test]
    fn uses_detected_phase_changes_unless_first_beat_is_overridden() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let old_digest = format!("sha256:{}", "d".repeat(64));
        let phase_digest = format!("sha256:{}", "e".repeat(64));
        let override_digest = format!("sha256:{}", "f".repeat(64));
        let bound = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "set-audio-binding",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 100_000,
                "duration": 1_500_000,
                "contentDigest": old_digest,
                "analysis": {
                    "version": 1,
                    "contentDigest": old_digest,
                    "bpm": 120.0,
                    "firstBeat": 200_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mut bound: Value = serde_json::from_str(
            bound
                .sequence_json
                .as_deref()
                .expect("audio binding succeeds"),
        )
        .expect("binding result is JSON");
        bound["cues"][0]["startTime"] = Value::from(100_000);
        bound["cues"][0]["duration"] = Value::from(400_000);
        bound["cues"][1]["startTime"] = Value::from(700_000);
        bound["cues"][1]["duration"] = Value::from(400_000);
        let initial_start = bound["cues"][0]["startTime"]
            .as_i64()
            .expect("cue start is valid");

        let phase_shifted = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: bound.to_string(),
            mutation_json: serde_json::json!({
                "kind": "sync-audio-timing",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 100_000,
                "duration": 1_500_000,
                "contentDigest": phase_digest,
                "analysis": {
                    "version": 2,
                    "contentDigest": phase_digest,
                    "bpm": 120.0,
                    "firstBeat": 260_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mut phase_shifted: Value = serde_json::from_str(
            phase_shifted
                .sequence_json
                .as_deref()
                .expect("phase synchronization succeeds"),
        )
        .expect("synchronization result is JSON");
        assert_eq!(
            phase_shifted["cues"][0]["startTime"],
            initial_start + 60_000
        );

        phase_shifted["audioBinding"]["beatOverride"] = serde_json::json!({ "firstBeat": 280_000 });
        let overridden_start = phase_shifted["cues"][0]["startTime"]
            .as_i64()
            .expect("cue start is valid");
        let override_preserved = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: phase_shifted.to_string(),
            mutation_json: serde_json::json!({
                "kind": "sync-audio-timing",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 100_000,
                "duration": 1_500_000,
                "contentDigest": override_digest,
                "analysis": {
                    "version": 3,
                    "contentDigest": override_digest,
                    "bpm": 120.0,
                    "firstBeat": 360_000
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let override_preserved: Value = serde_json::from_str(
            override_preserved
                .sequence_json
                .as_deref()
                .expect("override-preserving synchronization succeeds"),
        )
        .expect("synchronization result is JSON");
        assert_eq!(override_preserved["cues"][0]["startTime"], overridden_start);
        assert_eq!(
            override_preserved["audioBinding"]["beatOverride"]["firstBeat"],
            280_000
        );
    }

    #[test]
    fn rejects_audio_timing_sync_without_an_existing_binding() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let digest = format!("sha256:{}", "a".repeat(64));
        let synchronized = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created.sequence_json.expect("fixture creation succeeds"),
            mutation_json: serde_json::json!({
                "kind": "sync-audio-timing",
                "assetId": "asset:music",
                "clipId": "clip:music",
                "sourceOffset": 0,
                "duration": 1_500_000,
                "contentDigest": digest,
                "analysis": null
            })
            .to_string(),
            renderer_support: renderer_support(),
        });

        assert!(synchronized.sequence_json.is_none());
        assert_eq!(synchronized.diagnostics[0].code, "missing-audio-binding");
    }

    #[test]
    fn mutates_a_cue_without_losing_opaque_fields() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        document["cues"][0]["futureCueField"] = serde_json::json!({ "keep": true });
        let cue_id = document["cues"][0]["id"]
            .as_str()
            .expect("cue has an id")
            .to_owned();
        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": "改后的第一句",
                "startTime": 0,
                "duration": 600_000,
                "preset": {
                    "mode": "starter",
                    "starterPreset": "impact-title"
                },
                "font": { "mode": "inherit" },
                "colors": {
                    "mode": "set",
                    "foreground": "#f4f4f5",
                    "accent": "#ef4444"
                }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mutated: Value = serde_json::from_str(
            mutated
                .sequence_json
                .as_deref()
                .expect("cue mutation succeeds"),
        )
        .expect("mutation result is JSON");

        assert_eq!(mutated["revision"], 1);
        assert_eq!(mutated["cues"][0]["text"], "改后的第一句");
        let rendered_text: String = mutated["resolvedPlan"]["cuts"]
            .as_array()
            .expect("the plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == cue_id)
            .map(|cut| cut["text"].as_str().expect("each cut has text"))
            .collect();
        assert_eq!(rendered_text, "改后的第一句");
        assert_eq!(mutated["cues"][0]["duration"], 600_000);
        assert_eq!(
            mutated["cues"][0]["overrides"]["preset"]["style"],
            "crimson"
        );
        assert_eq!(
            mutated["cues"][0]["overrides"]["colors"]["accent"],
            "#ef4444"
        );
        assert_eq!(mutated["cues"][0]["futureCueField"]["keep"], true);
        assert_eq!(mutated["resolvedPlan"]["sequenceRevision"], 1);
        assert!(
            mutated["resolvedPlan"]["cuts"]
                .as_array()
                .is_some_and(|cuts| cuts
                    .iter()
                    .any(|cut| { cut["cueId"] == cue_id && cut["preset"]["style"] == "crimson" }))
        );
    }

    #[test]
    fn cue_mutation_fails_closed_for_overlap_and_locks() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let cue_id = document["cues"][0]["id"]
            .as_str()
            .expect("cue has an id")
            .to_owned();
        let mutation = |duration| {
            serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": "第一句",
                "startTime": 0,
                "duration": duration,
                "preset": { "mode": "inherit" },
                "font": { "mode": "inherit" },
                "colors": { "mode": "inherit" }
            })
            .to_string()
        };
        let overlap = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: mutation(1_000_000),
            renderer_support: renderer_support(),
        });
        assert!(overlap.sequence_json.is_none());
        assert!(
            overlap
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "overlapping-cues")
        );

        document["cues"][0]["locks"] = serde_json::json!([{ "scope": "cue", "key": "all" }]);
        let locked = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: mutation(600_000),
            renderer_support: renderer_support(),
        });
        assert!(locked.sequence_json.is_none());
        assert!(
            locked
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "locked-cue")
        );
    }

    #[test]
    fn cue_lock_mutations_are_precise_deduplicated_and_replanned() {
        let created = create_motion_text_sequence(options("一/二\n第三句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let cue_id = document["cues"][0]["id"]
            .as_str()
            .expect("cue has an id")
            .to_owned();
        let cut_id = document["resolvedPlan"]["cuts"][0]["id"]
            .as_str()
            .expect("cut has an id")
            .to_owned();
        let set_lock = |sequence: &Value, scope: &str, key: &str, locked: bool| {
            mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
                sequence_json: sequence.to_string(),
                mutation_json: serde_json::json!({
                    "kind": "set-cue-lock",
                    "cueId": cue_id,
                    "scope": scope,
                    "key": key,
                    "locked": locked
                })
                .to_string(),
                renderer_support: renderer_support(),
            })
        };

        let group_locked = set_lock(&document, "preset-group", "layout", true);
        document = serde_json::from_str(
            group_locked
                .sequence_json
                .as_deref()
                .expect("preset group lock succeeds"),
        )
        .expect("lock result is JSON");
        assert_eq!(document["revision"], 1);
        assert_eq!(
            document["cues"][0]["locks"],
            serde_json::json!([{ "scope": "preset-group", "key": "layout" }])
        );
        assert_eq!(document["resolvedPlan"]["sequenceRevision"], 1);

        let duplicate = set_lock(&document, "preset-group", "layout", true);
        assert!(duplicate.sequence_json.is_none());
        assert_eq!(duplicate.diagnostics[0].code, "no-changes");

        let parameter_locked = set_lock(&document, "parameter", STARTER_PRESET_PARAMETER, true);
        document = serde_json::from_str(
            parameter_locked
                .sequence_json
                .as_deref()
                .expect("parameter lock succeeds"),
        )
        .expect("lock result is JSON");
        let cut_locked = set_lock(&document, "cut", &cut_id, true);
        document = serde_json::from_str(
            cut_locked
                .sequence_json
                .as_deref()
                .expect("cut lock succeeds"),
        )
        .expect("lock result is JSON");
        assert_eq!(
            document["cues"][0]["locks"],
            serde_json::json!([
                { "scope": "preset-group", "key": "layout" },
                { "scope": "cut", "key": cut_id },
                { "scope": "parameter", "key": STARTER_PRESET_PARAMETER }
            ])
        );

        let cue = document["cues"][0].clone();
        let unrelated_edit = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": cue["text"],
                "startTime": cue["startTime"],
                "duration": cue["duration"],
                "preset": { "mode": "keep" },
                "font": { "mode": "set", "fontId": "mincho_bold" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        assert!(unrelated_edit.sequence_json.is_some());

        let text_edit = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": "甲/乙",
                "startTime": cue["startTime"],
                "duration": cue["duration"],
                "preset": { "mode": "keep" },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        assert!(text_edit.sequence_json.is_none());
        assert_eq!(text_edit.diagnostics[0].code, "locked-cue-cuts");

        let preset_edit = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": cue["text"],
                "startTime": cue["startTime"],
                "duration": cue["duration"],
                "preset": {
                    "mode": "starter",
                    "starterPreset": "impact-title"
                },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        assert!(preset_edit.sequence_json.is_none());
        assert_eq!(preset_edit.diagnostics[0].code, "locked-cue-preset");

        let unlocked = set_lock(&document, "cut", &cut_id, false);
        document = serde_json::from_str(
            unlocked
                .sequence_json
                .as_deref()
                .expect("exact cut unlock succeeds"),
        )
        .expect("unlock result is JSON");
        assert!(
            !document["cues"][0]["locks"]
                .as_array()
                .expect("locks stay an array")
                .iter()
                .any(|lock| lock["scope"] == "cut" && lock["key"] == cut_id)
        );
    }

    #[test]
    fn cue_lock_mutation_rejects_missing_cut_and_parameter_targets() {
        let created = create_motion_text_sequence(options("第一句"));
        let document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let cue_id = document["cues"][0]["id"].as_str().expect("cue has an id");
        let mutate = |scope: &str, key: &str| {
            mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
                sequence_json: document.to_string(),
                mutation_json: serde_json::json!({
                    "kind": "set-cue-lock",
                    "cueId": cue_id,
                    "scope": scope,
                    "key": key,
                    "locked": true
                })
                .to_string(),
                renderer_support: renderer_support(),
            })
        };

        assert_eq!(
            mutate("cut", "cut:missing").diagnostics[0].code,
            "missing-lock-cut"
        );
        assert_eq!(
            mutate("parameter", "missing").diagnostics[0].code,
            "missing-lock-parameter"
        );
        assert_eq!(
            mutate("preset-group", "unknown").diagnostics[0].code,
            "invalid-cue-lock"
        );
    }

    #[test]
    fn restoring_preset_inheritance_keeps_locked_cut_snapshots() {
        let created = create_motion_text_sequence(options("一/二"));
        let created_document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let cue = &created_document["cues"][0];
        let cue_id = cue["id"].as_str().expect("cue has an id").to_owned();
        let styled = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: created_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": cue["text"],
                "startTime": cue["startTime"],
                "duration": cue["duration"],
                "preset": {
                    "mode": "starter",
                    "starterPreset": "impact-title"
                },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mut styled_document: Value = serde_json::from_str(
            styled
                .sequence_json
                .as_deref()
                .expect("local style succeeds"),
        )
        .expect("style result is JSON");
        let first_cut_id = styled_document["resolvedPlan"]["cuts"][0]["id"]
            .as_str()
            .expect("first cut has an id")
            .to_owned();
        let locked = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: styled_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "set-cue-lock",
                "cueId": cue_id,
                "scope": "cut",
                "key": first_cut_id,
                "locked": true
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        styled_document =
            serde_json::from_str(locked.sequence_json.as_deref().expect("cut lock succeeds"))
                .expect("lock result is JSON");
        let locked_cue = &styled_document["cues"][0];
        let inherited = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: styled_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": cue_id,
                "text": locked_cue["text"],
                "startTime": locked_cue["startTime"],
                "duration": locked_cue["duration"],
                "preset": { "mode": "inherit" },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let inherited: Value = serde_json::from_str(
            inherited
                .sequence_json
                .as_deref()
                .expect("inheritance restore succeeds"),
        )
        .expect("inheritance result is JSON");
        let cuts = inherited["resolvedPlan"]["cuts"]
            .as_array()
            .expect("inheritance result has cuts");
        let first_cut = cuts
            .iter()
            .find(|cut| cut["id"] == first_cut_id)
            .expect("locked cut remains present");
        let second_cut = cuts
            .iter()
            .find(|cut| cut["id"] != first_cut_id)
            .expect("unlocked cut remains present");
        assert_eq!(first_cut["preset"]["style"], "crimson");
        assert_eq!(second_cut["preset"]["style"], "base");
        assert!(inherited["cues"][0]["overrides"].get("preset").is_none());
    }

    #[test]
    fn creates_a_scoped_variation_candidate_without_mutating_the_base_document() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        document["futureExtension"] = serde_json::json!({ "keep": true });
        let first_cue_id = document["cues"][0]["id"]
            .as_str()
            .expect("first cue has an id")
            .to_owned();
        let second_cue_id = document["cues"][1]["id"]
            .as_str()
            .expect("second cue has an id")
            .to_owned();
        let base_first_cuts: Vec<_> = document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("base plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == first_cue_id)
            .cloned()
            .collect();
        let base_second_cuts: Vec<_> = document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("base plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == second_cue_id)
            .cloned()
            .collect();

        let candidate =
            create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                sequence_json: document.to_string(),
                salt: 17,
                cue_ids: vec![first_cue_id.clone()],
                groups: vec![MotionTextPresetGroup::Style, MotionTextPresetGroup::Layout],
                renderer_support: renderer_support(),
            });

        assert_eq!(candidate.base_revision, Some(0));
        assert_eq!(candidate.candidate_revision, Some(1));
        assert_eq!(candidate.salt, 17);
        let candidate_document: Value = serde_json::from_str(
            candidate
                .sequence_json
                .as_deref()
                .expect("variation candidate succeeds"),
        )
        .expect("candidate is JSON");
        assert_eq!(candidate_document["revision"], 1);
        assert_eq!(candidate_document["resolvedPlan"]["sequenceRevision"], 1);
        assert_eq!(candidate_document["futureExtension"]["keep"], true);
        let candidate_first_cuts: Vec<_> = candidate_document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("candidate plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == first_cue_id)
            .cloned()
            .collect();
        let candidate_second_cuts: Vec<_> = candidate_document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("candidate plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == second_cue_id)
            .cloned()
            .collect();
        assert_ne!(candidate_first_cuts, base_first_cuts);
        assert_eq!(candidate_second_cuts, base_second_cuts);
        assert_eq!(document["revision"], 0);
    }

    #[test]
    fn variation_candidate_fails_closed_for_missing_targets_and_full_locks() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let first_cue_id = document["cues"][0]["id"]
            .as_str()
            .expect("first cue has an id")
            .to_owned();
        let missing =
            create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                sequence_json: document.to_string(),
                salt: 1,
                cue_ids: vec!["cue:missing".to_owned()],
                groups: vec![MotionTextPresetGroup::Layout],
                renderer_support: renderer_support(),
            });
        assert!(missing.sequence_json.is_none());
        assert!(
            missing
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "missing-variation-cue")
        );

        document["cues"][0]["locks"] = serde_json::json!([{ "scope": "cue", "key": "all" }]);
        let locked =
            create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                sequence_json: document.to_string(),
                salt: 1,
                cue_ids: vec![first_cue_id],
                groups: vec![MotionTextPresetGroup::Layout],
                renderer_support: renderer_support(),
            });
        assert!(locked.sequence_json.is_none());
        assert_eq!(locked.base_revision, Some(0));
        assert!(
            locked
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "no-variation")
        );
    }

    #[test]
    fn fully_locked_variation_groups_preserve_cuts_and_reject_noop_candidates() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let mut document: Value =
            serde_json::from_str(created.sequence_json.as_deref().unwrap()).unwrap();
        let cue_id = document["cues"][0]["id"].as_str().unwrap().to_owned();
        let original_cuts = document["resolvedPlan"]["cuts"].as_array().unwrap().clone();
        for locks in [
            serde_json::json!([
                {"scope": "preset-group", "key": "layout"},
                {"scope": "preset-group", "key": "enter"}
            ]),
            serde_json::json!([{"scope": "cue", "key": "preset"}]),
        ] {
            document["cues"][0]["locks"] = locks;
            let selected =
                create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                    sequence_json: document.to_string(),
                    salt: 42,
                    cue_ids: vec![cue_id.clone()],
                    groups: vec![MotionTextPresetGroup::Layout, MotionTextPresetGroup::Enter],
                    renderer_support: renderer_support(),
                });
            assert!(
                selected.sequence_json.is_none(),
                "locked groups must not become a seed-only variation"
            );
            assert!(
                selected
                    .diagnostics
                    .iter()
                    .any(|d| d.code == "no-variation")
            );
            let all =
                create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                    sequence_json: document.to_string(),
                    salt: 42,
                    cue_ids: vec![],
                    groups: vec![MotionTextPresetGroup::Layout, MotionTextPresetGroup::Enter],
                    renderer_support: renderer_support(),
                });
            let varied: Value = serde_json::from_str(
                all.sequence_json
                    .as_deref()
                    .expect("unlocked second cue can vary"),
            )
            .unwrap();
            let next_cuts = varied["resolvedPlan"]["cuts"].as_array().unwrap();
            assert_eq!(
                next_cuts
                    .iter()
                    .filter(|c| c["cueId"] == cue_id)
                    .collect::<Vec<_>>(),
                original_cuts
                    .iter()
                    .filter(|c| c["cueId"] == cue_id)
                    .collect::<Vec<_>>(),
                "locked cue must preserve every field including seeds"
            );
            assert_ne!(
                next_cuts
                    .iter()
                    .filter(|c| c["cueId"] != cue_id)
                    .collect::<Vec<_>>(),
                original_cuts
                    .iter()
                    .filter(|c| c["cueId"] != cue_id)
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn later_cue_edits_preserve_applied_variations_on_untouched_cues() {
        let created = create_motion_text_sequence(options("第一句\n第二句"));
        let base_document: Value = serde_json::from_str(
            created
                .sequence_json
                .as_deref()
                .expect("fixture creation succeeds"),
        )
        .expect("fixture is JSON");
        let first_cue_id = base_document["cues"][0]["id"]
            .as_str()
            .expect("first cue has an id")
            .to_owned();
        let second_cue_id = base_document["cues"][1]["id"]
            .as_str()
            .expect("second cue has an id")
            .to_owned();
        let varied =
            create_motion_text_variation_candidate(CreateMotionTextVariationCandidateOptions {
                sequence_json: base_document.to_string(),
                salt: 29,
                cue_ids: Vec::new(),
                groups: vec![MotionTextPresetGroup::Style, MotionTextPresetGroup::Layout],
                renderer_support: renderer_support(),
            });
        let varied_document: Value = serde_json::from_str(
            varied
                .sequence_json
                .as_deref()
                .expect("variation candidate succeeds"),
        )
        .expect("candidate is JSON");
        let varied_first_cuts: Vec<_> = varied_document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("candidate plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == first_cue_id)
            .cloned()
            .collect();
        let second_cue = &varied_document["cues"][1];
        let mutated = mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: varied_document.to_string(),
            mutation_json: serde_json::json!({
                "kind": "update-cue",
                "cueId": second_cue_id,
                "text": "改后的第二句",
                "startTime": second_cue["startTime"],
                "duration": second_cue["duration"],
                "preset": { "mode": "keep" },
                "font": { "mode": "keep" },
                "colors": { "mode": "keep" }
            })
            .to_string(),
            renderer_support: renderer_support(),
        });
        let mutated_document: Value = serde_json::from_str(
            mutated
                .sequence_json
                .as_deref()
                .expect("cue mutation succeeds"),
        )
        .expect("mutation result is JSON");
        let mutated_first_cuts: Vec<_> = mutated_document["resolvedPlan"]["cuts"]
            .as_array()
            .expect("mutated plan has cuts")
            .iter()
            .filter(|cut| cut["cueId"] == first_cue_id)
            .cloned()
            .collect();

        assert_eq!(mutated_document["revision"], 2);
        assert_eq!(mutated_first_cuts, varied_first_cuts);
    }
}
