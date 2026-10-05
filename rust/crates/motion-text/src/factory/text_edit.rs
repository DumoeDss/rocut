use serde_json::{Map, Value, json};

use crate::source::split_to_count;

/// A changed lyric must not keep rendering its previous explicit segments.
/// Retain a custom time partition when the new text can fill the same slots;
/// otherwise let the normal language tokenizer rebuild a valid partition.
pub(super) fn refresh_segments(cue: &mut Map<String, Value>, text: &str, duration: i64) {
    let custom_count = cue
        .get("cutDurations")
        .and_then(Value::as_array)
        .filter(|durations| !durations.is_empty())
        .filter(|_| cue.get("duration").and_then(Value::as_i64) == Some(duration))
        .map_or(0, Vec::len);
    let segments = if custom_count > 0 {
        split_to_count(text, custom_count)
    } else {
        Vec::new()
    };
    if custom_count > 0
        && segments.len() == custom_count
        && segments.iter().all(|segment| !segment.trim().is_empty())
    {
        cue.insert("segments".to_owned(), json!(segments));
    } else {
        cue.insert("segments".to_owned(), json!([]));
        cue.remove("cutDurations");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_stale_automatic_segments_and_preserves_unknown_fields() {
        let mut cue = json!({ "segments": ["old", "words"], "duration": 90, "future": true })
            .as_object()
            .unwrap()
            .clone();
        refresh_segments(&mut cue, "替换后的文字", 90);
        assert_eq!(cue["segments"], json!([]));
        assert_eq!(cue["future"], true);
    }

    #[test]
    fn keeps_custom_timing_when_new_text_fills_the_same_number_of_cuts() {
        let mut cue = json!({ "segments": ["一", "二", "三"], "duration": 90,
            "cutDurations": [40, 20, 30] })
        .as_object()
        .unwrap()
        .clone();
        refresh_segments(&mut cue, "改后一二三", 90);
        assert_eq!(cue["segments"], json!(["改后", "一二", "三"]));
        assert_eq!(cue["cutDurations"], json!([40, 20, 30]));
    }

    #[test]
    fn rebuilds_partitions_that_no_longer_fit_the_new_text_or_duration() {
        for (text, duration) in [("字", 90), ("A     B", 90), ("改后一二三", 60)] {
            let mut cue = json!({ "segments": ["一", "二", "三"], "duration": 90,
                "cutDurations": [40, 20, 30] })
            .as_object()
            .unwrap()
            .clone();
            refresh_segments(&mut cue, text, duration);
            assert_eq!(cue["segments"], json!([]));
            assert!(!cue.contains_key("cutDurations"));
        }
    }
}
