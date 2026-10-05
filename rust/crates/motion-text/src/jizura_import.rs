use std::collections::{BTreeMap, BTreeSet};

use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::factory::{
    JIZURA_CATALOG_HASH, JIZURA_ENGINE_VERSION, MotionTextSequenceBuildDiagnostic,
    MotionTextSequenceBuildDiagnosticSeverity, MotionTextSourceFormat, MotionTextStarterPreset,
    builtin_font_supports_language, builtin_fonts_json, resolve_builtin_font_id,
    stable_sequence_seed, starter_preset,
};
use crate::identity::valid_id;
use crate::planner::{
    MOTION_TEXT_PLAN_VERSION, MOTION_TEXT_TOKENIZER_VERSION, MotionTextCenterDirection,
    MotionTextCueInput, MotionTextDefaultsInput, MotionTextEngineInput, MotionTextLockInput,
    MotionTextOverridesInput, MotionTextParameterValue, MotionTextPlan,
    MotionTextPlanDiagnosticSeverity, MotionTextPlanOptions, MotionTextPlanningControls,
    MotionTextPresetGroup, MotionTextPresetOverride, MotionTextPresetSetControls,
    MotionTextRendererPresetSupport, MotionTextSequenceInput, plan_motion_text_sequence,
};
use crate::source::{
    MOTION_TEXT_SCHEMA_VERSION, MotionTextDiagnosticSeverity, MotionTextSourceCue,
    ParseMotionTextSourceOptions, parse_motion_text_source, split_to_count,
};

