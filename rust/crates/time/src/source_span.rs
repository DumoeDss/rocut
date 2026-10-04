use crate::video_time::resolve_video_source_time_offset;
use crate::{MediaTime, VideoSourceTimeOptions};
use bridge::export;
use serde::Serialize;

crate::strict_object::strict_object! {
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaSourceSpanOptions {
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
    pub duration: MediaTime,
    pub source_duration: MediaTime,
    pub playback_rate: f64,
    #[serde(default)]
    pub freeze_frame: Option<MediaTime>,
}
}

/// Source spans use the same rounded source clock as playback, not timeline
/// duration. A frame hold may extend in time but must still reference real media.
#[export]
pub fn is_media_source_span_valid(options: MediaSourceSpanOptions) -> bool {
    let safe = |time: MediaTime| (0..=9_007_199_254_740_991).contains(&time.as_ticks());
    if ![
        options.trim_start,
        options.trim_end,
        options.duration,
        options.source_duration,
    ]
    .into_iter()
    .all(safe)
        || options.duration <= MediaTime::ZERO
        || options.source_duration <= MediaTime::ZERO
        || !options.playback_rate.is_finite()
        || !(0.01..=5.0).contains(&options.playback_rate)
    {
        return false;
    }
    let Some(trim_sum) = options
        .trim_start
        .as_ticks()
        .checked_add(options.trim_end.as_ticks())
    else {
        return false;
    };
    if trim_sum > options.source_duration.as_ticks() {
        return false;
    }
    if let Some(frame) = options.freeze_frame {
        return safe(frame) && frame < options.source_duration;
    }
    let Some(end) = resolve_video_source_time_offset(VideoSourceTimeOptions {
        clip_time: options.duration,
        trim_start: options.trim_start,
        playback_rate: options.playback_rate,
        freeze_frame: None,
        source_duration: None,
    }) else {
        return false;
    };
    end.as_ticks()
        .checked_add(options.trim_end.as_ticks())
        .is_some_and(|end| end <= options.source_duration.as_ticks())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(n: i64) -> MediaTime {
        MediaTime::from_ticks(n)
    }
    fn input() -> MediaSourceSpanOptions {
        MediaSourceSpanOptions {
            trim_start: t(120_000),
            trim_end: t(120_000),
            duration: t(720_000),
            source_duration: t(600_000),
            playback_rate: 0.5,
            freeze_frame: None,
        }
    }
    #[test]
    fn slow_fast_and_unit_rates_use_source_span_not_timeline_span() {
        assert!(is_media_source_span_valid(input()));
        assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
            duration: t(720_003),
            ..input()
        }));
        assert!(is_media_source_span_valid(MediaSourceSpanOptions {
            playback_rate: 2.0,
            duration: t(180_000),
            ..input()
        }));
        assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
            playback_rate: 2.0,
            duration: t(180_001),
            ..input()
        }));
        assert!(is_media_source_span_valid(MediaSourceSpanOptions {
            playback_rate: 1.0,
            duration: t(360_000),
            ..input()
        }));
    }
    #[test]
    fn holds_can_extend_but_cannot_reference_outside_media_or_invalid_trims() {
        assert!(is_media_source_span_valid(MediaSourceSpanOptions {
            duration: t(12_000_000),
            freeze_frame: Some(t(599_999)),
            ..input()
        }));
        for frame in [-1, 600_000, i64::MAX] {
            assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
                freeze_frame: Some(t(frame)),
                ..input()
            }));
        }
        assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
            trim_end: t(600_000),
            freeze_frame: Some(t(0)),
            ..input()
        }));
    }
    #[test]
    fn rejects_unsafe_times_zero_duration_and_invalid_rates() {
        for rate in [0.0, 0.001, -1.0, 5.001, f64::NAN, f64::INFINITY] {
            assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
                playback_rate: rate,
                ..input()
            }));
        }
        for duration in [-1, 0, i64::MAX] {
            assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
                duration: t(duration),
                ..input()
            }));
        }
        assert!(!is_media_source_span_valid(MediaSourceSpanOptions {
            source_duration: t(i64::MAX),
            ..input()
        }));
    }
}
