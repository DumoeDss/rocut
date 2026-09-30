use std::collections::BTreeMap;
use std::sync::LazyLock;

use bridge::export;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[export]
pub const MOTION_TEXT_SCHEMA_VERSION: u32 = 1;

static METADATA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\[(ti|ar|al|by|offset):(.*)\]$").expect("metadata regex is valid")
});
static LRC_TIME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\[(\d+):(\d+(?:[.:]\d+)?)\]").expect("LRC time regex is valid"));
static INTERLUDE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^\[\s*(間奏|间奏|interlude|instrumental|inst|간주)(?:\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒|초)?)?\s*\]$",
    )
    .expect("interlude regex is valid")
});
static EMPHASIS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*([^*]+)\*").expect("emphasis regex is valid"));

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParseMotionTextSourceOptions {
    pub sequence_id: String,
    pub source: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMotionTextSource {
    pub schema_version: u32,
    pub metadata: Vec<MotionTextMetadata>,
    pub cues: Vec<MotionTextSourceCue>,
    pub diagnostics: Vec<MotionTextDiagnostic>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextMetadata {
    pub key: String,
    pub value: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextSourceCue {
    pub id: String,
    pub source_line: u32,
    pub text: String,
    pub start_ticks: Option<i64>,
    pub interlude: bool,
    pub interlude_duration_ticks: Option<i64>,
    pub note: Option<String>,
    pub impact: bool,
    pub emphasis: Vec<String>,
    pub manual_segments: Option<Vec<String>>,
    pub gap_before: bool,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MotionTextDiagnosticSeverity {
    Warning,
    Error,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextDiagnostic {
    pub severity: MotionTextDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub source_line: Option<u32>,
}

#[derive(Clone, Debug)]
struct PendingCue {
    source_line: u32,
    text: String,
    start_ticks: Option<i64>,
    interlude: bool,
    interlude_duration_ticks: Option<i64>,
    note: Option<String>,
    impact: bool,
    emphasis: Vec<String>,
    manual_segments: Option<Vec<String>>,
    gap_before: bool,
}

#[export]
pub fn parse_motion_text_source(
    ParseMotionTextSourceOptions {
        sequence_id,
        source,
    }: ParseMotionTextSourceOptions,
) -> ParsedMotionTextSource {
    let mut metadata = BTreeMap::new();
    let mut pending_cues = Vec::new();
    let mut diagnostics = Vec::new();
    let mut gap_before = false;

    for (line_index, raw_line) in source.replace('\r', "").split('\n').enumerate() {
        let source_line = u32::try_from(line_index + 1).unwrap_or(u32::MAX);
        let original = raw_line.trim();
        if original.is_empty() {
            if !pending_cues.is_empty() {
                gap_before = true;
            }
            continue;
        }
        if original.starts_with('#') {
            continue;
        }
        if let Some(captures) = METADATA.captures(original) {
            metadata.insert(
                captures[1].to_ascii_lowercase(),
                captures[2].trim().to_owned(),
            );
            continue;
        }

        let mut content = original;
        let mut starts = Vec::new();
        while let Some(captures) = LRC_TIME.captures(content) {
            let full_match = captures.get(0).expect("full LRC match exists");
            let minutes = captures[1].parse::<u64>().ok();
            let seconds = captures[2].replace(':', ".").parse::<f64>().ok();
            match (minutes, seconds) {
                (Some(minutes), Some(seconds)) if seconds.is_finite() => {
                    let total_seconds = minutes as f64 * 60.0 + seconds;
                    starts.push(seconds_to_ticks(total_seconds));
                }
                _ => diagnostics.push(MotionTextDiagnostic {
                    severity: MotionTextDiagnosticSeverity::Error,
                    code: "invalid-lrc-time".to_owned(),
                    message: format!("Invalid LRC timestamp: {}", full_match.as_str()),
                    source_line: Some(source_line),
                }),
            }
            content = &content[full_match.end()..];
        }
        let content = content.trim();

        if let Some(captures) = INTERLUDE.captures(content) {
            let duration = captures
                .get(2)
                .and_then(|value| value.as_str().parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value > 0.0)
                .map(seconds_to_ticks);
            append_for_timestamps(
                &mut pending_cues,
                &starts,
                PendingCue {
                    source_line,
                    text: String::new(),
                    start_ticks: None,
                    interlude: true,
                    interlude_duration_ticks: duration,
                    note: None,
                    impact: false,
                    emphasis: Vec::new(),
                    manual_segments: None,
                    gap_before,
                },
            );
            gap_before = false;
            continue;
        }

        let (lyric, note) = split_note(content);
        let (lyric, impact) = strip_impact(lyric);
        let (lyric, emphasis) = strip_emphasis(lyric);
        let (text, manual_segments) = split_manual_segments(&lyric);
        if text.is_empty() {
            diagnostics.push(MotionTextDiagnostic {
                severity: MotionTextDiagnosticSeverity::Warning,
                code: "empty-lyric".to_owned(),
                message: "The lyric line became empty after parsing and was ignored.".to_owned(),
                source_line: Some(source_line),
            });
            continue;
        }

        append_for_timestamps(
            &mut pending_cues,
            &starts,
            PendingCue {
                source_line,
                text,
                start_ticks: None,
                interlude: false,
                interlude_duration_ticks: None,
                note,
                impact,
                emphasis,
                manual_segments,
                gap_before,
            },
        );
        gap_before = false;
    }

    if pending_cues.iter().any(|cue| cue.start_ticks.is_some())
        && pending_cues.iter().any(|cue| cue.start_ticks.is_none())
    {
        diagnostics.push(MotionTextDiagnostic {
            severity: MotionTextDiagnosticSeverity::Warning,
            code: "mixed-lrc-timing".to_owned(),
            message: "Only some cues have LRC timestamps; untimed cues require explicit timing."
                .to_owned(),
            source_line: None,
        });
    }

    pending_cues.sort_by_key(|cue| cue.start_ticks.unwrap_or(i64::MAX));
    let mut occurrences = BTreeMap::<String, u32>::new();
    let cues = pending_cues
        .into_iter()
        .map(|cue| {
            let occurrence = occurrences.entry(cue.text.clone()).or_default();
            let id = stable_cue_id(&sequence_id, &cue.text, *occurrence);
            *occurrence += 1;
            MotionTextSourceCue {
                id,
                source_line: cue.source_line,
                text: cue.text,
                start_ticks: cue.start_ticks,
                interlude: cue.interlude,
                interlude_duration_ticks: cue.interlude_duration_ticks,
                note: cue.note,
                impact: cue.impact,
                emphasis: cue.emphasis,
                manual_segments: cue.manual_segments,
                gap_before: cue.gap_before,
            }
        })
        .collect();

    ParsedMotionTextSource {
        schema_version: MOTION_TEXT_SCHEMA_VERSION,
        metadata: metadata
            .into_iter()
            .map(|(key, value)| MotionTextMetadata { key, value })
            .collect(),
        cues,
        diagnostics,
    }
}

fn append_for_timestamps(cues: &mut Vec<PendingCue>, starts: &[i64], cue: PendingCue) {
    if starts.is_empty() {
        cues.push(cue);
        return;
    }
    for start_ticks in starts {
        let mut timed = cue.clone();
        timed.start_ticks = Some(*start_ticks);
        cues.push(timed);
    }
}

fn seconds_to_ticks(seconds: f64) -> i64 {
    (seconds * 120_000.0).round() as i64
}

fn split_note(content: &str) -> (&str, Option<String>) {
    let Some(index) = content.find('|') else {
        return (content.trim(), None);
    };
    let lyric = content[..index].trim();
    let note = content[index + 1..].trim();
    (
        lyric,
        if note.is_empty() {
            None
        } else {
            Some(note.to_owned())
        },
    )
}

fn strip_impact(content: &str) -> (&str, bool) {
    if content.len() > 1 && content.ends_with('!') {
        return (content[..content.len() - 1].trim(), true);
    }
    (content, false)
}

fn strip_emphasis(content: &str) -> (String, Vec<String>) {
    let mut emphasis = Vec::new();
    let text = EMPHASIS
        .replace_all(content, |captures: &regex::Captures<'_>| {
            let value = captures[1].to_owned();
            emphasis.push(value.clone());
            value
        })
        .into_owned();
    (text, emphasis)
}

fn split_manual_segments(content: &str) -> (String, Option<Vec<String>>) {
    if !content.contains('/') {
        return (content.trim().to_owned(), None);
    }
    let segments: Vec<String> = content
        .split('/')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_owned)
        .collect();
    let separator = if segments.iter().any(|segment| {
        segment
            .chars()
            .any(|character| character.is_ascii_alphabetic())
    }) {
        " "
    } else {
        ""
    };
    (segments.join(separator), Some(segments))
}

fn stable_cue_id(sequence_id: &str, text: &str, occurrence: u32) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in format!("{sequence_id}\0{text}\0{occurrence}").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("cue-{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(source: &str) -> ParsedMotionTextSource {
        parse_motion_text_source(ParseMotionTextSourceOptions {
            sequence_id: "sequence-1".to_owned(),
            source: source.to_owned(),
        })
    }

    #[test]
    fn parses_jizura_compatible_lyrics() {
        let parsed = parse(
            "[ti:Demo]\n[ar:Artist]\n[00:01.50][00:03:250]*Hello*/world! | whisper\n\n[interlude 4.5s]\n# ignored\n最后一行",
        );

        assert_eq!(
            parsed.metadata,
            vec![
                MotionTextMetadata {
                    key: "ar".to_owned(),
                    value: "Artist".to_owned(),
                },
                MotionTextMetadata {
                    key: "ti".to_owned(),
                    value: "Demo".to_owned(),
                },
            ]
        );
        assert_eq!(parsed.cues.len(), 4);
        assert_eq!(parsed.cues[0].start_ticks, Some(180_000));
        assert_eq!(parsed.cues[1].start_ticks, Some(390_000));
        assert_eq!(parsed.cues[0].text, "Hello world");
        assert_eq!(parsed.cues[0].note.as_deref(), Some("whisper"));
        assert!(parsed.cues[0].impact);
        assert_eq!(parsed.cues[0].emphasis, vec!["Hello"]);
        assert_eq!(
            parsed.cues[0].manual_segments,
            Some(vec!["Hello".to_owned(), "world".to_owned()])
        );
        assert!(parsed.cues[2].interlude);
        assert_eq!(parsed.cues[2].interlude_duration_ticks, Some(540_000));
        assert!(parsed.cues[2].gap_before);
        assert_eq!(parsed.cues[3].text, "最后一行");
        assert_eq!(parsed.diagnostics.len(), 1);
        assert_eq!(parsed.diagnostics[0].code, "mixed-lrc-timing");
    }

    #[test]
    fn produces_stable_ids_for_the_same_source() {
        let first = parse("one\ntwo");
        let second = parse("one\ntwo");
        assert_eq!(first.cues[0].id, second.cues[0].id);
        assert_ne!(first.cues[0].id, first.cues[1].id);
    }

    #[test]
    fn inserting_an_unrelated_leading_cue_does_not_reidentify_existing_cues() {
        let before = parse("one\ntwo");
        let after = parse("inserted\none\ntwo");
        assert_eq!(before.cues[0].id, after.cues[1].id);
        assert_eq!(before.cues[1].id, after.cues[2].id);
    }

    #[test]
    fn sorts_fully_timed_cues_and_keeps_duplicate_timestamps() {
        let parsed = parse("[00:03]later\n[00:01][00:02]earlier");
        let starts: Vec<Option<i64>> = parsed.cues.iter().map(|cue| cue.start_ticks).collect();
        assert_eq!(starts, vec![Some(120_000), Some(240_000), Some(360_000)]);
    }
}