const TICKS_PER_SECOND: f64 = 120_000.0;
const MAX_PROJECT_BYTES: usize = 4_000_000;
const MAX_SOURCE_CHARACTERS: usize = 1_000_000;
const MAX_CUES: usize = 10_000;
const MAX_CUE_CHARACTERS: usize = 20_000;
const MAX_REPORT_ITEMS: usize = 256;
const MAX_IMPORT_PARAMETER_DEPTH: usize = 6;
const MAX_IMPORT_PARAMETER_NODES: usize = 2_000;
const MAX_IMPORT_PARAMETER_STRING_CHARACTERS: usize = 4_096;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportJizuraMotionTextProjectOptions {
    pub sequence_id: String,
    pub project_json: String,
    pub renderer_support: Vec<MotionTextRendererPresetSupport>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum JizuraImportStatus {
    Imported,
    ImportedWithWarnings,
    Rejected,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum JizuraCompatibilityStatus {
    Preserved,
    Approximated,
    Unsupported,
    Ignored,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JizuraCompatibilityItem {
    pub path: String,
    pub status: JizuraCompatibilityStatus,
    pub code: String,
    pub message: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JizuraCompatibilityReport {
    pub status: JizuraImportStatus,
    pub source_version: Option<u32>,
    pub source_app_version: Option<String>,
    pub items: Vec<JizuraCompatibilityItem>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum JizuraImportResourceKind {
    Audio,
    Font,
    LanguageFontPack,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum JizuraImportResourceStatus {
    Available,
    Missing,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JizuraImportResource {
    pub kind: JizuraImportResourceKind,
    pub id: String,
    pub path: String,
    pub status: JizuraImportResourceStatus,
    pub required_for_fidelity: bool,
    pub message: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportJizuraMotionTextProjectResult {
    pub sequence_json: Option<String>,
    pub resources_needed: Vec<JizuraImportResource>,
    pub compatibility_report: JizuraCompatibilityReport,
    pub diagnostics: Vec<MotionTextSequenceBuildDiagnostic>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ImportedTimingSource {
    Lrc,
    Estimated,
    Manual,
}

impl ImportedTimingSource {
    fn key(self) -> &'static str {
        match self {
            Self::Lrc => "lrc",
            Self::Estimated => "estimated",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Debug)]
struct ImportedCueTiming {
    start_time: i64,
    duration: i64,
    source: ImportedTimingSource,
}

#[derive(Clone, Debug)]
struct ImportedCue {
    source: MotionTextSourceCue,
    timing: ImportedCueTiming,
    segments: Vec<String>,
    locks: Vec<MotionTextLockInput>,
    preset_override: Option<MotionTextPresetOverride>,
    parameters: BTreeMap<String, MotionTextParameterValue>,
}

struct ImportState {
    items: Vec<JizuraCompatibilityItem>,
    resources: Vec<JizuraImportResource>,
    diagnostics: Vec<MotionTextSequenceBuildDiagnostic>,
    source_version: Option<u32>,
    source_app_version: Option<String>,
}

impl ImportState {
    fn new() -> Self {
        Self {
            items: Vec::new(),
            resources: vec![JizuraImportResource {
                kind: JizuraImportResourceKind::Audio,
                id: "jizura-audio".to_owned(),
                path: "$.audio".to_owned(),
                status: JizuraImportResourceStatus::Missing,
                required_for_fidelity: false,
                message: "JIZURA project JSON does not contain audio bytes; relink the song to a rocut audio asset."
                    .to_owned(),
            }],
            diagnostics: Vec::new(),
            source_version: None,
            source_app_version: None,
        }
    }

    fn item(
        &mut self,
        path: impl Into<String>,
        status: JizuraCompatibilityStatus,
        code: impl Into<String>,
        message: impl Into<String>,
    ) {
        if self.items.len() >= MAX_REPORT_ITEMS {
            return;
        }
        self.items.push(JizuraCompatibilityItem {
            path: path.into(),
            status,
            code: code.into(),
            message: message.into(),
        });
    }

    fn error(&mut self, code: &str, message: impl Into<String>, source_line: Option<u32>) {
        self.diagnostics.push(MotionTextSequenceBuildDiagnostic {
            severity: MotionTextSequenceBuildDiagnosticSeverity::Error,
            code: code.to_owned(),
            message: message.into(),
            source_line,
            cue_id: None,
        });
    }

    fn warning(&mut self, code: &str, message: impl Into<String>, source_line: Option<u32>) {
        self.diagnostics.push(MotionTextSequenceBuildDiagnostic {
            severity: MotionTextSequenceBuildDiagnosticSeverity::Warning,
            code: code.to_owned(),
            message: message.into(),
            source_line,
            cue_id: None,
        });
    }

    fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|diagnostic| {
            diagnostic.severity == MotionTextSequenceBuildDiagnosticSeverity::Error
        })
    }

    fn finish(self, sequence_json: Option<String>) -> ImportJizuraMotionTextProjectResult {
        let status = if sequence_json.is_none() {
            JizuraImportStatus::Rejected
        } else if self.diagnostics.iter().any(|diagnostic| {
            diagnostic.severity == MotionTextSequenceBuildDiagnosticSeverity::Warning
        }) || self.items.iter().any(|item| {
            matches!(
                item.status,
                JizuraCompatibilityStatus::Approximated | JizuraCompatibilityStatus::Unsupported
            )
        }) || self
            .resources
            .iter()
            .any(|resource| resource.status == JizuraImportResourceStatus::Missing)
        {
            JizuraImportStatus::ImportedWithWarnings
        } else {
            JizuraImportStatus::Imported
        };
        ImportJizuraMotionTextProjectResult {
            sequence_json,
            resources_needed: self.resources,
            compatibility_report: JizuraCompatibilityReport {
                status,
                source_version: self.source_version,
                source_app_version: self.source_app_version,
                items: self.items,
            },
            diagnostics: self.diagnostics,
        }
    }
}

#[export]
pub fn import_jizura_motion_text_project(
    options: ImportJizuraMotionTextProjectOptions,
) -> ImportJizuraMotionTextProjectResult {
    let mut state = ImportState::new();
    if !valid_id(&options.sequence_id) {
        state.error(
            "invalid-sequence-id",
            "The imported motion-text sequence id is invalid.",
            None,
        );
    }
    if options.project_json.len() > MAX_PROJECT_BYTES
        || options.project_json.chars().count() > MAX_SOURCE_CHARACTERS
    {
        state.error(
            "jizura-project-limit",
            "The JIZURA project exceeds the supported import size.",
            None,
        );
        return state.finish(None);
    }
    let project_value = match serde_json::from_str::<Value>(&options.project_json) {
        Ok(value) => value,
        Err(error) => {
            state.error(
                "invalid-jizura-json",
                format!("The JIZURA project is not valid JSON: {error}"),
                None,
            );
            return state.finish(None);
        }
    };
    let Some(project) = project_value.as_object() else {
        state.error(
            "invalid-jizura-project",
            "A JIZURA project must be a JSON object.",
            None,
        );
        return state.finish(None);
    };

    validate_version(project, &mut state);
    state.source_app_version = project
        .get("appVersion")
        .and_then(Value::as_str)
        .map(|value| value.chars().take(80).collect());
    report_unknown_top_level_fields(project, &mut state);
    if state.has_errors() {
        return state.finish(None);
    }

    let Some(lyrics) = project.get("lyrics").and_then(Value::as_str) else {
        state.error(
            "missing-jizura-lyrics",
            "The JIZURA project does not contain a string lyrics field.",
            None,
        );
        return state.finish(None);
    };
    if lyrics.chars().count() > MAX_SOURCE_CHARACTERS {
        state.error(
            "source-limit",
            "The JIZURA lyrics exceed the supported character limit.",
            None,
        );
        return state.finish(None);
    }

    let parsed = parse_motion_text_source(ParseMotionTextSourceOptions {
        sequence_id: options.sequence_id.clone(),
        source: lyrics.to_owned(),
    });
    for diagnostic in parsed.diagnostics {
        if diagnostic.code == "mixed-lrc-timing" {
            state.item(
                "$.lyrics",
                JizuraCompatibilityStatus::Preserved,
                "jizura-partial-lrc-fallback",
                "Partial LRC timestamps follow JIZURA semantics: manual times win and otherwise the whole project uses estimated timing.",
            );
            continue;
        }
        state.diagnostics.push(MotionTextSequenceBuildDiagnostic {
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
        });
    }
    let mut source_cues = parsed.cues;
    source_cues.sort_by_key(|cue| (cue.source_line, cue.start_ticks.unwrap_or(i64::MAX)));
    if source_cues.is_empty() {
        state.error(
            "empty-source",
            "The JIZURA project does not contain a renderable lyric line.",
            None,
        );
    }
    if source_cues.len() > MAX_CUES {
        state.error(
            "cue-limit",
            "The JIZURA project exceeds the supported cue limit.",
            None,
        );
    }
    for cue in &source_cues {
        if cue.text.chars().count() > MAX_CUE_CHARACTERS {
            state.error(
                "cue-character-limit",
                "A JIZURA lyric line exceeds the supported character limit.",
                Some(cue.source_line),
            );
        }
    }
    if state.has_errors() {
        return state.finish(None);
    }

    let language = resolve_language(project, lyrics);
    let (timings, project_duration) = match compute_timings(project, &source_cues, &mut state) {
        Some(value) => value,
        None => return state.finish(None),
    };
    let duration = timings
        .iter()
        .map(|timing| timing.start_time.saturating_add(timing.duration))
        .max()
        .unwrap_or(0)
        .max(project_duration);
    if duration <= 0 {
        state.error(
            "invalid-duration",
            "The imported JIZURA project has no positive sequence duration.",
            None,
        );
        return state.finish(None);
    }

    let seed = parse_seed(project, &options.sequence_id, &mut state);
    let renderer_support: BTreeSet<(MotionTextPresetGroup, String)> = options
        .renderer_support
        .iter()
        .map(|entry| (entry.group, entry.id.clone()))
        .collect();
    let mut default_preset = starter_preset(MotionTextStarterPreset::CleanCaption);
    default_preset.style = project
        .get("style")
        .and_then(Value::as_str)
        .unwrap_or("noir")
        .to_owned();
    validate_preset_id(
        MotionTextPresetGroup::Style,
        &default_preset.style,
        "$.style",
        &renderer_support,
        &mut state,
    );
    validate_complete_default_preset(&default_preset, &renderer_support, &mut state);

    let builtin_fonts = builtin_fonts_json();
    let builtin_font_ids: BTreeSet<String> = builtin_fonts
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|font| font.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let default_font_role_or_asset_id =
        import_fonts(project, &builtin_font_ids, &language, &mut state);
    let default_font_id =
        resolve_builtin_font_id(&default_font_role_or_asset_id, language.as_str());
    report_language_resources(&language, &default_font_id, &mut state);
    let colors = import_colors(project, &mut state);
    let planning_controls = import_planning_controls(project, &mut state);
    report_global_compatibility(project, &mut state);

    let overrides = project.get("overrides").and_then(Value::as_object);
    let mut imported_cues = Vec::with_capacity(source_cues.len());
    for (index, (source, timing)) in source_cues.into_iter().zip(timings).enumerate() {
        let line_override = overrides.and_then(|value| value.get(&index.to_string()));
        imported_cues.push(import_cue(
            index,
            source,
            timing,
            line_override,
            &renderer_support,
            &mut state,
        ));
    }
    if state.has_errors() {
        return state.finish(None);
    }

    let import_metadata = import_metadata(project, &parsed.metadata);
    let mut default_parameters = BTreeMap::from([(
        "jizura.import".to_owned(),
        MotionTextParameterValue::Object(import_metadata),
    )]);
    if let Some(font_roles) = import_font_roles_parameter(project) {
        default_parameters.insert("jizura.fontRoles".to_owned(), font_roles);
    }

    let cue_inputs: Vec<MotionTextCueInput> = imported_cues
        .iter()
        .map(|cue| MotionTextCueInput {
            id: cue.source.id.clone(),
            text: cue.source.text.clone(),
            start_time: cue.timing.start_time,
            duration: cue.timing.duration,
            interlude: cue.source.interlude,
            gap_before: cue.source.gap_before,
            impact: cue.source.impact,
            segments: cue.segments.clone(),
            cut_durations: Vec::new(),
            locks: cue.locks.clone(),
            overrides: MotionTextOverridesInput {
                preset: cue.preset_override.clone(),
                font_id: None,
                parameters: cue.parameters.clone(),
            },
        })
        .collect();
    let plan_result = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: MotionTextSequenceInput {
            id: options.sequence_id.clone(),
            revision: 0,
            duration,
            seed,
            language: language.clone(),
            planning_controls,
            engine: MotionTextEngineInput {
                tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
            },
            defaults: MotionTextDefaultsInput {
                preset: default_preset.clone(),
                font_id: Some(default_font_id.clone()),
                parameters: default_parameters.clone(),
            },
            cues: cue_inputs,
            resolved_plan: None,
        },
        catalog: Default::default(),
        renderer_support: Some(options.renderer_support),
        randomize_groups: Vec::new(),
        variation: None,
    });
    for diagnostic in plan_result.diagnostics {
        state.diagnostics.push(MotionTextSequenceBuildDiagnostic {
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
        });
    }
    let Some(mut plan) = plan_result.plan else {
        return state.finish(None);
    };

    apply_per_cut_imports(
        &mut plan,
        &mut imported_cues,
        overrides,
        &renderer_support,
        &mut state,
    );
    if state.has_errors() {
        return state.finish(None);
    }

    state.item(
        "$.lyrics",
        JizuraCompatibilityStatus::Preserved,
        "lyrics-preserved",
        "Lyrics, JIZURA syntax, stable cue identity, and computed cue timing were imported.",
    );
    state.item(
        "$",
        JizuraCompatibilityStatus::Approximated,
        "native-planner-recomputed",
        "Unlocked automatic JIZURA choices are replanned deterministically by rocut; bit-exact reconstruction of the original JavaScript planner is not claimed.",
    );

    let cue_documents: Vec<Value> = imported_cues.iter().map(imported_cue_document).collect();
    let document = json!({
        "id": options.sequence_id,
        "schemaVersion": MOTION_TEXT_SCHEMA_VERSION,
        "revision": 0,
        "source": {
            "format": MotionTextSourceFormat::Jizura,
            "text": options.project_json,
        },
        "language": language,
        "planningControls": planning_controls,
        "duration": duration,
        "compositionMode": "overlay",
        "seed": seed,
        "engine": {
            "id": "jizura",
            "version": JIZURA_ENGINE_VERSION,
            "catalogHash": JIZURA_CATALOG_HASH,
            "plannerVersion": MOTION_TEXT_PLAN_VERSION,
            "tokenizerVersion": MOTION_TEXT_TOKENIZER_VERSION,
        },
        "fonts": builtin_fonts,
        "defaults": {
            "preset": default_preset,
            "fontId": default_font_id,
            "colors": colors,
            "parameters": default_parameters,
        },
        "cues": cue_documents,
        "resolvedPlan": plan,
    });
    match serde_json::to_string(&document) {
        Ok(sequence_json) => state.finish(Some(sequence_json)),
        Err(error) => {
            state.error(
                "serialization-failed",
                format!("The imported motion-text sequence could not be serialized: {error}"),
                None,
            );
            state.finish(None)
        }
    }
}

fn import_planning_controls(
    project: &Map<String, Value>,
    state: &mut ImportState,
) -> MotionTextPlanningControls {
    let boolean = |field: &str, fallback: bool| {
        project
            .get(field)
            .and_then(Value::as_bool)
            .unwrap_or(fallback)
    };
    let center_direction = match project.get("centerDir").and_then(Value::as_str) {
        Some("lr") => MotionTextCenterDirection::LeftRight,
        _ => MotionTextCenterDirection::TopBottom,
    };
    for field in [
        "horror",
        "typo",
        "kinetic",
        "unify",
        "centerFree",
        "centerDir",
    ] {
        if project.contains_key(field) {
            state.item(
                format!("$.{field}"),
                JizuraCompatibilityStatus::Preserved,
                "planning-control-preserved",
                "The JIZURA planning control is preserved as native deterministic planner input.",
            );
        }
    }
    MotionTextPlanningControls {
        preset_sets: MotionTextPresetSetControls {
            horror: boolean("horror", false),
            typo: boolean("typo", true),
            kinetic: boolean("kinetic", true),
        },
        unify: boolean("unify", false),
        center_free: boolean("centerFree", false),
        center_direction,
    }
}

fn validate_version(project: &Map<String, Value>, state: &mut ImportState) {
    let Some(version) = project.get("version").and_then(Value::as_u64) else {
        state.error(
            "missing-jizura-version",
            "The JIZURA project version must be the integer 1.",
            None,
        );
        return;
    };
    state.source_version = u32::try_from(version).ok();
    if version != 1 {
        state.item(
            "$.version",
            JizuraCompatibilityStatus::Unsupported,
            "unsupported-jizura-version",
            format!("JIZURA project version {version} is not supported by this importer."),
        );
        state.error(
            "unsupported-jizura-version",
            format!("JIZURA project version {version} is not supported."),
            None,
        );
    } else {
        state.item(
            "$.version",
            JizuraCompatibilityStatus::Preserved,
            "jizura-version-supported",
            "JIZURA project schema version 1 is supported.",
        );
    }
}

fn report_unknown_top_level_fields(project: &Map<String, Value>, state: &mut ImportState) {
    const KNOWN_FIELDS: &[&str] = &[
        "version",
        "title",
        "artist",
        "lyrics",
        "style",
        "mood",
        "extra",
        "wa",
        "horror",
        "typo",
        "kinetic",
        "lang",
        "keyBg",
        "unify",
        "typeset",
        "centerDir",
        "centerFree",
        "seed",
        "aspect",
        "res",
        "fps",
        "fx",
        "enabled",
        "timing",
        "overrides",
        "locks",
        "colors",
        "fonts",
        "userFonts",
        "appVersion",
        "exportRange",
    ];
    let known: BTreeSet<&str> = KNOWN_FIELDS.iter().copied().collect();
    for field in project
        .keys()
        .filter(|field| !known.contains(field.as_str()))
    {
        state.item(
            format!("$.{field}"),
            JizuraCompatibilityStatus::Ignored,
            "unknown-field-preserved-as-source",
            "The unknown field is retained only inside the inert original source JSON and is never executed or resolved as a path or URL.",
        );
    }
}

fn resolve_language(project: &Map<String, Value>, lyrics: &str) -> String {
    match project.get("lang").and_then(Value::as_str) {
        Some("ja" | "zh-Hant" | "zh-Hans" | "ko" | "en") => project
            .get("lang")
            .and_then(Value::as_str)
            .unwrap_or("ja")
            .to_owned(),
        _ => detect_language(&format!(
            "{} {}",
            lyrics,
            project.get("title").and_then(Value::as_str).unwrap_or("")
        )),
    }
}

fn detect_language(text: &str) -> String {
    const TRADITIONAL: &str = "們個說這會對時來還後過國開關與為從問間見長東車門愛聽學讓話號發點無現體經電實樣聲變離氣夢給覺當歡陽戀邊頭淚誰歲遠嗎萬難寫應讀憶樂麼麗傷將總結終紅綠線顏風飛鳥謝語請認識熱燈願獨夠紀帶滿靜輕別腦臉懷謊錯顆陣場讚淺溫記憑護壞歸媽隨銀聞態虛遙";
    const SIMPLIFIED: &str = "们个说这会对时来还后过国开关与为从问间见长东车门爱听学让话号发点无现体经电实样声变离气梦给觉当欢阳恋边头泪谁岁远吗万难写应读忆乐么丽伤将总结终红绿线颜风飞鸟谢语请认识热灯愿独够纪带满静轻别脑脸怀谎错颗阵场赞浅温记凭护坏归妈随银闻态虚遥";
    let traditional: BTreeSet<char> = TRADITIONAL.chars().collect();
    let simplified: BTreeSet<char> = SIMPLIFIED.chars().collect();
    let (mut kana, mut hangul, mut han, mut tc, mut sc, mut latin) = (0, 0, 0, 0, 0, 0);
    for character in text.chars() {
        let code = u32::from(character);
        if character.is_ascii_alphabetic()
            || ((0x00c0..=0x024f).contains(&code) && code != 0x00d7 && code != 0x00f7)
            || ((0xff21..=0xff5a).contains(&code) && (code <= 0xff3a || code >= 0xff41))
        {
            latin += 1;
        } else if ((0x3041..=0x30ff).contains(&code) && code != 0x30fb && code != 0x30fc)
            || (0xff66..=0xff9d).contains(&code)
        {
            kana += 1;
        } else if (0xac00..=0xd7a3).contains(&code)
            || (0x1100..=0x11ff).contains(&code)
            || (0x3130..=0x318f).contains(&code)
        {
            hangul += 1;
        } else if (0x4e00..=0x9fff).contains(&code)
            || (0x3400..=0x4dbf).contains(&code)
            || (0x20000..=0x2ffff).contains(&code)
        {
            han += 1;
            tc += usize::from(traditional.contains(&character));
            sc += usize::from(simplified.contains(&character));
        }
    }
    let cjk = kana + hangul + han;
    if latin >= 6 && (latin as f64) >= ((latin + cjk * 3) as f64) * 0.9 {
        "en".to_owned()
    } else if hangul >= 2 && hangul > kana {
        "ko".to_owned()
    } else if kana >= 2 || (kana > 0 && (kana as f64) >= (han as f64) * 0.03) {
        "ja".to_owned()
    } else if han >= 2 {
        if sc > tc { "zh-Hans" } else { "zh-Hant" }.to_owned()
    } else {
        "ja".to_owned()
    }
}

fn report_language_resources(language: &str, font_id: &str, state: &mut ImportState) {
    if matches!(language, "zh-Hans" | "zh-Hant" | "ko")
        && !builtin_font_supports_language(font_id, language)
    {
        state.resources.push(JizuraImportResource {
            kind: JizuraImportResourceKind::LanguageFontPack,
            id: language.to_owned(),
            path: "$.lang".to_owned(),
            status: JizuraImportResourceStatus::Missing,
            required_for_fidelity: true,
            message: format!(
                "The offline rocut package does not yet contain JIZURA's {language} language-specific font substitutions."
            ),
        });
        state.item(
            "$.lang",
            JizuraCompatibilityStatus::Approximated,
            "offline-language-fonts-missing",
            format!(
                "Language {language} was preserved, but exact JIZURA font substitution requires an offline language font pack."
            ),
        );
    } else {
        state.item(
            "$.lang",
            JizuraCompatibilityStatus::Preserved,
            "language-preserved",
            format!("Resolved lyric language {language} was preserved."),
        );
    }
}

fn parse_seed(project: &Map<String, Value>, sequence_id: &str, state: &mut ImportState) -> u32 {
    match project.get("seed") {
        Some(Value::Number(number)) => number
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or_else(|| {
                state.warning(
                    "invalid-jizura-seed",
                    "The JIZURA seed is not an unsigned 32-bit integer; a stable sequence seed was used.",
                    None,
                );
                stable_sequence_seed(sequence_id)
            }),
        Some(_) => {
            state.warning(
                "invalid-jizura-seed",
                "The JIZURA seed is not an unsigned 32-bit integer; a stable sequence seed was used.",
                None,
            );
            stable_sequence_seed(sequence_id)
        }
        None => {
            state.item(
                "$.seed",
                JizuraCompatibilityStatus::Approximated,
                "missing-seed-derived",
                "The project had no seed, so rocut derived one from the stable sequence id.",
            );
            stable_sequence_seed(sequence_id)
        }
    }
}

fn compute_timings(
    project: &Map<String, Value>,
    cues: &[MotionTextSourceCue],
    state: &mut ImportState,
) -> Option<(Vec<ImportedCueTiming>, i64)> {
    let timing = project.get("timing").and_then(Value::as_object);
    let bpm = finite_number(timing.and_then(|value| value.get("bpm"))).unwrap_or(0.0);
    let beat = if bpm > 0.0 { 60.0 / bpm } else { 0.0 };
    let offset = finite_number(timing.and_then(|value| value.get("offset"))).unwrap_or(0.4);
    let tail = finite_number(timing.and_then(|value| value.get("tail"))).unwrap_or(0.9);
    let line_scale = finite_number(timing.and_then(|value| value.get("lineScale")))
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0);
    let line_times = timing
        .and_then(|value| value.get("lineTimes"))
        .and_then(Value::as_object);
    let all_lrc = !cues.is_empty() && cues.iter().all(|cue| cue.start_ticks.is_some());
    let mut starts = Vec::with_capacity(cues.len());
    let mut sources = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let manual = line_times
            .and_then(|values| values.get(&index.to_string()))
            .and_then(|value| finite_number(Some(value)));
        let (start, source) = if let Some(manual) = manual {
            (manual, ImportedTimingSource::Manual)
        } else if all_lrc {
            (
                cue.start_ticks.unwrap_or_default() as f64 / TICKS_PER_SECOND,
                ImportedTimingSource::Lrc,
            )
        } else if index == 0 {
            (offset, ImportedTimingSource::Estimated)
        } else {
            let previous = &cues[index - 1];
            let duration = estimated_line_duration(previous, beat, line_scale, false);
            (
                starts[index - 1]
                    + duration
                    + if cue.gap_before {
                        if beat > 0.0 { beat * 2.0 } else { 0.8 }
                    } else {
                        0.0
                    },
                ImportedTimingSource::Estimated,
            )
        };
        if !start.is_finite() || start < 0.0 {
            state.error(
                "invalid-jizura-line-time",
                format!("JIZURA line {index} has an invalid start time."),
                Some(cue.source_line),
            );
            return None;
        }
        starts.push(start);
        sources.push(source);
    }
    let mut ends = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let end = if let Some(next_start) = starts.get(index + 1) {
            (starts[index] + 0.35_f64).max(*next_start)
        } else {
            starts[index] + estimated_line_duration(cue, beat, line_scale, true)
        };
        ends.push(end);
    }
    let project_duration = ends.last().copied().unwrap_or(3.0) + tail;
    let typeset = project
        .get("typeset")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if typeset {
        for index in 0..starts.len() {
            starts[index] = (starts[index] - 0.2).max(0.0);
            ends[index] = (ends[index] - 0.2).max(starts[index] + 0.3);
        }
        state.item(
            "$.typeset",
            JizuraCompatibilityStatus::Approximated,
            "typeset-lead-preserved",
            "The JIZURA 0.2 second typesetting lead was preserved; its additional glyph-sizing rules remain renderer approximations.",
        );
    }
    let mut output = Vec::with_capacity(cues.len());
    for index in 0..cues.len() {
        if index > 0 && starts[index] < ends[index - 1] {
            state.item(
                format!("$.timing.lineTimes.{index}"),
                JizuraCompatibilityStatus::Unsupported,
                "overlapping-jizura-lines",
                "The imported line timing overlaps the previous line, which rocut motion-text sequences do not support.",
            );
            state.error(
                "overlapping-jizura-lines",
                "JIZURA line timing overlaps a previous line.",
                Some(cues[index].source_line),
            );
            return None;
        }
        let start_time = seconds_to_ticks(starts[index])?;
        let end_time = seconds_to_ticks(ends[index])?;
        let duration = end_time.saturating_sub(start_time);
        if duration <= 0 {
            state.error(
                "invalid-jizura-line-duration",
                "A JIZURA line has no positive duration.",
                Some(cues[index].source_line),
            );
            return None;
        }
        output.push(ImportedCueTiming {
            start_time,
            duration,
            source: sources[index],
        });
    }
    let Some(project_duration) = seconds_to_ticks(project_duration) else {
        state.error(
            "invalid-jizura-duration",
            "The JIZURA project duration is outside the supported range.",
            None,
        );
        return None;
    };
    Some((output, project_duration))
}

fn estimated_line_duration(
    cue: &MotionTextSourceCue,
    beat: f64,
    line_scale: f64,
    is_last: bool,
) -> f64 {
    if cue.interlude {
        return cue
            .interlude_duration_ticks
            .filter(|duration| *duration > 0)
            .map_or(4.0, |duration| duration as f64 / TICKS_PER_SECOND);
    }
    let count = cue.text.chars().count() as f64;
    let minimum: f64 = if is_last { 1.5 } else { 1.3 };
    let mut duration = (0.8 + count * 0.17).clamp(minimum, 5.2) * line_scale;
    if beat > 0.0 {
        duration = (duration / beat).round().max(2.0) * beat;
    }
    duration
}

fn seconds_to_ticks(seconds: f64) -> Option<i64> {
    let ticks = seconds * TICKS_PER_SECOND;
    if !ticks.is_finite() || ticks < i64::MIN as f64 || ticks > i64::MAX as f64 {
        return None;
    }
    Some(ticks.round() as i64)
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
        .filter(|number| number.is_finite())
}

fn validate_complete_default_preset(
    preset: &crate::planner::MotionTextPresetSelection,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) {
    for (group, id) in [
        (MotionTextPresetGroup::Layout, preset.layout.as_str()),
        (MotionTextPresetGroup::Enter, preset.enter.as_str()),
        (MotionTextPresetGroup::Hold, preset.hold.as_str()),
        (MotionTextPresetGroup::Exit, preset.exit.as_str()),
        (MotionTextPresetGroup::Treat, preset.treat.as_str()),
        (MotionTextPresetGroup::Bg, preset.bg.as_str()),
        (MotionTextPresetGroup::Cam, preset.cam.as_str()),
    ] {
        validate_preset_id(group, id, "$", renderer_support, state);
    }
}

fn validate_preset_id(
    group: MotionTextPresetGroup,
    id: &str,
    path: &str,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) -> bool {
    if !valid_id(id) || !renderer_support.contains(&(group, id.to_owned())) {
        state.item(
            path,
            JizuraCompatibilityStatus::Unsupported,
            "unsupported-preset",
            format!("The active renderer does not support imported preset {group:?}:{id}."),
        );
        state.error(
            "unsupported-jizura-preset",
            format!("The active renderer does not support imported preset {group:?}:{id}."),
            None,
        );
        return false;
    }
    true
}

fn import_fonts(
    project: &Map<String, Value>,
    builtin_font_ids: &BTreeSet<String>,
    language: &str,
    state: &mut ImportState,
) -> String {
    let font_roles = project.get("fonts").and_then(Value::as_object);
    let user_fonts = project.get("userFonts").and_then(Value::as_array);
    let referenced: BTreeSet<&str> = font_roles
        .into_iter()
        .flat_map(|roles| roles.values())
        .filter_map(Value::as_str)
        .collect();
    if let Some(user_fonts) = user_fonts {
        for (index, font) in user_fonts.iter().enumerate() {
            let Some(font) = font.as_object() else {
                state.warning(
                    "invalid-user-font",
                    format!("JIZURA user font {index} is not an object and was ignored."),
                    None,
                );
                continue;
            };
            let Some(key) = font.get("key").and_then(Value::as_str) else {
                state.warning(
                    "invalid-user-font",
                    format!("JIZURA user font {index} has no valid key and was ignored."),
                    None,
                );
                continue;
            };
            state.resources.push(JizuraImportResource {
                kind: JizuraImportResourceKind::Font,
                id: key.to_owned(),
                path: format!("$.userFonts[{index}]"),
                status: JizuraImportResourceStatus::Missing,
                required_for_fidelity: referenced.contains(key),
                message: "JIZURA user-font bytes are stored outside project JSON; import the font into rocut and relink it explicitly."
                    .to_owned(),
            });
        }
    }
    let selected: Vec<&str> = ["display", "serif", "body"]
        .into_iter()
        .filter_map(|role| {
            font_roles
                .and_then(|roles| roles.get(role))
                .and_then(Value::as_str)
        })
        .collect();
    let default = selected
        .iter()
        .find(|font_id| builtin_font_ids.contains(**font_id))
        .copied()
        .unwrap_or("gothic_bold")
        .to_owned();
    for font_id in &selected {
        if !builtin_font_ids.contains(*font_id) {
            if !state.resources.iter().any(|resource| {
                resource.kind == JizuraImportResourceKind::Font && resource.id == *font_id
            }) {
                state.resources.push(JizuraImportResource {
                    kind: JizuraImportResourceKind::Font,
                    id: (*font_id).to_owned(),
                    path: "$.fonts".to_owned(),
                    status: JizuraImportResourceStatus::Missing,
                    required_for_fidelity: true,
                    message: format!(
                        "Font {font_id} is not bundled with rocut; import and relink it explicitly."
                    ),
                });
            }
            state.item(
                "$.fonts",
                JizuraCompatibilityStatus::Unsupported,
                "font-relink-required",
                format!("Font role references unavailable font {font_id}; the role remains only in source provenance until relinked."),
            );
        }
    }
    if selected.iter().copied().collect::<BTreeSet<_>>().len() > 1 {
        state.item(
            "$.fonts",
            JizuraCompatibilityStatus::Approximated,
            "font-roles-collapsed",
            format!(
                "JIZURA role-specific fonts were preserved as metadata; current rocut cuts use {default} as their default font."
            ),
        );
    } else if !selected.is_empty() {
        state.item(
            "$.fonts",
            JizuraCompatibilityStatus::Preserved,
            "font-preserved",
            format!("JIZURA font {default} was selected as the rocut default font."),
        );
    }
    if language != "en" && default == "mono" {
        state.item(
            "$.fonts",
            JizuraCompatibilityStatus::Approximated,
            "mono-language-coverage",
            "The bundled mono role declares English coverage only; non-English glyph fidelity requires an explicit replacement.",
        );
    }
    default
}

fn import_font_roles_parameter(project: &Map<String, Value>) -> Option<MotionTextParameterValue> {
    let roles = project.get("fonts")?.as_object()?;
    let values: BTreeMap<String, MotionTextParameterValue> = ["display", "serif", "body"]
        .into_iter()
        .filter_map(|role| {
            roles
                .get(role)
                .and_then(Value::as_str)
                .filter(|font| valid_id(font))
                .map(|font| {
                    (
                        role.to_owned(),
                        MotionTextParameterValue::String(font.to_owned()),
                    )
                })
        })
        .collect();
    (!values.is_empty()).then_some(MotionTextParameterValue::Object(values))
}

fn import_colors(
    project: &Map<String, Value>,
    state: &mut ImportState,
) -> BTreeMap<String, String> {
    let Some(colors) = project.get("colors").and_then(Value::as_object) else {
        return BTreeMap::new();
    };
    let enabled = colors
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let accent_on = colors
        .get("accentOn")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut validated = BTreeMap::new();
    for key in ["bg", "fg", "sub", "accent", "ghostA", "ghostB"] {
        let Some(value) = colors.get(key).and_then(Value::as_str) else {
            continue;
        };
        if valid_color(value) {
            validated.insert(key.to_owned(), value.to_owned());
        } else {
            state.warning(
                "invalid-jizura-color",
                format!("JIZURA color {key} is invalid and was ignored."),
                None,
            );
        }
    }
    let mut imported = BTreeMap::new();
    if enabled {
        for key in ["bg", "fg", "sub"] {
            if let Some(value) = validated.get(key) {
                imported.insert(key.to_owned(), value.clone());
            }
        }
        if let Some(value) = validated.get("bg") {
            imported.insert("background".to_owned(), value.clone());
        }
        if let Some(value) = validated.get("fg") {
            imported.insert("foreground".to_owned(), value.clone());
        }
        if let Some(value) = validated.get("sub") {
            imported.insert("secondary".to_owned(), value.clone());
        }
    }
    if accent_on {
        for key in ["accent", "ghostA", "ghostB"] {
            if let Some(value) = validated.get(key) {
                imported.insert(key.to_owned(), value.clone());
            }
        }
    }
    if !validated.is_empty() {
        let active = !imported.is_empty();
        state.item(
            "$.colors",
            if active {
                JizuraCompatibilityStatus::Preserved
            } else {
                JizuraCompatibilityStatus::Ignored
            },
            if active {
                "colors-preserved"
            } else {
                "inactive-colors-provenance-only"
            },
            if active {
                "Enabled JIZURA palette values were preserved and mapped to rocut background, foreground, secondary, and accent keys."
            } else {
                "Inactive JIZURA palette values remain in source provenance and do not override the selected style."
            },
        );
    }
    imported
}

fn valid_color(value: &str) -> bool {
    (4..=9).contains(&value.len())
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn import_cue(
    index: usize,
    source: MotionTextSourceCue,
    timing: ImportedCueTiming,
    line_override: Option<&Value>,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) -> ImportedCue {
    let mut segments = source.manual_segments.clone().unwrap_or_default();
    let mut preset_override = MotionTextPresetOverride::default();
    let mut has_preset_override = false;
    let mut parameters = BTreeMap::new();
    let Some(line_override) = line_override else {
        return ImportedCue {
            source,
            timing,
            segments,
            locks: Vec::new(),
            preset_override: None,
            parameters,
        };
    };
    let Some(line_override) = line_override.as_object() else {
        state.warning(
            "invalid-line-override",
            format!("JIZURA override {index} is not an object and was ignored."),
            Some(source.source_line),
        );
        return ImportedCue {
            source,
            timing,
            segments,
            locks: Vec::new(),
            preset_override: None,
            parameters,
        };
    };
    for (field, group) in [
        ("layout", MotionTextPresetGroup::Layout),
        ("enter", MotionTextPresetGroup::Enter),
        ("hold", MotionTextPresetGroup::Hold),
        ("exit", MotionTextPresetGroup::Exit),
        ("treat", MotionTextPresetGroup::Treat),
        ("bg", MotionTextPresetGroup::Bg),
        ("cam", MotionTextPresetGroup::Cam),
    ] {
        if let Some(id) = line_override.get(field).and_then(Value::as_str) {
            if validate_preset_id(
                group,
                id,
                &format!("$.overrides.{index}.{field}"),
                renderer_support,
                state,
            ) {
                set_preset_override(&mut preset_override, group, Some(id));
                has_preset_override = true;
            }
        }
    }
    if let Some(decor) = line_override.get("decor") {
        if let Some(values) = decor.as_array() {
            let mut ids = Vec::new();
            for (decor_index, value) in values.iter().enumerate() {
                let Some(id) = value.as_str() else {
                    state.warning(
                        "invalid-decor-override",
                        format!("JIZURA decor override {decor_index} is not a preset id."),
                        Some(source.source_line),
                    );
                    continue;
                };
                if validate_preset_id(
                    MotionTextPresetGroup::Decor,
                    id,
                    &format!("$.overrides.{index}.decor[{decor_index}]"),
                    renderer_support,
                    state,
                ) {
                    ids.push(id.to_owned());
                }
            }
            preset_override.decor = Some(ids);
            has_preset_override = true;
        }
    }
    if let Some(trans) = line_override.get("trans") {
        if trans.as_str() == Some("none") || trans.is_null() {
            preset_override.trans = Some(None);
            has_preset_override = true;
        } else if let Some(id) = trans.as_str() {
            if validate_preset_id(
                MotionTextPresetGroup::Trans,
                id,
                &format!("$.overrides.{index}.trans"),
                renderer_support,
                state,
            ) {
                preset_override.trans = Some(Some(id.to_owned()));
                has_preset_override = true;
            }
        }
    }
    if let Some(seed) = line_override.get("seed").and_then(Value::as_i64) {
        parameters.insert(
            "jizura.lineSeedOffset".to_owned(),
            MotionTextParameterValue::Number(seed as f64),
        );
        state.item(
            format!("$.overrides.{index}.seed"),
            JizuraCompatibilityStatus::Approximated,
            "line-seed-rederived",
            "The line reroll counter was preserved as metadata; rocut derives cut seeds from stable cue and cut identities.",
        );
    }
    if line_override.get("single").and_then(Value::as_bool) == Some(true) && !source.interlude {
        segments = vec![source.text.clone()];
        state.item(
            format!("$.overrides.{index}.single"),
            JizuraCompatibilityStatus::Preserved,
            "single-cut-preserved",
            "The line was imported as one cut.",
        );
    } else if let Some(count) = line_override
        .get("cuts")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
    {
        segments = split_to_count(&source.text, count.min(12));
        state.item(
            format!("$.overrides.{index}.cuts"),
            JizuraCompatibilityStatus::Approximated,
            "cut-count-preserved",
            "The requested cut count was preserved with rocut's deterministic character partitioning.",
        );
    }
    if let Some(locked_segments) = locked_cut_segments(line_override) {
        segments = locked_segments;
    }
    ImportedCue {
        source,
        timing,
        segments,
        locks: Vec::new(),
        preset_override: has_preset_override.then_some(preset_override),
        parameters,
    }
}

fn set_preset_override(
    preset: &mut MotionTextPresetOverride,
    group: MotionTextPresetGroup,
    value: Option<&str>,
) {
    let value = value.map(str::to_owned);
    match group {
        MotionTextPresetGroup::Style => preset.style = value,
        MotionTextPresetGroup::Layout => preset.layout = value,
        MotionTextPresetGroup::Enter => preset.enter = value,
        MotionTextPresetGroup::Hold => preset.hold = value,
        MotionTextPresetGroup::Exit => preset.exit = value,
        MotionTextPresetGroup::Decor => preset.decor = Some(value.into_iter().collect()),
        MotionTextPresetGroup::Treat => preset.treat = value,
        MotionTextPresetGroup::Bg => preset.bg = value,
        MotionTextPresetGroup::Cam => preset.cam = value,
        MotionTextPresetGroup::Fx => preset.fx = Some(value.into_iter().collect()),
        MotionTextPresetGroup::Trans => preset.trans = Some(value),
    }
}

fn locked_cut_segments(line_override: &Map<String, Value>) -> Option<Vec<String>> {
    if line_override.get("lock").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let locked = line_override.get("lockedCuts")?.as_array()?;
    if locked.is_empty() || locked.len() > 12 {
        return None;
    }
    let segments: Vec<String> = locked
        .iter()
        .filter_map(|cut| cut.get("utext").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
        .collect();
    (segments.len() == locked.len()).then_some(segments)
}

fn apply_per_cut_imports(
    plan: &mut MotionTextPlan,
    cues: &mut [ImportedCue],
    overrides: Option<&Map<String, Value>>,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) {
    for (index, cue) in cues.iter_mut().enumerate() {
        let Some(line_override) = overrides
            .and_then(|value| value.get(&index.to_string()))
            .and_then(Value::as_object)
        else {
            continue;
        };
        let mut cue_cut_indices: Vec<usize> = plan
            .cuts
            .iter()
            .enumerate()
            .filter_map(|(cut_index, cut)| (cut.cue_id == cue.source.id).then_some(cut_index))
            .collect();
        cue_cut_indices.sort_by_key(|cut_index| plan.cuts[*cut_index].start_time);
        let locked_cuts = line_override
            .get("lockedCuts")
            .and_then(Value::as_array)
            .filter(|_| line_override.get("lock").and_then(Value::as_bool) == Some(true));
        if let Some(locked_cuts) = locked_cuts {
            if locked_cuts.len() == cue_cut_indices.len() {
                for (slot, cut_index) in cue_cut_indices.iter().copied().enumerate() {
                    apply_locked_cut_snapshot(
                        &mut plan.cuts[cut_index],
                        &locked_cuts[slot],
                        index,
                        slot,
                        renderer_support,
                        state,
                    );
                }
                cue.locks.push(MotionTextLockInput {
                    scope: "cue".to_owned(),
                    key: "all".to_owned(),
                });
                state.item(
                    format!("$.overrides.{index}.lockedCuts"),
                    JizuraCompatibilityStatus::Preserved,
                    "locked-cut-snapshot-preserved",
                    "The locked cut selections, seeds, and bounded parameter snapshot were imported into the resolved plan and protected by a cue lock.",
                );
            } else {
                state.item(
                    format!("$.overrides.{index}.lockedCuts"),
                    JizuraCompatibilityStatus::Approximated,
                    "locked-cut-count-mismatch",
                    "The locked snapshot did not match the imported cut count; the source JSON was retained but the invalid snapshot was not applied.",
                );
            }
        } else if line_override.get("lock").and_then(Value::as_bool) == Some(true) {
            state.item(
                format!("$.overrides.{index}.lock"),
                JizuraCompatibilityStatus::Approximated,
                "lock-snapshot-missing",
                "The line lock had no valid lockedCuts snapshot; the lock flag remains in source provenance but was not applied to a regenerated plan.",
            );
        }
        let cut_tech = line_override.get("cutTech").and_then(Value::as_object);
        let cut_layouts = line_override.get("cutLayouts").and_then(Value::as_object);
        for (slot, cut_index) in cue_cut_indices.iter().copied().enumerate() {
            let slot_key = slot.to_string();
            let tech = cut_tech
                .and_then(|value| value.get(&slot_key))
                .and_then(Value::as_object);
            let layout = tech
                .and_then(|value| value.get("layout"))
                .and_then(Value::as_str)
                .or_else(|| {
                    cut_layouts
                        .and_then(|value| value.get(&slot_key))
                        .and_then(Value::as_str)
                });
            let mut changed = false;
            if let Some(layout) = layout {
                changed |= apply_cut_preset(
                    &mut plan.cuts[cut_index],
                    MotionTextPresetGroup::Layout,
                    Some(layout),
                    &format!("$.overrides.{index}.cutTech.{slot}.layout"),
                    renderer_support,
                    state,
                );
            }
            if let Some(tech) = tech {
                for (field, group) in [
                    ("enter", MotionTextPresetGroup::Enter),
                    ("hold", MotionTextPresetGroup::Hold),
                    ("exit", MotionTextPresetGroup::Exit),
                    ("treat", MotionTextPresetGroup::Treat),
                    ("bg", MotionTextPresetGroup::Bg),
                    ("cam", MotionTextPresetGroup::Cam),
                ] {
                    if let Some(id) = tech.get(field).and_then(Value::as_str) {
                        changed |= apply_cut_preset(
                            &mut plan.cuts[cut_index],
                            group,
                            Some(id),
                            &format!("$.overrides.{index}.cutTech.{slot}.{field}"),
                            renderer_support,
                            state,
                        );
                    }
                }
                if let Some(decor) = tech.get("decor").and_then(Value::as_str) {
                    changed |= apply_cut_preset(
                        &mut plan.cuts[cut_index],
                        MotionTextPresetGroup::Decor,
                        (decor != "none").then_some(decor),
                        &format!("$.overrides.{index}.cutTech.{slot}.decor"),
                        renderer_support,
                        state,
                    );
                }
                if let Some(trans) = tech.get("trans").and_then(Value::as_str) {
                    changed |= apply_cut_preset(
                        &mut plan.cuts[cut_index],
                        MotionTextPresetGroup::Trans,
                        (trans != "none").then_some(trans),
                        &format!("$.overrides.{index}.cutTech.{slot}.trans"),
                        renderer_support,
                        state,
                    );
                }
            }
            if changed {
                let cut_id = plan.cuts[cut_index].id.clone();
                if !cue
                    .locks
                    .iter()
                    .any(|lock| lock.scope == "cut" && lock.key == cut_id)
                {
                    cue.locks.push(MotionTextLockInput {
                        scope: "cut".to_owned(),
                        key: cut_id,
                    });
                }
                state.item(
                    format!("$.overrides.{index}.cutTech.{slot}"),
                    JizuraCompatibilityStatus::Approximated,
                    "per-cut-override-preserved",
                    "The per-cut preset selection was preserved and locked; rocut currently locks the whole imported cut rather than only the changed JIZURA groups.",
                );
            }
        }
    }
}

fn apply_locked_cut_snapshot(
    cut: &mut crate::planner::MotionTextResolvedCut,
    snapshot: &Value,
    cue_index: usize,
    slot: usize,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) {
    let Some(snapshot) = snapshot.as_object() else {
        return;
    };
    for (field, group) in [
        ("layout", MotionTextPresetGroup::Layout),
        ("enter", MotionTextPresetGroup::Enter),
        ("hold", MotionTextPresetGroup::Hold),
        ("exit", MotionTextPresetGroup::Exit),
        ("treat", MotionTextPresetGroup::Treat),
        ("bg", MotionTextPresetGroup::Bg),
        ("cam", MotionTextPresetGroup::Cam),
    ] {
        if let Some(id) = snapshot.get(field).and_then(Value::as_str) {
            apply_cut_preset(
                cut,
                group,
                Some(id),
                &format!("$.overrides.{cue_index}.lockedCuts[{slot}].{field}"),
                renderer_support,
                state,
            );
        }
    }
    if let Some(decor) = snapshot.get("decor").and_then(Value::as_array) {
        let ids: Vec<String> = decor
            .iter()
            .filter_map(|value| value.get("id").and_then(Value::as_str))
            .filter(|id| {
                validate_preset_id(
                    MotionTextPresetGroup::Decor,
                    id,
                    &format!("$.overrides.{cue_index}.lockedCuts[{slot}].decor"),
                    renderer_support,
                    state,
                )
            })
            .map(str::to_owned)
            .collect();
        cut.preset.decor = ids;
    }
    if let Some(trans) = snapshot.get("trans") {
        if trans.is_null() {
            cut.preset.trans = None;
        } else if let Some(id) = trans.as_str() {
            apply_cut_preset(
                cut,
                MotionTextPresetGroup::Trans,
                Some(id),
                &format!("$.overrides.{cue_index}.lockedCuts[{slot}].trans"),
                renderer_support,
                state,
            );
        }
    }
    if let Some(seed) = snapshot
        .get("seed")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
    {
        cut.seed = seed;
    }
    let mut nodes = 0;
    for (field, parameter_key) in [
        ("params", "jizura.layoutParams"),
        ("treatP", "jizura.treatmentParams"),
        ("bgP", "jizura.backgroundParams"),
        ("camP", "jizura.cameraParams"),
        ("transP", "jizura.transitionParams"),
        ("morph", "jizura.morph"),
        ("twinParams", "jizura.twinParams"),
        ("events", "jizura.events"),
    ] {
        if let Some(value) = snapshot.get(field)
            && let Some(value) = bounded_parameter_value(value, 0, &mut nodes)
        {
            cut.parameters.insert(parameter_key.to_owned(), value);
        }
    }
    for field in ["inDur", "outDur", "transDur", "scheme"] {
        if let Some(value) = snapshot.get(field).and_then(Value::as_f64)
            && value.is_finite()
        {
            cut.parameters.insert(
                format!("jizura.{field}"),
                MotionTextParameterValue::Number(value),
            );
        }
    }
    for field in ["weightGrow", "kime", "recap"] {
        if let Some(value) = snapshot.get(field).and_then(Value::as_bool) {
            cut.parameters.insert(
                format!("jizura.{field}"),
                MotionTextParameterValue::Boolean(value),
            );
        }
    }
}

fn apply_cut_preset(
    cut: &mut crate::planner::MotionTextResolvedCut,
    group: MotionTextPresetGroup,
    id: Option<&str>,
    path: &str,
    renderer_support: &BTreeSet<(MotionTextPresetGroup, String)>,
    state: &mut ImportState,
) -> bool {
    if let Some(id) = id
        && !validate_preset_id(group, id, path, renderer_support, state)
    {
        return false;
    }
    match group {
        MotionTextPresetGroup::Style => cut.preset.style = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Layout => cut.preset.layout = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Enter => cut.preset.enter = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Hold => cut.preset.hold = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Exit => cut.preset.exit = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Decor => {
            cut.preset.decor = id.map(str::to_owned).into_iter().collect();
        }
        MotionTextPresetGroup::Treat => cut.preset.treat = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Bg => cut.preset.bg = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Cam => cut.preset.cam = id.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Fx => {
            cut.preset.fx = id.map(str::to_owned).into_iter().collect();
        }
        MotionTextPresetGroup::Trans => cut.preset.trans = id.map(str::to_owned),
    }
    true
}

fn bounded_parameter_value(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
) -> Option<MotionTextParameterValue> {
    *nodes += 1;
    if depth > MAX_IMPORT_PARAMETER_DEPTH || *nodes > MAX_IMPORT_PARAMETER_NODES {
        return None;
    }
    match value {
        Value::Null => Some(MotionTextParameterValue::Null(())),
        Value::Bool(value) => Some(MotionTextParameterValue::Boolean(*value)),
        Value::Number(value) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(MotionTextParameterValue::Number),
        Value::String(value) => (value.chars().count() <= MAX_IMPORT_PARAMETER_STRING_CHARACTERS)
            .then(|| MotionTextParameterValue::String(value.clone())),
        Value::Array(values) if values.len() <= 256 => values
            .iter()
            .map(|value| bounded_parameter_value(value, depth + 1, nodes))
            .collect::<Option<Vec<_>>>()
            .map(MotionTextParameterValue::Array),
        Value::Object(values) if values.len() <= 256 => values
            .iter()
            .map(|(key, value)| {
                bounded_parameter_value(value, depth + 1, nodes).map(|value| (key.clone(), value))
            })
            .collect::<Option<BTreeMap<_, _>>>()
            .map(MotionTextParameterValue::Object),
        _ => None,
    }
}

fn imported_cue_document(cue: &ImportedCue) -> Value {
    let locks: Vec<Value> = cue
        .locks
        .iter()
        .map(|lock| json!({ "scope": lock.scope, "key": lock.key }))
        .collect();
    let mut overrides = Map::new();
    if let Some(preset) = cue.preset_override.as_ref() {
        overrides.insert("preset".to_owned(), preset_override_document(preset));
    }
    if !cue.parameters.is_empty() {
        overrides.insert(
            "parameters".to_owned(),
            serde_json::to_value(&cue.parameters).expect("cue parameters serialize infallibly"),
        );
    }
    json!({
        "id": cue.source.id,
        "text": cue.source.text,
        "startTime": cue.timing.start_time,
        "duration": cue.timing.duration,
        "timingSource": cue.timing.source.key(),
        "sourceLine": cue.source.source_line,
        "interlude": cue.source.interlude,
        "gapBefore": cue.source.gap_before,
        "note": cue.source.note,
        "impact": cue.source.impact,
        "emphasis": cue.source.emphasis,
        "segments": cue.segments,
        "locks": locks,
        "overrides": overrides,
    })
}

fn preset_override_document(preset: &MotionTextPresetOverride) -> Value {
    let mut value = Map::new();
    for (key, entry) in [
        ("style", preset.style.as_ref()),
        ("layout", preset.layout.as_ref()),
        ("enter", preset.enter.as_ref()),
        ("hold", preset.hold.as_ref()),
        ("exit", preset.exit.as_ref()),
        ("treat", preset.treat.as_ref()),
        ("bg", preset.bg.as_ref()),
        ("cam", preset.cam.as_ref()),
    ] {
        if let Some(entry) = entry {
            value.insert(key.to_owned(), Value::String(entry.clone()));
        }
    }
    if let Some(entry) = preset.decor.as_ref() {
        value.insert(
            "decor".to_owned(),
            Value::Array(entry.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(entry) = preset.fx.as_ref() {
        value.insert(
            "fx".to_owned(),
            Value::Array(entry.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(entry) = preset.trans.as_ref() {
        value.insert(
            "trans".to_owned(),
            entry.clone().map_or(Value::Null, Value::String),
        );
    }
    Value::Object(value)
}

fn import_metadata(
    project: &Map<String, Value>,
    parsed_metadata: &[crate::source::MotionTextMetadata],
) -> BTreeMap<String, MotionTextParameterValue> {
    let metadata_value = |project_key: &str, source_key: &str| {
        project
            .get(project_key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|value| {
                value
                    .chars()
                    .take(MAX_IMPORT_PARAMETER_STRING_CHARACTERS)
                    .collect()
            })
            .or_else(|| {
                parsed_metadata
                    .iter()
                    .find(|entry| entry.key == source_key)
                    .map(|entry| {
                        entry
                            .value
                            .chars()
                            .take(MAX_IMPORT_PARAMETER_STRING_CHARACTERS)
                            .collect()
                    })
            })
    };
    let mut metadata = BTreeMap::new();
    if let Some(title) = metadata_value("title", "ti") {
        metadata.insert("title".to_owned(), MotionTextParameterValue::String(title));
    }
    if let Some(artist) = metadata_value("artist", "ar") {
        metadata.insert(
            "artist".to_owned(),
            MotionTextParameterValue::String(artist),
        );
    }
    if let Some(version) = project.get("version").and_then(Value::as_f64) {
        metadata.insert(
            "sourceVersion".to_owned(),
            MotionTextParameterValue::Number(version),
        );
    }
    if let Some(app_version) = project.get("appVersion").and_then(Value::as_str) {
        metadata.insert(
            "sourceAppVersion".to_owned(),
            MotionTextParameterValue::String(app_version.chars().take(80).collect()),
        );
    }
    metadata
}

fn report_global_compatibility(project: &Map<String, Value>, state: &mut ImportState) {
    for (field, message) in [
        (
            "mood",
            "Mood remains in source provenance; rocut preserves explicit preset selections but does not reproduce JIZURA's mood-weighted random history.",
        ),
        (
            "fx",
            "Global JIZURA FX intensity controls remain in source provenance; imported explicit per-line and per-cut presets take precedence.",
        ),
        (
            "enabled",
            "JIZURA random-pool enable maps remain in source provenance and do not disable rocut's renderer catalog.",
        ),
        (
            "extra",
            "JIZURA's extra-preset random pool switch remains in source provenance; explicit imported selections are preserved.",
        ),
        (
            "wa",
            "JIZURA's Japanese-motif random pool switch remains in source provenance; explicit imported selections are preserved.",
        ),
        (
            "keyBg",
            "JIZURA chroma/luma key output mode is not imported as a scene setting; the motion-text sequence remains an overlay.",
        ),
    ] {
        let Some(value) = project.get(field) else {
            continue;
        };
        let active = match value {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::String(value) => !value.is_empty() && value != "off",
            Value::Object(value) => !value.is_empty(),
            _ => true,
        };
        if active {
            state.item(
                format!("$.{field}"),
                JizuraCompatibilityStatus::Approximated,
                format!("{field}-provenance-only"),
                message,
            );
        }
    }
    for field in ["aspect", "res", "fps", "exportRange"] {
        if project.contains_key(field) {
            state.item(
                format!("$.{field}"),
                JizuraCompatibilityStatus::Ignored,
                "host-project-setting",
                "The value is retained in source provenance; canvas, frame rate, and export range remain owned by the rocut project.",
            );
        }
    }
    if project.contains_key("locks") {
        state.item(
            "$.locks",
            JizuraCompatibilityStatus::Ignored,
            "ui-randomizer-locks",
            "JIZURA top-level tech/parameter locks only constrain its UI randomizer and are not applied as content locks.",
        );
    }
    if project
        .get("title")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        state.item(
            "$.title",
            JizuraCompatibilityStatus::Approximated,
            "title-metadata-preserved",
            "The title is preserved as sequence metadata; JIZURA's automatically generated title card is not reconstructed.",
        );
    }
    state.item(
        "$.audio",
        JizuraCompatibilityStatus::Ignored,
        "audio-relink-required",
        "Project JSON contains no audio bytes or durable media identity; audio must be relinked through rocut's asset system.",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn support(group: MotionTextPresetGroup, ids: &[&str]) -> Vec<MotionTextRendererPresetSupport> {
        ids.iter()
            .map(|id| MotionTextRendererPresetSupport {
                group,
                id: (*id).to_owned(),
            })
            .collect()
    }

    fn renderer_support() -> Vec<MotionTextRendererPresetSupport> {
        let mut entries = Vec::new();
        entries.extend(support(
            MotionTextPresetGroup::Style,
            &["noir", "crimson", "base"],
        ));
        entries.extend(support(
            MotionTextPresetGroup::Layout,
            &["center", "huge", "type"],
        ));
        entries.extend(support(
            MotionTextPresetGroup::Enter,
            &["fade", "pop", "wipe"],
        ));
        entries.extend(support(
            MotionTextPresetGroup::Hold,
            &["still", "pulse", "drift"],
        ));
        entries.extend(support(
            MotionTextPresetGroup::Exit,
            &["fade", "shrink", "wipe"],
        ));
        entries.extend(support(MotionTextPresetGroup::Decor, &["rings", "dots"]));
        entries.extend(support(
            MotionTextPresetGroup::Treat,
            &["none", "outline", "outlineFill"],
        ));
        entries.extend(support(
            MotionTextPresetGroup::Bg,
            &["transparent", "none", "grid"],
        ));
        entries.extend(support(MotionTextPresetGroup::Cam, &["static", "push"]));
        entries.extend(support(MotionTextPresetGroup::Fx, &["chroma"]));
        entries.extend(support(MotionTextPresetGroup::Trans, &["wipe"]));
        entries
    }

    fn import(project_json: &str) -> ImportJizuraMotionTextProjectResult {
        import_jizura_motion_text_project(ImportJizuraMotionTextProjectOptions {
            sequence_id: "sequence:jizura-import".to_owned(),
            project_json: project_json.to_owned(),
            renderer_support: renderer_support(),
        })
    }

    #[test]
    fn imports_the_fixed_v1_fixture_with_manual_timing_and_explicit_presets() {
        let result = import(include_str!("../fixtures/jizura-v1-project.json"));
        let expected: Value =
            serde_json::from_str(include_str!("../fixtures/jizura-v1-expected.json"))
                .expect("expected fixture is valid JSON");
        assert!(
            result.sequence_json.is_some(),
            "diagnostics: {:?}",
            result.diagnostics
        );
        let sequence: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("fixture sequence exists"),
        )
        .expect("imported sequence is valid JSON");
        assert_eq!(sequence["source"]["format"], "jizura");
        assert_eq!(sequence["revision"], 0);
        assert_eq!(sequence["language"], expected["language"]);
        assert_eq!(
            sequence["planningControls"],
            json!({
                "presetSets": { "horror": false, "typo": true, "kinetic": true },
                "unify": false,
                "centerFree": false,
                "centerDirection": "tb"
            })
        );
        assert_eq!(sequence["duration"], expected["duration"]);
        assert_eq!(
            sequence["defaults"]["preset"]["style"],
            expected["defaultStyle"]
        );
        assert_eq!(sequence["defaults"]["fontId"], expected["defaultFontId"]);
        assert_eq!(sequence["defaults"]["colors"]["foreground"], "#F4F4F5");
        assert_eq!(
            sequence["cues"]
                .as_array()
                .expect("cues are an array")
                .iter()
                .map(|cue| cue["startTime"].clone())
                .collect::<Vec<_>>(),
            expected["cueStarts"]
                .as_array()
                .expect("expected starts are an array")
                .clone()
        );
        assert_eq!(
            sequence["cues"]
                .as_array()
                .expect("cues are an array")
                .iter()
                .map(|cue| cue["duration"].clone())
                .collect::<Vec<_>>(),
            expected["cueDurations"]
                .as_array()
                .expect("expected durations are an array")
                .clone()
        );
        assert_eq!(
            sequence["cues"]
                .as_array()
                .expect("cues are an array")
                .iter()
                .map(|cue| cue["timingSource"].clone())
                .collect::<Vec<_>>(),
            expected["timingSources"]
                .as_array()
                .expect("expected timing sources are an array")
                .clone()
        );
        assert_eq!(sequence["cues"][0]["overrides"]["preset"]["layout"], "huge");
        assert_eq!(sequence["cues"][1]["locks"][0]["scope"], "cut");
        assert_eq!(sequence["resolvedPlan"]["sequenceRevision"], 0);
        assert!(result.resources_needed.iter().any(|resource| {
            resource.kind == JizuraImportResourceKind::Audio && resource.id == "jizura-audio"
        }));
        assert!(result.compatibility_report.items.iter().any(|item| {
            item.path == "$.lang"
                && item.status == JizuraCompatibilityStatus::Preserved
                && item.code == "language-preserved"
        }));
        assert_eq!(
            result.compatibility_report.status,
            JizuraImportStatus::ImportedWithWarnings
        );
        let actual_codes: BTreeSet<&str> = result
            .compatibility_report
            .items
            .iter()
            .map(|item| item.code.as_str())
            .collect();
        for code in expected["requiredCompatibilityCodes"]
            .as_array()
            .expect("required compatibility codes are an array")
        {
            assert!(
                actual_codes.contains(code.as_str().expect("code is a string")),
                "missing compatibility code {code}"
            );
        }
        let actual_resources: BTreeSet<String> = result
            .resources_needed
            .iter()
            .map(|resource| {
                format!(
                    "{}:{}:{}",
                    serde_json::to_value(resource.kind)
                        .expect("kind serializes")
                        .as_str()
                        .expect("kind serializes as a string"),
                    resource.id,
                    serde_json::to_value(resource.status)
                        .expect("status serializes")
                        .as_str()
                        .expect("status serializes as a string")
                )
            })
            .collect();
        for resource in expected["requiredResources"]
            .as_array()
            .expect("required resources are an array")
        {
            assert!(
                actual_resources.contains(resource.as_str().expect("resource is a string")),
                "missing resource {resource}"
            );
        }
    }

    #[test]
    fn imports_native_family_unify_and_center_free_controls() {
        let mut project: Value =
            serde_json::from_str(include_str!("../fixtures/jizura-v1-project.json"))
                .expect("fixture is valid JSON");
        project["horror"] = Value::Bool(true);
        project["typo"] = Value::Bool(false);
        project["kinetic"] = Value::Bool(true);
        project["unify"] = Value::Bool(true);
        project["centerFree"] = Value::Bool(true);
        project["centerDir"] = Value::String("lr".to_owned());

        let result = import(&project.to_string());
        let sequence: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("sequence is imported"),
        )
        .expect("sequence is valid JSON");
        assert_eq!(
            sequence["planningControls"],
            json!({
                "presetSets": { "horror": true, "typo": false, "kinetic": true },
                "unify": true,
                "centerFree": true,
                "centerDirection": "lr"
            })
        );
        assert!(
            sequence["resolvedPlan"]["cuts"]
                .as_array()
                .expect("cuts are an array")
                .iter()
                .all(|cut| cut["parameters"].get("jizura.centerFree").is_some())
        );
        assert!(result.compatibility_report.items.iter().any(|item| {
            item.path == "$.centerFree"
                && item.status == JizuraCompatibilityStatus::Preserved
                && item.code == "planning-control-preserved"
        }));
    }

    #[test]
    fn auto_detects_japanese_and_uses_lrc_when_every_line_is_timed() {
        let project = json!({
            "version": 1,
            "lyrics": "[00:01.00]夜明けの色\n[00:03.00]声が響く",
            "style": "noir",
            "lang": "auto",
            "seed": 7,
            "timing": { "tail": 0.9 }
        });
        let result = import(&project.to_string());
        let sequence: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("sequence is imported"),
        )
        .expect("sequence is valid JSON");
        assert_eq!(sequence["language"], "ja");
        assert_eq!(sequence["cues"][0]["startTime"], 120_000);
        assert_eq!(sequence["cues"][0]["duration"], 240_000);
        assert_eq!(sequence["cues"][0]["timingSource"], "lrc");
    }

    #[test]
    fn preserves_jizura_offset_estimation_and_tail_in_sequence_duration() {
        let project = json!({
            "version": 1,
            "lyrics": "a\nb",
            "style": "noir",
            "lang": "en",
            "seed": 7,
            "timing": { "offset": 0.4, "tail": 0.9, "lineScale": 1 }
        });
        let result = import(&project.to_string());
        let sequence: Value = serde_json::from_str(
            result
                .sequence_json
                .as_deref()
                .expect("sequence is imported"),
        )
        .expect("sequence is valid JSON");
        assert_eq!(sequence["cues"][0]["startTime"], 48_000);
        assert_eq!(sequence["cues"][1]["startTime"], 204_000);
        assert_eq!(sequence["duration"], 492_000);
    }

    #[test]
    fn rejects_future_versions_and_malformed_json_without_partial_sequences() {
        let future = import(r#"{"version":2,"lyrics":"future"}"#);
        assert!(future.sequence_json.is_none());
        assert_eq!(
            future.compatibility_report.status,
            JizuraImportStatus::Rejected
        );
        assert!(
            future
                .diagnostics
                .iter()
                .any(|entry| entry.code == "unsupported-jizura-version")
        );

        let malformed = import("{not-json");
        assert!(malformed.sequence_json.is_none());
        assert!(
            malformed
                .diagnostics
                .iter()
                .any(|entry| entry.code == "invalid-jizura-json")
        );
    }

    #[test]
    fn reports_user_fonts_and_does_not_resolve_external_fields() {
        let project = json!({
            "version": 1,
            "lyrics": "hello world",
            "style": "noir",
            "lang": "en",
            "seed": 9,
            "fonts": { "display": "user_brand" },
            "userFonts": [{
                "key": "user_brand",
                "family": "Brand Font",
                "src": "https://example.invalid/font.ttf"
            }],
            "pluginScript": "https://example.invalid/run.js"
        });
        let result = import(&project.to_string());
        assert!(result.sequence_json.is_some());
        assert!(result.resources_needed.iter().any(|resource| {
            resource.kind == JizuraImportResourceKind::Font
                && resource.id == "user_brand"
                && resource.required_for_fidelity
        }));
        assert!(result.compatibility_report.items.iter().any(|item| {
            item.path == "$.pluginScript" && item.code == "unknown-field-preserved-as-source"
        }));
    }

    #[test]
    fn rejects_unknown_explicit_presets_instead_of_silently_substituting() {
        let project = json!({
            "version": 1,
            "lyrics": "first line",
            "style": "future-style",
            "lang": "en",
            "seed": 3
        });
        let result = import(&project.to_string());
        assert!(result.sequence_json.is_none());
        assert!(
            result
                .compatibility_report
                .items
                .iter()
                .any(|item| item.path == "$.style"
                    && item.status == JizuraCompatibilityStatus::Unsupported)
        );
    }

    #[test]
    fn rejects_overlapping_manual_line_times() {
        let project = json!({
            "version": 1,
            "lyrics": "first line\nsecond line",
            "style": "noir",
            "lang": "en",
            "timing": { "lineTimes": { "0": 1.0, "1": 1.1 } }
        });
        let result = import(&project.to_string());
        assert!(result.sequence_json.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|entry| entry.code == "overlapping-jizura-lines")
        );
    }
}
