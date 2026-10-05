use std::collections::{BTreeMap, BTreeSet};

use bridge::export;
use serde::{Deserialize, Serialize};

#[export]
pub const MOTION_TEXT_PLAN_VERSION: u32 = 1;

pub const MOTION_TEXT_TOKENIZER_VERSION: &str = "unicode-v1";

const CENTER_FREE_PARAMETER: &str = "jizura.centerFree";

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "lowercase")]
pub enum MotionTextPresetSet {
    Horror,
    Typo,
    Kinetic,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPresetSetControls {
    pub horror: bool,
    pub typo: bool,
    pub kinetic: bool,
}

impl Default for MotionTextPresetSetControls {
    fn default() -> Self {
        Self {
            horror: false,
            typo: true,
            kinetic: true,
        }
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
pub enum MotionTextCenterDirection {
    #[default]
    #[serde(rename = "tb")]
    TopBottom,
    #[serde(rename = "lr")]
    LeftRight,
}

impl MotionTextCenterDirection {
    fn key(self) -> &'static str {
        match self {
            Self::TopBottom => "tb",
            Self::LeftRight => "lr",
        }
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlanningControls {
    #[serde(default)]
    pub preset_sets: MotionTextPresetSetControls,
    #[serde(default)]
    pub unify: bool,
    #[serde(default)]
    pub center_free: bool,
    #[serde(default)]
    pub center_direction: MotionTextCenterDirection,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenizeMotionTextOptions {
    pub text: String,
    pub language: String,
    #[serde(default)]
    pub explicit_segments: Vec<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenizedMotionText {
    pub version: String,
    pub segments: Vec<String>,
    pub explicit: bool,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(
    feature = "wasm",
    tsify(from_wasm_abi, into_wasm_abi, hashmap_as_object, missing_as_null)
)]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum MotionTextParameterValue {
    Null(#[cfg_attr(feature = "wasm", tsify(type = "null"))] ()),
    Boolean(bool),
    Number(f64),
    String(String),
    Array(Vec<MotionTextParameterValue>),
    Object(BTreeMap<String, MotionTextParameterValue>),
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTextPresetGroup {
    Style,
    Layout,
    Enter,
    Hold,
    Exit,
    Decor,
    Treat,
    Bg,
    Cam,
    Fx,
    Trans,
}

impl MotionTextPresetGroup {
    fn key(self) -> &'static str {
        match self {
            Self::Style => "style",
            Self::Layout => "layout",
            Self::Enter => "enter",
            Self::Hold => "hold",
            Self::Exit => "exit",
            Self::Decor => "decor",
            Self::Treat => "treat",
            Self::Bg => "bg",
            Self::Cam => "cam",
            Self::Fx => "fx",
            Self::Trans => "trans",
        }
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPresetSelection {
    pub style: String,
    pub layout: String,
    pub enter: String,
    pub hold: String,
    pub exit: String,
    pub decor: Vec<String>,
    pub treat: String,
    pub bg: String,
    pub cam: String,
    pub fx: Vec<String>,
    pub trans: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPresetOverride {
    pub style: Option<String>,
    pub layout: Option<String>,
    pub enter: Option<String>,
    pub hold: Option<String>,
    pub exit: Option<String>,
    pub decor: Option<Vec<String>>,
    pub treat: Option<String>,
    pub bg: Option<String>,
    pub cam: Option<String>,
    pub fx: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_present_nullable_string")]
    #[cfg_attr(feature = "wasm", tsify(type = "string | null"))]
    pub trans: Option<Option<String>>,
}

fn deserialize_present_nullable_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextDefaultsInput {
    pub preset: MotionTextPresetSelection,
    pub font_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(
        feature = "wasm",
        tsify(type = "Record<string, MotionTextParameterValue>")
    )]
    pub parameters: BTreeMap<String, MotionTextParameterValue>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextOverridesInput {
    pub preset: Option<MotionTextPresetOverride>,
    pub font_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(
        feature = "wasm",
        tsify(type = "Record<string, MotionTextParameterValue>")
    )]
    pub parameters: BTreeMap<String, MotionTextParameterValue>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextLockInput {
    pub scope: String,
    pub key: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextCueInput {
    pub id: String,
    pub text: String,
    pub start_time: i64,
    pub duration: i64,
    pub interlude: bool,
    #[serde(default)]
    pub gap_before: bool,
    #[serde(default)]
    pub impact: bool,
    #[serde(default)]
    pub segments: Vec<String>,
    #[serde(default)]
    pub cut_durations: Vec<i64>,
    #[serde(default)]
    pub locks: Vec<MotionTextLockInput>,
    #[serde(default)]
    pub overrides: MotionTextOverridesInput,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextEngineInput {
    pub tokenizer_version: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextSequenceInput {
    pub id: String,
    pub revision: u32,
    pub duration: i64,
    pub seed: u32,
    pub language: String,
    #[serde(default)]
    pub planning_controls: MotionTextPlanningControls,
    pub engine: MotionTextEngineInput,
    pub defaults: MotionTextDefaultsInput,
    #[serde(default)]
    pub cues: Vec<MotionTextCueInput>,
    pub resolved_plan: Option<MotionTextPlan>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPresetChoice {
    pub group: MotionTextPresetGroup,
    pub id: String,
    pub weight: f64,
    #[serde(default)]
    pub preset_set: Option<MotionTextPresetSet>,
    #[serde(default)]
    pub min_chars: Option<u32>,
    #[serde(default)]
    pub max_chars: Option<u32>,
    #[serde(default)]
    pub min_duration: Option<i64>,
    #[serde(default)]
    pub max_duration: Option<i64>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlannerCatalog {
    #[serde(default)]
    pub choices: Vec<MotionTextPresetChoice>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextRendererPresetSupport {
    pub group: MotionTextPresetGroup,
    pub id: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextVariation {
    pub salt: u32,
    #[serde(default)]
    pub cue_ids: Vec<String>,
    #[serde(default)]
    pub groups: Vec<MotionTextPresetGroup>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlanOptions {
    pub sequence: MotionTextSequenceInput,
    #[serde(default)]
    pub catalog: MotionTextPlannerCatalog,
    #[serde(default)]
    pub renderer_support: Option<Vec<MotionTextRendererPresetSupport>>,
    #[serde(default)]
    pub randomize_groups: Vec<MotionTextPresetGroup>,
    pub variation: Option<MotionTextVariation>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(
    feature = "wasm",
    tsify(from_wasm_abi, into_wasm_abi, hashmap_as_object, missing_as_null)
)]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextResolvedCut {
    pub id: String,
    pub cue_id: String,
    pub text: String,
    pub start_time: i64,
    pub duration: i64,
    pub seed: u32,
    pub preset: MotionTextPresetSelection,
    pub font_id: Option<String>,
    #[cfg_attr(
        feature = "wasm",
        tsify(type = "Record<string, MotionTextParameterValue>")
    )]
    pub parameters: BTreeMap<String, MotionTextParameterValue>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlan {
    pub version: u32,
    pub sequence_revision: u32,
    pub cuts: Vec<MotionTextResolvedCut>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MotionTextPlanDiagnosticSeverity {
    Warning,
    Error,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(
    feature = "wasm",
    tsify(into_wasm_abi, hashmap_as_object, missing_as_null)
)]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlanDiagnostic {
    pub severity: MotionTextPlanDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub cue_id: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(
    feature = "wasm",
    tsify(into_wasm_abi, hashmap_as_object, missing_as_null)
)]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextPlanResult {
    pub tokenizer_version: String,
    pub plan: Option<MotionTextPlan>,
    pub diagnostics: Vec<MotionTextPlanDiagnostic>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapMotionTextClipTimeOptions {
    pub clip_start_time: i64,
    pub clip_duration: i64,
    pub trim_start: i64,
    pub timeline_time: i64,
    pub sequence_duration: i64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextClipTimeMapping {
    pub active: bool,
    pub sequence_time: Option<i64>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapMotionTextSequenceTimeToTimelineOptions {
    pub clip_start_time: i64,
    pub clip_duration: i64,
    pub trim_start: i64,
    pub sequence_time: i64,
    pub sequence_duration: i64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextSequenceTimeMapping {
    pub active: bool,
    pub timeline_time: Option<i64>,
}

#[export]
pub fn tokenize_motion_text(options: TokenizeMotionTextOptions) -> TokenizedMotionText {
    let explicit_segments: Vec<String> = options
        .explicit_segments
        .into_iter()
        .map(|segment| segment.trim().to_owned())
        .filter(|segment| !segment.is_empty())
        .collect();
    let explicit = !explicit_segments.is_empty();
    let segments = if explicit {
        explicit_segments
    } else {
        deterministic_segments(&options.text, &options.language)
    };
    TokenizedMotionText {
        version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
        segments,
        explicit,
    }
}

#[export]
pub fn map_motion_text_clip_time(
    options: MapMotionTextClipTimeOptions,
) -> MotionTextClipTimeMapping {
    let valid = options.clip_duration > 0
        && options.trim_start >= 0
        && options.sequence_duration > 0
        && options.timeline_time >= options.clip_start_time
        && options.timeline_time
            < options
                .clip_start_time
                .saturating_add(options.clip_duration);
    if !valid {
        return MotionTextClipTimeMapping {
            active: false,
            sequence_time: None,
        };
    }
    let sequence_time = options
        .trim_start
        .saturating_add(options.timeline_time - options.clip_start_time);
    if sequence_time < 0 || sequence_time >= options.sequence_duration {
        return MotionTextClipTimeMapping {
            active: false,
            sequence_time: None,
        };
    }
    MotionTextClipTimeMapping {
        active: true,
        sequence_time: Some(sequence_time),
    }
}

#[export]
pub fn map_motion_text_sequence_time_to_timeline(
    options: MapMotionTextSequenceTimeToTimelineOptions,
) -> MotionTextSequenceTimeMapping {
    let visible_sequence_end = options
        .trim_start
        .saturating_add(options.clip_duration)
        .min(options.sequence_duration);
    let valid = options.clip_duration > 0
        && options.trim_start >= 0
        && options.trim_start < options.sequence_duration
        && options.sequence_duration > 0
        && options.sequence_time >= options.trim_start
        && options.sequence_time < visible_sequence_end;
    if !valid {
        return MotionTextSequenceTimeMapping {
            active: false,
            timeline_time: None,
        };
    }
    MotionTextSequenceTimeMapping {
        active: true,
        timeline_time: Some(
            options
                .clip_start_time
                .saturating_add(options.sequence_time - options.trim_start),
        ),
    }
}

#[export]
pub fn plan_motion_text_sequence(options: MotionTextPlanOptions) -> MotionTextPlanResult {
    let mut diagnostics = validate_plan_input(&options);
    if diagnostics
        .iter()
        .any(|entry| entry.severity == MotionTextPlanDiagnosticSeverity::Error)
    {
        return MotionTextPlanResult {
            tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
            plan: None,
            diagnostics,
        };
    }

    let variation_targets: BTreeSet<&str> = options
        .variation
        .as_ref()
        .map(|variation| variation.cue_ids.iter().map(String::as_str).collect())
        .unwrap_or_default();
    let variation_groups: BTreeSet<MotionTextPresetGroup> = options
        .variation
        .as_ref()
        .map(|variation| variation.groups.iter().copied().collect())
        .unwrap_or_default();
    let randomize_groups: BTreeSet<MotionTextPresetGroup> =
        options.randomize_groups.iter().copied().collect();
    let variation_salt = options.variation.as_ref().map_or(0, |value| value.salt);
    let existing_by_cue = existing_cuts_by_cue(options.sequence.resolved_plan.as_ref());
    let mut cuts = Vec::new();
    let mut repeat_history = BTreeMap::<String, Vec<MotionTextResolvedCut>>::new();
    let mut unified_look = UnifiedLookState::default();
    let mut ordered_cues: Vec<&MotionTextCueInput> = options.sequence.cues.iter().collect();
    ordered_cues.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut previous_cut_end = None;
    let mut previous_cut_was_interlude = false;
    let mut previous_cue_was_interlude = false;

    for cue in ordered_cues {
        if options.sequence.planning_controls.unify
            && (cue.gap_before || previous_cue_was_interlude)
        {
            unified_look.start_section();
        }
        previous_cue_was_interlude = cue.interlude;
        let repeat_key = normalize_repeat_text(&cue.text);
        let cue_allows_unified_look = options.sequence.planning_controls.unify
            && !cue.interlude
            && cue.overrides.preset.is_none()
            && cue.overrides.font_id.is_none()
            && cue.overrides.parameters.is_empty();
        let repeat_template = cue_allows_unified_look
            .then(|| repeat_history.get(&repeat_key))
            .flatten()
            .cloned();
        let is_variation_target = options.variation.is_none()
            || variation_targets.is_empty()
            || variation_targets.contains(cue.id.as_str());
        // Group locks preserve the render seed too when every requested group
        // is locked; otherwise a no-op reroll can still change glyph geometry.
        let locks_variation_groups = cue
            .locks
            .iter()
            .any(|lock| lock.scope == "cue" && (lock.key == "all" || lock.key == "preset"))
            || (!variation_groups.is_empty()
                && variation_groups.iter().all(|group| {
                    cue.locks
                        .iter()
                        .any(|lock| lock.scope == "preset-group" && lock.key == group.key())
                }));
        if options.variation.is_some() && (!is_variation_target || locks_variation_groups) {
            if let Some(existing) = existing_by_cue.get(cue.id.as_str()) {
                let mut reused = existing.to_vec();
                reused.sort_by(|left, right| {
                    left.start_time
                        .cmp(&right.start_time)
                        .then_with(|| left.id.cmp(&right.id))
                });
                for cut in reused {
                    previous_cut_end = Some(cut.start_time.saturating_add(cut.duration));
                    previous_cut_was_interlude = cue.interlude;
                    cuts.push(cut);
                }
                if cue_allows_unified_look && !repeat_key.is_empty() {
                    repeat_history
                        .entry(repeat_key)
                        .or_insert_with(|| existing.to_vec());
                }
                continue;
            }
        }

        let tokenized = tokenize_motion_text(TokenizeMotionTextOptions {
            text: cue.text.clone(),
            language: options.sequence.language.clone(),
            explicit_segments: cue.segments.clone(),
        });
        let segments = if cue.interlude {
            vec![String::new()]
        } else {
            tokenized.segments
        };
        if segments.is_empty() {
            diagnostics.push(warning(
                "empty-cue",
                "The cue produced no renderable segments and was skipped.",
                Some(&cue.id),
            ));
            continue;
        }
        if i64::try_from(segments.len()).unwrap_or(i64::MAX) > cue.duration {
            diagnostics.push(error(
                "cut-duration-underflow",
                "The cue is too short to assign a positive duration to every cut.",
                Some(&cue.id),
            ));
            continue;
        }

        let durations = if cue.cut_durations.is_empty() {
            let weights: Vec<i64> = segments
                .iter()
                .map(|segment| i64::try_from(segment.chars().count().max(1)).unwrap_or(i64::MAX))
                .collect();
            partition_duration(cue.duration, &weights)
        } else {
            cue.cut_durations.clone()
        };
        let existing = existing_by_cue.get(cue.id.as_str());
        let cue_cut_start = cuts.len();
        let mut start_time = cue.start_time;
        let mut occurrences = BTreeMap::<String, u32>::new();
        for (index, (text, duration)) in segments.into_iter().zip(durations).enumerate() {
            let occurrence = occurrences.entry(text.clone()).or_default();
            let cut_id = stable_id(
                "cut",
                &format!(
                    "{}\0{}\0{}\0{}",
                    options.sequence.id, cue.id, text, *occurrence
                ),
            );
            *occurrence += 1;
            let previous = existing.and_then(|values| {
                values
                    .iter()
                    .find(|value| value.id == cut_id)
                    .or_else(|| values.get(index))
            });
            let seed = hash_u32(&[
                u64::from(options.sequence.seed),
                stable_hash(&cue.id),
                stable_hash(&cut_id),
                u64::from(variation_salt),
            ]);
            let randomized_groups = if options.variation.is_some() {
                &variation_groups
            } else {
                &randomize_groups
            };
            let has_adjacent_previous = previous_cut_end == Some(start_time)
                && !previous_cut_was_interlude
                && !cue.interlude;
            let mut preset = previous
                .map(|value| value.preset.clone())
                .unwrap_or_else(|| options.sequence.defaults.preset.clone());
            apply_randomized_presets(
                &mut preset,
                &options.catalog,
                options.renderer_support.as_deref(),
                &options.sequence.planning_controls,
                randomized_groups,
                seed,
                PresetChoiceContext {
                    character_count: u32::try_from(text.chars().count()).unwrap_or(u32::MAX),
                    duration,
                    has_adjacent_previous,
                },
            );
            let repeated_cut = repeat_template
                .as_ref()
                .and_then(|template| template.get(index))
                .filter(|template| template.text == text);
            if let Some(template) = repeated_cut {
                preset.clone_from(&template.preset);
            } else if cue_allows_unified_look {
                unified_look.apply(
                    &mut preset,
                    &options.catalog,
                    options.renderer_support.as_deref(),
                    &options.sequence.planning_controls,
                    randomized_groups,
                    seed,
                    PresetChoiceContext {
                        character_count: u32::try_from(text.chars().count()).unwrap_or(u32::MAX),
                        duration,
                        has_adjacent_previous,
                    },
                    cue.impact,
                );
            }
            apply_preset_override(&mut preset, cue.overrides.preset.as_ref());
            apply_preset_locks(&mut preset, previous, &cue.locks);

            let mut parameters = repeated_cut.map_or_else(
                || options.sequence.defaults.parameters.clone(),
                |template| template.parameters.clone(),
            );
            parameters.extend(cue.overrides.parameters.clone());
            apply_center_free_parameters(
                &mut parameters,
                &text,
                &options.sequence.language,
                duration,
                options.sequence.planning_controls,
            );
            apply_parameter_locks(&mut parameters, previous, &cue.locks);
            let locked_cut = cue.locks.iter().any(|lock| {
                (lock.scope == "cut" && lock.key == cut_id)
                    || (lock.scope == "cue" && lock.key == "all")
            });
            let resolved_seed = if locked_cut {
                previous.map_or(seed, |value| value.seed)
            } else if let Some(template) = repeated_cut {
                template.seed
            } else if options.variation.is_none() {
                previous
                    .filter(|value| value.id == cut_id)
                    .map_or(seed, |value| value.seed)
            } else {
                seed
            };
            if locked_cut {
                if let Some(value) = previous {
                    preset = value.preset.clone();
                    parameters = value.parameters.clone();
                }
            }
            if !has_adjacent_previous {
                preset.trans = None;
            }
            let font_id = if locked_cut && previous.is_some() {
                previous.and_then(|value| value.font_id.clone())
            } else {
                cue.overrides
                    .font_id
                    .clone()
                    .or_else(|| repeated_cut.and_then(|template| template.font_id.clone()))
                    .or_else(|| options.sequence.defaults.font_id.clone())
            };
            cuts.push(MotionTextResolvedCut {
                id: cut_id,
                cue_id: cue.id.clone(),
                text,
                start_time,
                duration,
                seed: resolved_seed,
                preset,
                font_id,
                parameters,
            });
            if cue_allows_unified_look {
                unified_look.remember(&cuts.last().expect("the planned cut exists").preset);
            }
            start_time = start_time.saturating_add(duration);
            previous_cut_end = Some(start_time);
            previous_cut_was_interlude = cue.interlude;
        }
        if cue_allows_unified_look && !repeat_key.is_empty() {
            repeat_history
                .entry(repeat_key)
                .or_insert_with(|| cuts[cue_cut_start..].to_vec());
        }
    }
    diagnostics.extend(validate_resolved_renderer_support(
        &cuts,
        options.renderer_support.as_deref(),
    ));

    if diagnostics
        .iter()
        .any(|entry| entry.severity == MotionTextPlanDiagnosticSeverity::Error)
    {
        return MotionTextPlanResult {
            tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
            plan: None,
            diagnostics,
        };
    }
    cuts.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| left.id.cmp(&right.id))
    });
    MotionTextPlanResult {
        tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
        plan: Some(MotionTextPlan {
            version: MOTION_TEXT_PLAN_VERSION,
            sequence_revision: options.sequence.revision,
            cuts,
        }),
        diagnostics,
    }
}

fn deterministic_segments(text: &str, language: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let language = language.to_ascii_lowercase();
    let is_east_asian =
        language.starts_with("ja") || language.starts_with("zh") || language.starts_with("ko");
    if language.starts_with("en") || (!is_east_asian && text.chars().any(char::is_whitespace)) {
        return latin_phrase_segments(text);
    }
    let limit = if language.starts_with("ko") { 3 } else { 4 };
    let mut segments = Vec::new();
    let mut current = String::new();
    for character in text.chars() {
        if character.is_whitespace() {
            push_segment(&mut segments, &mut current);
            continue;
        }
        current.push(character);
        if is_sentence_punctuation(character) || current.chars().count() >= limit {
            push_segment(&mut segments, &mut current);
        }
    }
    push_segment(&mut segments, &mut current);
    segments
}

fn latin_phrase_segments(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut words = Vec::new();
    let mut letters = 0;
    for word in text.split_whitespace() {
        words.push(word);
        letters += word.chars().filter(|value| value.is_alphanumeric()).count();
        if letters >= 9
            || words.len() >= 3
            || word.chars().last().is_some_and(is_sentence_punctuation)
        {
            segments.push(words.join(" "));
            words.clear();
            letters = 0;
        }
    }
    if !words.is_empty() {
        let tail = words.join(" ");
        if tail.chars().filter(|value| value.is_alphanumeric()).count() <= 4 && !segments.is_empty()
        {
            let last = segments.last_mut().expect("a previous segment exists");
            last.push(' ');
            last.push_str(&tail);
        } else {
            segments.push(tail);
        }
    }
    if segments.is_empty() {
        segments.push(text.to_owned());
    }
    segments
}

fn push_segment(segments: &mut Vec<String>, current: &mut String) {
    let value = current.trim();
    if !value.is_empty() {
        segments.push(value.to_owned());
    }
    current.clear();
}

fn is_sentence_punctuation(value: char) -> bool {
    matches!(
        value,
        ',' | '.' | ';' | ':' | '!' | '?' | '，' | '。' | '；' | '：' | '！' | '？' | '、'
    )
}

fn validate_plan_input(options: &MotionTextPlanOptions) -> Vec<MotionTextPlanDiagnostic> {
    let mut diagnostics = Vec::new();
    if options.sequence.duration <= 0 {
        diagnostics.push(error(
            "invalid-sequence-duration",
            "Motion-text sequence duration must be positive.",
            None,
        ));
    }
    if options.sequence.engine.tokenizer_version != MOTION_TEXT_TOKENIZER_VERSION {
        diagnostics.push(error(
            "unsupported-tokenizer-version",
            "The motion-text tokenizer version is not supported.",
            None,
        ));
    }
    let mut ids = BTreeSet::new();
    let mut spans = Vec::new();
    for cue in &options.sequence.cues {
        if cue.id.is_empty() || !ids.insert(cue.id.as_str()) {
            diagnostics.push(error(
                "invalid-cue-id",
                "Motion-text cue IDs must be non-empty and unique.",
                Some(&cue.id),
            ));
        }
        let end = cue.start_time.saturating_add(cue.duration);
        if cue.start_time < 0
            || cue.duration <= 0
            || end > options.sequence.duration
            || end <= cue.start_time
        {
            diagnostics.push(error(
                "invalid-cue-range",
                "Motion-text cue time is outside the sequence range.",
                Some(&cue.id),
            ));
        }
        spans.push((cue.start_time, end, cue.id.as_str()));
        if !cue.cut_durations.is_empty() {
            let expected_cut_count = if cue.interlude {
                1
            } else {
                tokenize_motion_text(TokenizeMotionTextOptions {
                    text: cue.text.clone(),
                    language: options.sequence.language.clone(),
                    explicit_segments: cue.segments.clone(),
                })
                .segments
                .len()
            };
            let total = cue
                .cut_durations
                .iter()
                .try_fold(0_i64, |sum, duration| sum.checked_add(*duration));
            if cue.cut_durations.len() != expected_cut_count
                || cue.cut_durations.iter().any(|duration| *duration <= 0)
                || total != Some(cue.duration)
            {
                diagnostics.push(error(
                    "invalid-cut-durations",
                    "Custom cut durations must contain one positive duration per cut and exactly partition the cue.",
                    Some(&cue.id),
                ));
            }
        }
    }
    spans.sort_by_key(|value| (value.0, value.1));
    for pair in spans.windows(2) {
        if pair[1].0 < pair[0].1 {
            diagnostics.push(error(
                "overlapping-cues",
                "Motion-text cue ranges must not overlap.",
                Some(pair[1].2),
            ));
        }
    }
    let mut catalog_ids = BTreeSet::new();
    for choice in &options.catalog.choices {
        if choice.id.is_empty() || !choice.weight.is_finite() || choice.weight <= 0.0 {
            diagnostics.push(error(
                "invalid-preset-weight",
                "Preset choices require a non-empty ID and a finite positive weight.",
                None,
            ));
        }
        if !catalog_ids.insert((choice.group, choice.id.as_str())) {
            diagnostics.push(error(
                "duplicate-preset-choice",
                "Preset catalog group and ID pairs must be unique.",
                None,
            ));
        }
        if choice
            .min_chars
            .zip(choice.max_chars)
            .is_some_and(|(min, max)| min > max)
            || choice.min_duration.is_some_and(|duration| duration <= 0)
            || choice.max_duration.is_some_and(|duration| duration <= 0)
            || choice
                .min_duration
                .zip(choice.max_duration)
                .is_some_and(|(min, max)| min > max)
        {
            diagnostics.push(error(
                "invalid-preset-constraint",
                "Preset character and duration constraints must describe a valid range.",
                None,
            ));
        }
    }
    if let Some(renderer_support) = &options.renderer_support {
        let mut support_ids = BTreeSet::new();
        for supported in renderer_support {
            if supported.id.is_empty() {
                diagnostics.push(error(
                    "invalid-renderer-support",
                    "Renderer preset support IDs must be non-empty.",
                    None,
                ));
            }
            if !support_ids.insert((supported.group, supported.id.as_str())) {
                diagnostics.push(error(
                    "duplicate-renderer-support",
                    "Renderer preset support group and ID pairs must be unique.",
                    None,
                ));
            }
        }
    }
    diagnostics
}

fn partition_duration(duration: i64, weights: &[i64]) -> Vec<i64> {
    let total: i64 = weights.iter().sum();
    let mut boundaries = Vec::with_capacity(weights.len() + 1);
    boundaries.push(0);
    let mut accumulated = 0_i64;
    for weight in weights.iter().take(weights.len().saturating_sub(1)) {
        accumulated = accumulated.saturating_add(*weight);
        let boundary = ((i128::from(duration) * i128::from(accumulated)) / i128::from(total))
            .clamp(1, i128::from(duration - 1)) as i64;
        boundaries.push(boundary);
    }
    boundaries.push(duration);
    for index in 1..boundaries.len().saturating_sub(1) {
        boundaries[index] = boundaries[index]
            .max(boundaries[index - 1] + 1)
            .min(duration - i64::try_from(weights.len() - index).unwrap_or(i64::MAX));
    }
    boundaries
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect()
}

fn existing_cuts_by_cue(
    plan: Option<&MotionTextPlan>,
) -> BTreeMap<&str, Vec<MotionTextResolvedCut>> {
    let mut result = BTreeMap::<&str, Vec<MotionTextResolvedCut>>::new();
    if let Some(plan) = plan {
        for cut in &plan.cuts {
            result
                .entry(cut.cue_id.as_str())
                .or_default()
                .push(cut.clone());
        }
    }
    result
}

#[derive(Clone, Copy)]
struct PresetChoiceContext {
    character_count: u32,
    duration: i64,
    has_adjacent_previous: bool,
}

fn apply_randomized_presets(
    preset: &mut MotionTextPresetSelection,
    catalog: &MotionTextPlannerCatalog,
    renderer_support: Option<&[MotionTextRendererPresetSupport]>,
    planning_controls: &MotionTextPlanningControls,
    groups: &BTreeSet<MotionTextPresetGroup>,
    seed: u32,
    context: PresetChoiceContext,
) {
    for group in groups {
        let mut choices: Vec<&MotionTextPresetChoice> = catalog
            .choices
            .iter()
            .filter(|choice| {
                choice.group == *group
                    && choice_supports(choice, context)
                    && preset_set_enabled(choice.preset_set, planning_controls.preset_sets)
                    && renderer_supports(renderer_support, choice.group, &choice.id)
            })
            .collect();
        choices.sort_by(|left, right| left.id.cmp(&right.id));
        if *group == MotionTextPresetGroup::Trans && !context.has_adjacent_previous {
            preset.trans = None;
        } else if let Some(id) = weighted_choice(&choices, seed, *group) {
            set_preset_group(preset, *group, Some(id));
        }
    }
}

fn preset_set_enabled(
    preset_set: Option<MotionTextPresetSet>,
    controls: MotionTextPresetSetControls,
) -> bool {
    match preset_set {
        None => true,
        Some(MotionTextPresetSet::Horror) => controls.horror,
        Some(MotionTextPresetSet::Typo) => controls.typo,
        Some(MotionTextPresetSet::Kinetic) => controls.kinetic,
    }
}

fn renderer_supports(
    renderer_support: Option<&[MotionTextRendererPresetSupport]>,
    group: MotionTextPresetGroup,
    id: &str,
) -> bool {
    renderer_support.is_none_or(|supported| {
        supported
            .iter()
            .any(|entry| entry.group == group && entry.id == id)
    })
}

fn validate_resolved_renderer_support(
    cuts: &[MotionTextResolvedCut],
    renderer_support: Option<&[MotionTextRendererPresetSupport]>,
) -> Vec<MotionTextPlanDiagnostic> {
    let Some(renderer_support) = renderer_support else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();
    let mut seen = BTreeSet::new();
    for cut in cuts {
        for (group, id) in preset_entries(&cut.preset) {
            if renderer_supports(Some(renderer_support), group, id)
                || !seen.insert((cut.cue_id.as_str(), group, id))
            {
                continue;
            }
            diagnostics.push(error(
                "unsupported-renderer-preset",
                &format!(
                    "The active renderer does not support motion-text preset {}:{}.",
                    group.key(),
                    id
                ),
                Some(&cut.cue_id),
            ));
        }
    }
    diagnostics
}

fn preset_entries(preset: &MotionTextPresetSelection) -> Vec<(MotionTextPresetGroup, &str)> {
    let mut entries = vec![
        (MotionTextPresetGroup::Style, preset.style.as_str()),
        (MotionTextPresetGroup::Layout, preset.layout.as_str()),
        (MotionTextPresetGroup::Enter, preset.enter.as_str()),
        (MotionTextPresetGroup::Hold, preset.hold.as_str()),
        (MotionTextPresetGroup::Exit, preset.exit.as_str()),
        (MotionTextPresetGroup::Treat, preset.treat.as_str()),
        (MotionTextPresetGroup::Bg, preset.bg.as_str()),
        (MotionTextPresetGroup::Cam, preset.cam.as_str()),
    ];
    entries.extend(
        preset
            .decor
            .iter()
            .map(|id| (MotionTextPresetGroup::Decor, id.as_str())),
    );
    entries.extend(
        preset
            .fx
            .iter()
            .map(|id| (MotionTextPresetGroup::Fx, id.as_str())),
    );
    if let Some(id) = preset.trans.as_deref() {
        entries.push((MotionTextPresetGroup::Trans, id));
    }
    entries
}

fn choice_supports(choice: &MotionTextPresetChoice, context: PresetChoiceContext) -> bool {
    choice
        .min_chars
        .is_none_or(|value| context.character_count >= value)
        && choice
            .max_chars
            .is_none_or(|value| context.character_count <= value)
        && choice
            .min_duration
            .is_none_or(|value| context.duration >= value)
        && choice
            .max_duration
            .is_none_or(|value| context.duration <= value)
}

fn weighted_choice<'a>(
    choices: &[&'a MotionTextPresetChoice],
    seed: u32,
    group: MotionTextPresetGroup,
) -> Option<&'a str> {
    let total: f64 = choices.iter().map(|choice| choice.weight).sum();
    if total <= 0.0 || !total.is_finite() {
        return None;
    }
    let random = f64::from(hash_u32(&[
        u64::from(seed),
        stable_hash(group.key()),
        0x9e37_79b9,
    ])) / f64::from(u32::MAX);
    let mut target = random * total;
    for choice in choices {
        if target < choice.weight {
            return Some(&choice.id);
        }
        target -= choice.weight;
    }
    choices.last().map(|choice| choice.id.as_str())
}

fn set_preset_group(
    preset: &mut MotionTextPresetSelection,
    group: MotionTextPresetGroup,
    value: Option<&str>,
) {
    match group {
        MotionTextPresetGroup::Style => preset.style = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Layout => preset.layout = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Enter => preset.enter = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Hold => preset.hold = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Exit => preset.exit = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Decor => {
            preset.decor = value
                .map(|entry| vec![entry.to_owned()])
                .unwrap_or_default();
        }
        MotionTextPresetGroup::Treat => preset.treat = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Bg => preset.bg = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Cam => preset.cam = value.unwrap_or_default().to_owned(),
        MotionTextPresetGroup::Fx => {
            preset.fx = value
                .map(|entry| vec![entry.to_owned()])
                .unwrap_or_default();
        }
        MotionTextPresetGroup::Trans => preset.trans = value.map(str::to_owned),
    }
}

fn preset_group<'a>(
    preset: &'a MotionTextPresetSelection,
    group: MotionTextPresetGroup,
) -> Option<&'a str> {
    match group {
        MotionTextPresetGroup::Style => Some(&preset.style),
        MotionTextPresetGroup::Layout => Some(&preset.layout),
        MotionTextPresetGroup::Enter => Some(&preset.enter),
        MotionTextPresetGroup::Hold => Some(&preset.hold),
        MotionTextPresetGroup::Exit => Some(&preset.exit),
        MotionTextPresetGroup::Decor => preset.decor.first().map(String::as_str),
        MotionTextPresetGroup::Treat => Some(&preset.treat),
        MotionTextPresetGroup::Bg => Some(&preset.bg),
        MotionTextPresetGroup::Cam => Some(&preset.cam),
        MotionTextPresetGroup::Fx => preset.fx.first().map(String::as_str),
        MotionTextPresetGroup::Trans => preset.trans.as_deref(),
    }
}

fn apply_preset_override(
    preset: &mut MotionTextPresetSelection,
    value: Option<&MotionTextPresetOverride>,
) {
    let Some(value) = value else {
        return;
    };
    if let Some(entry) = &value.style {
        preset.style.clone_from(entry);
    }
    if let Some(entry) = &value.layout {
        preset.layout.clone_from(entry);
    }
    if let Some(entry) = &value.enter {
        preset.enter.clone_from(entry);
    }
    if let Some(entry) = &value.hold {
        preset.hold.clone_from(entry);
    }
    if let Some(entry) = &value.exit {
        preset.exit.clone_from(entry);
    }
    if let Some(entry) = &value.decor {
        preset.decor.clone_from(entry);
    }
    if let Some(entry) = &value.treat {
        preset.treat.clone_from(entry);
    }
    if let Some(entry) = &value.bg {
        preset.bg.clone_from(entry);
    }
    if let Some(entry) = &value.cam {
        preset.cam.clone_from(entry);
    }
    if let Some(entry) = &value.fx {
        preset.fx.clone_from(entry);
    }
    if let Some(entry) = &value.trans {
        preset.trans.clone_from(entry);
    }
}

fn apply_preset_locks(
    preset: &mut MotionTextPresetSelection,
    previous: Option<&MotionTextResolvedCut>,
    locks: &[MotionTextLockInput],
) {
    let Some(previous) = previous else {
        return;
    };
    let lock_all = locks
        .iter()
        .any(|lock| lock.scope == "cue" && (lock.key == "all" || lock.key == "preset"));
    if lock_all {
        preset.clone_from(&previous.preset);
        return;
    }
    for lock in locks.iter().filter(|lock| lock.scope == "preset-group") {
        let Some(group) = parse_group(&lock.key) else {
            continue;
        };
        set_preset_group(preset, group, preset_group(&previous.preset, group));
    }
}

fn apply_parameter_locks(
    parameters: &mut BTreeMap<String, MotionTextParameterValue>,
    previous: Option<&MotionTextResolvedCut>,
    locks: &[MotionTextLockInput],
) {
    let Some(previous) = previous else {
        return;
    };
    if locks
        .iter()
        .any(|lock| lock.scope == "cue" && (lock.key == "all" || lock.key == "parameters"))
    {
        parameters.clone_from(&previous.parameters);
        return;
    }
    for lock in locks.iter().filter(|lock| lock.scope == "parameter") {
        if let Some(value) = previous.parameters.get(&lock.key) {
            parameters.insert(lock.key.clone(), value.clone());
        }
    }
}

const UNIFIED_LOOK_GROUPS: &[(MotionTextPresetGroup, usize)] = &[
    (MotionTextPresetGroup::Layout, 3),
    (MotionTextPresetGroup::Enter, 2),
    (MotionTextPresetGroup::Exit, 2),
    (MotionTextPresetGroup::Hold, 1),
    (MotionTextPresetGroup::Cam, 2),
    (MotionTextPresetGroup::Decor, 2),
    (MotionTextPresetGroup::Treat, 1),
    (MotionTextPresetGroup::Trans, 2),
];

#[derive(Default)]
struct UnifiedLookState {
    section: u32,
    palettes: BTreeMap<(u32, MotionTextPresetGroup), Vec<String>>,
    last: BTreeMap<(u32, MotionTextPresetGroup), String>,
}

impl UnifiedLookState {
    fn start_section(&mut self) {
        self.section = self.section.saturating_add(1);
    }

    #[allow(clippy::too_many_arguments)]
    fn apply(
        &mut self,
        preset: &mut MotionTextPresetSelection,
        catalog: &MotionTextPlannerCatalog,
        renderer_support: Option<&[MotionTextRendererPresetSupport]>,
        planning_controls: &MotionTextPlanningControls,
        randomized_groups: &BTreeSet<MotionTextPresetGroup>,
        seed: u32,
        context: PresetChoiceContext,
        impact: bool,
    ) {
        for &(group, capacity) in UNIFIED_LOOK_GROUPS {
            if !randomized_groups.contains(&group) {
                continue;
            }
            let Some(mut selected) = preset_group(preset, group).map(str::to_owned) else {
                continue;
            };
            if impact {
                let candidates: Vec<_> = kime_candidates(group)
                    .iter()
                    .copied()
                    .filter(|id| {
                        choice_is_available(
                            catalog,
                            renderer_support,
                            planning_controls,
                            group,
                            id,
                            context,
                        )
                    })
                    .collect();
                if !candidates.is_empty() {
                    let index = usize::try_from(hash_u32(&[
                        u64::from(seed),
                        stable_hash(group.key()),
                        0x4b49_4d45,
                    ]))
                    .unwrap_or_default()
                        % candidates.len();
                    selected = candidates[index].to_owned();
                }
            }
            if let Some(alternated) = self.alternated(group, &selected).filter(|id| {
                choice_is_available(
                    catalog,
                    renderer_support,
                    planning_controls,
                    group,
                    id,
                    context,
                )
            }) {
                selected = alternated.to_owned();
            }

            let palette = self.palettes.entry((self.section, group)).or_default();
            if !palette.contains(&selected) {
                if palette.len() < capacity {
                    palette.push(selected.clone());
                } else {
                    let available: Vec<_> = palette
                        .iter()
                        .filter(|id| {
                            choice_is_available(
                                catalog,
                                renderer_support,
                                planning_controls,
                                group,
                                id,
                                context,
                            )
                        })
                        .collect();
                    if !available.is_empty() {
                        let index = usize::try_from(hash_u32(&[
                            u64::from(seed),
                            stable_hash(group.key()),
                            u64::from(self.section),
                        ]))
                        .unwrap_or_default()
                            % available.len();
                        selected.clone_from(available[index]);
                    }
                }
            }
            set_preset_group(preset, group, Some(&selected));
            self.last.insert((self.section, group), selected);
        }
    }

    fn alternated<'a>(&self, group: MotionTextPresetGroup, selected: &'a str) -> Option<&'a str> {
        let previous = self.last.get(&(self.section, group))?;
        for pair in direction_pairs(group) {
            if pair.contains(&selected) && pair.contains(&previous.as_str()) {
                return Some(if previous == pair[0] {
                    pair[1]
                } else {
                    pair[0]
                });
            }
        }
        None
    }

    fn remember(&mut self, preset: &MotionTextPresetSelection) {
        for &(group, capacity) in UNIFIED_LOOK_GROUPS {
            let Some(id) = preset_group(preset, group) else {
                continue;
            };
            let palette = self.palettes.entry((self.section, group)).or_default();
            if palette.len() < capacity && !palette.iter().any(|candidate| candidate == id) {
                palette.push(id.to_owned());
            }
            self.last.insert((self.section, group), id.to_owned());
        }
    }
}

fn choice_is_available(
    catalog: &MotionTextPlannerCatalog,
    renderer_support: Option<&[MotionTextRendererPresetSupport]>,
    planning_controls: &MotionTextPlanningControls,
    group: MotionTextPresetGroup,
    id: &str,
    context: PresetChoiceContext,
) -> bool {
    catalog.choices.iter().any(|choice| {
        choice.group == group
            && choice.id == id
            && choice_supports(choice, context)
            && preset_set_enabled(choice.preset_set, planning_controls.preset_sets)
            && renderer_supports(renderer_support, group, id)
    })
}

fn direction_pairs(group: MotionTextPresetGroup) -> &'static [[&'static str; 2]] {
    match group {
        MotionTextPresetGroup::Enter => &[
            ["slideL", "slideR"],
            ["riseMask", "dropMask"],
            ["trackIn", "trackOut"],
            ["flipX", "flipY"],
        ],
        MotionTextPresetGroup::Exit => &[
            ["slideOutL", "slideOutR"],
            ["sinkMask", "riseOut"],
            ["flipOutX", "flipOutY"],
        ],
        MotionTextPresetGroup::Cam => &[
            ["panL", "panR"],
            ["tiltUp", "tiltDown"],
            ["dollyIn", "pullOut"],
        ],
        _ => &[],
    }
}

fn kime_candidates(group: MotionTextPresetGroup) -> &'static [&'static str] {
    match group {
        MotionTextPresetGroup::Layout => &["huge", "columnsBig", "halftoneBig", "center"],
        MotionTextPresetGroup::Enter => &[
            "stamp",
            "zoom",
            "bounceBig",
            "overexpose",
            "slingshot",
            "blur",
        ],
        MotionTextPresetGroup::Exit => &["zoomThrough", "blur", "shrink", "zoomFar"],
        MotionTextPresetGroup::Hold => &["still", "pulse", "heartbeat"],
        MotionTextPresetGroup::Cam => &["beatPunch", "crashZoom", "dollyIn", "push"],
        _ => &[],
    }
}

fn apply_center_free_parameters(
    parameters: &mut BTreeMap<String, MotionTextParameterValue>,
    text: &str,
    language: &str,
    duration: i64,
    controls: MotionTextPlanningControls,
) {
    if !controls.center_free || text.is_empty() {
        parameters.remove(CENTER_FREE_PARAMETER);
        return;
    }
    let [first_text, second_text] = split_center_text(text, language);
    let delay_ticks = duration.saturating_mul(8).saturating_div(100).min(14_400);
    parameters.insert(
        CENTER_FREE_PARAMETER.to_owned(),
        MotionTextParameterValue::Object(BTreeMap::from([
            (
                "direction".to_owned(),
                MotionTextParameterValue::String(controls.center_direction.key().to_owned()),
            ),
            (
                "enabled".to_owned(),
                MotionTextParameterValue::Boolean(true),
            ),
            (
                "firstText".to_owned(),
                MotionTextParameterValue::String(first_text),
            ),
            (
                "secondText".to_owned(),
                MotionTextParameterValue::String(second_text),
            ),
            (
                "delayTicks".to_owned(),
                MotionTextParameterValue::Number(delay_ticks as f64),
            ),
        ])),
    );
}

fn split_center_text(text: &str, language: &str) -> [String; 2] {
    let trimmed = text.trim();
    let compact_count = trimmed
        .chars()
        .filter(|character| !character.is_whitespace())
        .count();
    let english_word = trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "'-’".contains(character));
    if compact_count <= 3 || english_word {
        return [trimmed.to_owned(), trimmed.to_owned()];
    }
    if language.to_ascii_lowercase().starts_with("en") {
        let words: Vec<_> = trimmed.split_whitespace().collect();
        if words.len() >= 2 {
            let total: usize = words.iter().map(|word| word.chars().count()).sum();
            let mut accumulated = 0;
            let mut best_index = 1;
            let mut best_distance = usize::MAX;
            for index in 1..words.len() {
                accumulated += words[index - 1].chars().count();
                let distance = accumulated.abs_diff(total / 2);
                if distance < best_distance {
                    best_distance = distance;
                    best_index = index;
                }
            }
            return [words[..best_index].join(" "), words[best_index..].join(" ")];
        }
    }
    let characters: Vec<_> = trimmed.chars().collect();
    let mut split = characters.len().div_ceil(2);
    while split < characters.len().saturating_sub(1) && bad_center_half_start(characters[split]) {
        split += 1;
    }
    [
        characters[..split].iter().collect(),
        characters[split..].iter().collect(),
    ]
}

fn bad_center_half_start(character: char) -> bool {
    matches!(
        character,
        '、' | '。'
            | '，'
            | '．'
            | ','
            | '.'
            | '!'
            | '?'
            | '！'
            | '？'
            | '…'
            | '・'
            | 'ー'
            | 'っ'
            | 'ッ'
            | 'ゃ'
            | 'ゅ'
            | 'ょ'
            | 'ャ'
            | 'ュ'
            | 'ョ'
            | 'ぁ'
            | 'ぃ'
            | 'ぅ'
            | 'ぇ'
            | 'ぉ'
            | 'ァ'
            | 'ィ'
            | 'ゥ'
            | 'ェ'
            | 'ォ'
            | 'を'
            | 'が'
            | 'は'
            | 'に'
            | 'で'
            | 'と'
            | 'の'
            | 'へ'
            | 'も'
            | 'や'
            | 'よ'
            | 'ね'
            | '」'
            | '』'
            | '）'
            | ')'
    )
}

fn normalize_repeat_text(text: &str) -> String {
    text.chars()
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '、' | '。'
                        | '，'
                        | '．'
                        | ','
                        | '.'
                        | '!'
                        | '！'
                        | '?'
                        | '？'
                        | '…'
                        | '・'
                        | '「'
                        | '」'
                        | '『'
                        | '』'
                        | '（'
                        | '）'
                        | '('
                        | ')'
                        | '"'
                        | '\''
                        | '“'
                        | '”'
                        | '‘'
                        | '’'
                        | '~'
                        | '〜'
                        | 'ー'
                        | '―'
                        | '-'
                )
        })
        .collect()
}

fn parse_group(value: &str) -> Option<MotionTextPresetGroup> {
    match value {
        "style" => Some(MotionTextPresetGroup::Style),
        "layout" => Some(MotionTextPresetGroup::Layout),
        "enter" => Some(MotionTextPresetGroup::Enter),
        "hold" => Some(MotionTextPresetGroup::Hold),
        "exit" => Some(MotionTextPresetGroup::Exit),
        "decor" => Some(MotionTextPresetGroup::Decor),
        "treat" => Some(MotionTextPresetGroup::Treat),
        "bg" => Some(MotionTextPresetGroup::Bg),
        "cam" => Some(MotionTextPresetGroup::Cam),
        "fx" => Some(MotionTextPresetGroup::Fx),
        "trans" => Some(MotionTextPresetGroup::Trans),
        _ => None,
    }
}

fn error(code: &str, message: &str, cue_id: Option<&str>) -> MotionTextPlanDiagnostic {
    MotionTextPlanDiagnostic {
        severity: MotionTextPlanDiagnosticSeverity::Error,
        code: code.to_owned(),
        message: message.to_owned(),
        cue_id: cue_id.map(str::to_owned),
    }
}

fn warning(code: &str, message: &str, cue_id: Option<&str>) -> MotionTextPlanDiagnostic {
    MotionTextPlanDiagnostic {
        severity: MotionTextPlanDiagnosticSeverity::Warning,
        code: code.to_owned(),
        message: message.to_owned(),
        cue_id: cue_id.map(str::to_owned),
    }
}

fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{:016x}", stable_hash(value))
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in value.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn hash_u32(values: &[u64]) -> u32 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for value in values {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    let mixed = hash ^ (hash >> 32);
    mixed as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset() -> MotionTextPresetSelection {
        MotionTextPresetSelection {
            style: "base".to_owned(),
            layout: "center".to_owned(),
            enter: "fade".to_owned(),
            hold: "still".to_owned(),
            exit: "fade".to_owned(),
            decor: Vec::new(),
            treat: "none".to_owned(),
            bg: "transparent".to_owned(),
            cam: "static".to_owned(),
            fx: Vec::new(),
            trans: None,
        }
    }

    fn renderer_support(
        preset: &MotionTextPresetSelection,
    ) -> Vec<MotionTextRendererPresetSupport> {
        preset_entries(preset)
            .into_iter()
            .map(|(group, id)| MotionTextRendererPresetSupport {
                group,
                id: id.to_owned(),
            })
            .collect()
    }

    fn options() -> MotionTextPlanOptions {
        MotionTextPlanOptions {
            sequence: MotionTextSequenceInput {
                id: "sequence:title".to_owned(),
                revision: 1,
                duration: 360_000,
                seed: 7,
                language: "en".to_owned(),
                planning_controls: MotionTextPlanningControls::default(),
                engine: MotionTextEngineInput {
                    tokenizer_version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
                },
                defaults: MotionTextDefaultsInput {
                    preset: preset(),
                    font_id: None,
                    parameters: BTreeMap::from([(
                        "density".to_owned(),
                        MotionTextParameterValue::Number(0.5),
                    )]),
                },
                cues: vec![
                    MotionTextCueInput {
                        id: "cue:one".to_owned(),
                        text: "hello vivid world".to_owned(),
                        start_time: 0,
                        duration: 120_000,
                        interlude: false,
                        gap_before: false,
                        impact: false,
                        segments: Vec::new(),
                        cut_durations: Vec::new(),
                        locks: Vec::new(),
                        overrides: MotionTextOverridesInput::default(),
                    },
                    MotionTextCueInput {
                        id: "cue:two".to_owned(),
                        text: "second line".to_owned(),
                        start_time: 120_000,
                        duration: 120_000,
                        interlude: false,
                        gap_before: false,
                        impact: false,
                        segments: Vec::new(),
                        cut_durations: Vec::new(),
                        locks: Vec::new(),
                        overrides: MotionTextOverridesInput::default(),
                    },
                ],
                resolved_plan: None,
            },
            catalog: MotionTextPlannerCatalog {
                choices: vec![
                    MotionTextPresetChoice {
                        group: MotionTextPresetGroup::Layout,
                        id: "center".to_owned(),
                        weight: 1.0,
                        preset_set: None,
                        min_chars: None,
                        max_chars: None,
                        min_duration: None,
                        max_duration: None,
                    },
                    MotionTextPresetChoice {
                        group: MotionTextPresetGroup::Layout,
                        id: "stack".to_owned(),
                        weight: 1.0,
                        preset_set: None,
                        min_chars: None,
                        max_chars: None,
                        min_duration: None,
                        max_duration: None,
                    },
                ],
            },
            renderer_support: None,
            randomize_groups: vec![MotionTextPresetGroup::Layout],
            variation: None,
        }
    }

    #[test]
    fn plans_deterministically_with_positive_partitioned_durations() {
        let first = plan_motion_text_sequence(options());
        let second = plan_motion_text_sequence(options());
        assert_eq!(first, second);
        let plan = first.plan.expect("plan is valid");
        assert!(plan.cuts.iter().all(|cut| cut.duration > 0));
        assert_eq!(
            plan.cuts
                .iter()
                .filter(|cut| cut.cue_id == "cue:one")
                .map(|cut| cut.duration)
                .sum::<i64>(),
            120_000
        );
    }

    #[test]
    fn custom_cut_durations_remain_authoritative_across_replanning() {
        let mut input = options();
        input.sequence.cues[0].segments =
            vec!["hello".to_owned(), "vivid".to_owned(), "world".to_owned()];
        input.sequence.cues[0].cut_durations = vec![20_000, 40_000, 60_000];
        let first = plan_motion_text_sequence(input.clone())
            .plan
            .expect("custom cut durations are valid");
        let first_cuts: Vec<_> = first
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .collect();
        assert_eq!(first_cuts[0].start_time, 0);
        assert_eq!(first_cuts[0].duration, 20_000);
        assert_eq!(first_cuts[1].start_time, 20_000);
        assert_eq!(first_cuts[1].duration, 40_000);
        assert_eq!(first_cuts[2].start_time, 60_000);
        assert_eq!(first_cuts[2].duration, 60_000);

        input.sequence.revision = 2;
        input.sequence.resolved_plan = Some(first);
        let replanned = plan_motion_text_sequence(input)
            .plan
            .expect("custom cut durations survive replanning");
        let replanned_durations: Vec<_> = replanned
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .map(|cut| cut.duration)
            .collect();
        assert_eq!(replanned_durations, vec![20_000, 40_000, 60_000]);
    }

    #[test]
    fn rejects_custom_cut_durations_that_do_not_partition_the_cue() {
        let mut input = options();
        input.sequence.cues[0].segments = vec!["hello".to_owned(), "world".to_owned()];
        input.sequence.cues[0].cut_durations = vec![60_000, 59_999];
        let result = plan_motion_text_sequence(input);
        assert!(result.plan.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "invalid-cut-durations")
        );
    }

    #[test]
    fn rerolls_only_the_target_and_preserves_locked_groups() {
        let initial = plan_motion_text_sequence(options())
            .plan
            .expect("initial plan is valid");
        let untouched: Vec<_> = initial
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:two")
            .cloned()
            .collect();
        let mut varied = options();
        varied.sequence.resolved_plan = Some(initial.clone());
        varied.sequence.cues[0].locks.push(MotionTextLockInput {
            scope: "preset-group".to_owned(),
            key: "layout".to_owned(),
        });
        varied.variation = Some(MotionTextVariation {
            salt: 99,
            cue_ids: vec!["cue:one".to_owned()],
            groups: vec![MotionTextPresetGroup::Layout],
        });
        let next = plan_motion_text_sequence(varied)
            .plan
            .expect("varied plan is valid");
        assert_eq!(
            next.cuts
                .iter()
                .filter(|cut| cut.cue_id == "cue:two")
                .cloned()
                .collect::<Vec<_>>(),
            untouched
        );
        for (before, after) in initial
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .zip(next.cuts.iter().filter(|cut| cut.cue_id == "cue:one"))
        {
            assert_eq!(before.preset.layout, after.preset.layout);
        }
    }

    #[test]
    fn imports_weight_and_range_constraints_without_order_dependence() {
        let constrained = MotionTextPresetChoice {
            group: MotionTextPresetGroup::Layout,
            id: "long-copy-only".to_owned(),
            weight: 10_000.0,
            preset_set: None,
            min_chars: Some(100),
            max_chars: None,
            min_duration: None,
            max_duration: None,
        };
        let compatible = MotionTextPresetChoice {
            group: MotionTextPresetGroup::Layout,
            id: "short-copy".to_owned(),
            weight: 1.0,
            preset_set: None,
            min_chars: Some(1),
            max_chars: Some(20),
            min_duration: Some(1),
            max_duration: Some(120_000),
        };
        let mut forward = options();
        forward.catalog.choices = vec![constrained.clone(), compatible.clone()];
        let mut reverse = options();
        reverse.catalog.choices = vec![compatible, constrained];
        let forward = plan_motion_text_sequence(forward)
            .plan
            .expect("constrained plan is valid");
        let reverse = plan_motion_text_sequence(reverse)
            .plan
            .expect("reordered constrained plan is valid");
        assert_eq!(forward, reverse);
        assert!(
            forward
                .cuts
                .iter()
                .all(|cut| cut.preset.layout == "short-copy")
        );
    }

    #[test]
    fn randomization_excludes_presets_unsupported_by_the_renderer() {
        let mut input = options();
        input.catalog.choices.push(MotionTextPresetChoice {
            group: MotionTextPresetGroup::Layout,
            id: "unsupported-layout".to_owned(),
            weight: 1_000_000.0,
            preset_set: None,
            min_chars: None,
            max_chars: None,
            min_duration: None,
            max_duration: None,
        });
        input.renderer_support = Some(renderer_support(&input.sequence.defaults.preset));

        let plan = plan_motion_text_sequence(input)
            .plan
            .expect("the supported preset pool is valid");

        assert!(plan.cuts.iter().all(|cut| cut.preset.layout == "center"));
    }

    #[test]
    fn rejects_an_explicit_preset_unsupported_by_the_renderer() {
        let mut input = options();
        input.randomize_groups.clear();
        input.renderer_support = Some(renderer_support(&input.sequence.defaults.preset));
        input.sequence.defaults.preset.layout = "imported-layout".to_owned();

        let result = plan_motion_text_sequence(input);

        assert!(result.plan.is_none());
        assert!(result.diagnostics.iter().any(|entry| {
            entry.code == "unsupported-renderer-preset"
                && entry.message.contains("layout:imported-layout")
        }));
    }

    #[test]
    fn rejects_an_unsupported_preset_restored_by_a_lock() {
        let mut input = options();
        input.randomize_groups.clear();
        let mut imported = plan_motion_text_sequence(input.clone())
            .plan
            .expect("the initial plan is valid");
        for cut in imported
            .cuts
            .iter_mut()
            .filter(|cut| cut.cue_id == "cue:one")
        {
            cut.preset.layout = "locked-layout".to_owned();
        }
        input.sequence.resolved_plan = Some(imported);
        input.sequence.cues[0].locks.push(MotionTextLockInput {
            scope: "preset-group".to_owned(),
            key: "layout".to_owned(),
        });
        input.renderer_support = Some(renderer_support(&input.sequence.defaults.preset));
        input.variation = Some(MotionTextVariation {
            salt: 1,
            cue_ids: vec!["cue:one".to_owned()],
            groups: vec![MotionTextPresetGroup::Layout],
        });

        let result = plan_motion_text_sequence(input);

        assert!(result.plan.is_none());
        assert!(result.diagnostics.iter().any(|entry| {
            entry.code == "unsupported-renderer-preset"
                && entry.message.contains("layout:locked-layout")
        }));
    }

    #[test]
    fn transitions_require_an_adjacent_previous_cut() {
        let mut input = options();
        input.sequence.defaults.preset.trans = Some("wipe".to_owned());
        let plan = plan_motion_text_sequence(input)
            .plan
            .expect("transition plan is valid");
        assert_eq!(
            plan.cuts
                .first()
                .and_then(|cut| cut.preset.trans.as_deref()),
            None
        );
        assert!(
            plan.cuts
                .iter()
                .skip(1)
                .all(|cut| cut.preset.trans.as_deref() == Some("wipe"))
        );
    }

    #[test]
    fn preset_set_switches_filter_random_choices_from_authoritative_metadata() {
        let choices = [
            ("center", None),
            ("tyOnly", Some(MotionTextPresetSet::Typo)),
            ("knOnly", Some(MotionTextPresetSet::Kinetic)),
            ("hrOnly", Some(MotionTextPresetSet::Horror)),
        ]
        .into_iter()
        .map(|(id, preset_set)| MotionTextPresetChoice {
            group: MotionTextPresetGroup::Layout,
            id: id.to_owned(),
            weight: if preset_set.is_some() {
                1_000_000.0
            } else {
                1.0
            },
            preset_set,
            min_chars: None,
            max_chars: None,
            min_duration: None,
            max_duration: None,
        })
        .collect();
        let mut input = options();
        input.catalog = MotionTextPlannerCatalog { choices };
        input.sequence.planning_controls.preset_sets = MotionTextPresetSetControls {
            horror: false,
            typo: false,
            kinetic: false,
        };
        let core_only = plan_motion_text_sequence(input.clone())
            .plan
            .expect("the core-only plan is valid");
        assert!(
            core_only
                .cuts
                .iter()
                .all(|cut| cut.preset.layout == "center")
        );

        input.sequence.planning_controls.preset_sets.typo = true;
        let typography = plan_motion_text_sequence(input)
            .plan
            .expect("the typography plan is valid");
        assert!(
            typography
                .cuts
                .iter()
                .all(|cut| cut.preset.layout != "knOnly" && cut.preset.layout != "hrOnly")
        );
        assert!(
            typography
                .cuts
                .iter()
                .any(|cut| cut.preset.layout == "tyOnly")
        );
    }

    #[test]
    fn unified_look_reuses_repeated_line_visuals_and_stable_seeds() {
        let mut input = options();
        input.sequence.cues[1].text = input.sequence.cues[0].text.clone();
        input.sequence.planning_controls.unify = true;
        input.catalog.choices.extend([
            MotionTextPresetChoice {
                group: MotionTextPresetGroup::Enter,
                id: "slideL".to_owned(),
                weight: 1.0,
                preset_set: None,
                min_chars: None,
                max_chars: None,
                min_duration: None,
                max_duration: None,
            },
            MotionTextPresetChoice {
                group: MotionTextPresetGroup::Enter,
                id: "slideR".to_owned(),
                weight: 1.0,
                preset_set: None,
                min_chars: None,
                max_chars: None,
                min_duration: None,
                max_duration: None,
            },
        ]);
        input.randomize_groups.push(MotionTextPresetGroup::Enter);

        let plan = plan_motion_text_sequence(input)
            .plan
            .expect("the unified plan is valid");
        let first: Vec<_> = plan
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .collect();
        let repeated: Vec<_> = plan
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:two")
            .collect();
        assert_eq!(first.len(), repeated.len());
        for (original, again) in first.into_iter().zip(repeated) {
            assert_eq!(original.text, again.text);
            assert_eq!(original.seed, again.seed);
            assert_eq!(original.preset, again.preset);
            assert_eq!(original.parameters, again.parameters);
        }
    }

    #[test]
    fn center_free_planning_splits_text_and_full_locks_preserve_the_snapshot() {
        let mut input = options();
        input.sequence.planning_controls.center_free = true;
        input.sequence.planning_controls.center_direction = MotionTextCenterDirection::LeftRight;
        let initial = plan_motion_text_sequence(input.clone())
            .plan
            .expect("the center-free plan is valid");
        let first = initial.cuts.first().expect("the first cut exists");
        let MotionTextParameterValue::Object(center_free) = first
            .parameters
            .get(CENTER_FREE_PARAMETER)
            .expect("center-free parameters are planned")
        else {
            panic!("center-free parameters must be an object");
        };
        assert_eq!(
            center_free.get("direction"),
            Some(&MotionTextParameterValue::String("lr".to_owned()))
        );
        assert_eq!(
            center_free.get("firstText"),
            Some(&MotionTextParameterValue::String("hello".to_owned()))
        );
        assert_eq!(
            center_free.get("secondText"),
            Some(&MotionTextParameterValue::String("vivid".to_owned()))
        );

        input.sequence.resolved_plan = Some(initial.clone());
        input.sequence.planning_controls.center_free = false;
        input.sequence.cues[0].locks.push(MotionTextLockInput {
            scope: "cue".to_owned(),
            key: "all".to_owned(),
        });
        let replanned = plan_motion_text_sequence(input)
            .plan
            .expect("the locked replan is valid");
        assert!(
            replanned
                .cuts
                .iter()
                .filter(|cut| cut.cue_id == "cue:one")
                .all(|cut| cut.parameters.contains_key(CENTER_FREE_PARAMETER))
        );
        assert!(
            replanned
                .cuts
                .iter()
                .filter(|cut| cut.cue_id == "cue:two")
                .all(|cut| !cut.parameters.contains_key(CENTER_FREE_PARAMETER))
        );
    }

    #[test]
    fn a_full_cue_lock_keeps_the_visual_snapshot() {
        let initial = plan_motion_text_sequence(options())
            .plan
            .expect("initial plan is valid");
        let mut varied = options();
        varied.sequence.resolved_plan = Some(initial.clone());
        varied.sequence.defaults.font_id = Some("replacement-font".to_owned());
        varied.sequence.cues[0].locks.push(MotionTextLockInput {
            scope: "cue".to_owned(),
            key: "all".to_owned(),
        });
        varied.variation = Some(MotionTextVariation {
            salt: 4_242,
            cue_ids: vec!["cue:one".to_owned()],
            groups: vec![MotionTextPresetGroup::Layout],
        });
        let next = plan_motion_text_sequence(varied)
            .plan
            .expect("locked plan is valid");
        let before: Vec<_> = initial
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .collect();
        let after: Vec<_> = next
            .cuts
            .iter()
            .filter(|cut| cut.cue_id == "cue:one")
            .collect();
        assert_eq!(before, after);
    }

    #[test]
    fn rejects_overlaps_without_returning_a_partial_plan() {
        let mut invalid = options();
        invalid.sequence.cues[1].start_time = 100_000;
        let result = plan_motion_text_sequence(invalid);
        assert!(result.plan.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|entry| entry.code == "overlapping-cues")
        );
    }

    #[test]
    fn maps_half_open_clip_ranges_to_sequence_time() {
        assert_eq!(
            map_motion_text_clip_time(MapMotionTextClipTimeOptions {
                clip_start_time: 120_000,
                clip_duration: 240_000,
                trim_start: 60_000,
                timeline_time: 180_000,
                sequence_duration: 360_000,
            }),
            MotionTextClipTimeMapping {
                active: true,
                sequence_time: Some(120_000),
            }
        );
        assert!(
            !map_motion_text_clip_time(MapMotionTextClipTimeOptions {
                clip_start_time: 120_000,
                clip_duration: 240_000,
                trim_start: 60_000,
                timeline_time: 360_000,
                sequence_duration: 360_000,
            })
            .active
        );
    }

    #[test]
    fn maps_visible_sequence_time_back_to_the_trimmed_clip() {
        assert_eq!(
            map_motion_text_sequence_time_to_timeline(MapMotionTextSequenceTimeToTimelineOptions {
                clip_start_time: 120_000,
                clip_duration: 180_000,
                trim_start: 60_000,
                sequence_time: 120_000,
                sequence_duration: 360_000,
            }),
            MotionTextSequenceTimeMapping {
                active: true,
                timeline_time: Some(180_000),
            }
        );
    }

    #[test]
    fn sequence_to_timeline_mapping_uses_half_open_visible_ranges() {
        let map = |sequence_time| {
            map_motion_text_sequence_time_to_timeline(MapMotionTextSequenceTimeToTimelineOptions {
                clip_start_time: 120_000,
                clip_duration: 180_000,
                trim_start: 60_000,
                sequence_time,
                sequence_duration: 360_000,
            })
        };

        assert!(!map(59_999).active);
        assert_eq!(map(60_000).timeline_time, Some(120_000));
        assert_eq!(map(239_999).timeline_time, Some(299_999));
        assert!(!map(240_000).active);
        assert!(
            !map_motion_text_sequence_time_to_timeline(
                MapMotionTextSequenceTimeToTimelineOptions {
                    clip_start_time: 120_000,
                    clip_duration: 600_000,
                    trim_start: 60_000,
                    sequence_time: 360_000,
                    sequence_duration: 360_000,
                },
            )
            .active
        );
    }

    #[test]
    fn tokenizer_is_explicit_and_browser_independent() {
        assert_eq!(
            tokenize_motion_text(TokenizeMotionTextOptions {
                text: "ignored".to_owned(),
                language: "ja".to_owned(),
                explicit_segments: vec!["夜明け".to_owned(), "の色".to_owned()],
            }),
            TokenizedMotionText {
                version: MOTION_TEXT_TOKENIZER_VERSION.to_owned(),
                segments: vec!["夜明け".to_owned(), "の色".to_owned()],
                explicit: true,
            }
        );
        assert_eq!(
            tokenize_motion_text(TokenizeMotionTextOptions {
                text: "你好世界再次相见".to_owned(),
                language: "zh-Hans".to_owned(),
                explicit_segments: Vec::new(),
            })
            .segments,
            vec!["你好世界", "再次相见"]
        );
        assert_eq!(
            tokenize_motion_text(TokenizeMotionTextOptions {
                text: "새벽빛을 기억해".to_owned(),
                language: "ko".to_owned(),
                explicit_segments: Vec::new(),
            })
            .segments,
            vec!["새벽빛", "을", "기억해"]
        );
    }

    #[test]
    fn preset_transition_override_distinguishes_inherit_null_and_id() {
        let inherited: MotionTextPresetOverride =
            serde_json::from_value(serde_json::json!({})).expect("empty override is valid");
        let disabled: MotionTextPresetOverride = serde_json::from_value(serde_json::json!({
            "trans": null
        }))
        .expect("null transition override is valid");
        let selected: MotionTextPresetOverride = serde_json::from_value(serde_json::json!({
            "trans": "wipe"
        }))
        .expect("named transition override is valid");
        assert_eq!(inherited.trans, None);
        assert_eq!(disabled.trans, Some(None));
        assert_eq!(selected.trans, Some(Some("wipe".to_owned())));
    }
}
