use bridge::export;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};

use crate::MediaTime;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoSourceTimeOptions {
    pub clip_time: MediaTime,
    pub trim_start: MediaTime,
    pub playback_rate: f64,
    #[serde(default)]
    pub freeze_frame: Option<MediaTime>,
    #[serde(default)]
    pub source_duration: Option<MediaTime>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirectionalVideoSourceTimeOptions {
    pub clip_time: MediaTime,
    pub clip_duration: MediaTime,
    pub trim_start: MediaTime,
    pub playback_rate: f64,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default)]
    pub freeze_frame: Option<MediaTime>,
    #[serde(default)]
    pub source_duration: Option<MediaTime>,
}

/// Direction changes traversal of the same half-open trimmed source interval.
#[export]
pub fn resolve_directional_video_source_time(
    options: DirectionalVideoSourceTimeOptions,
) -> Option<MediaTime> {
    if options.clip_time < MediaTime::ZERO || options.clip_time >= options.clip_duration {
        return None;
    }
    resolve_directional_video_source_time_offset(options)
}

pub(crate) fn resolve_directional_video_source_time_offset(
    options: DirectionalVideoSourceTimeOptions,
) -> Option<MediaTime> {
    if options.clip_duration <= MediaTime::ZERO || options.trim_start < MediaTime::ZERO {
        return None;
    }
    let clip_time = if options.reverse && options.freeze_frame.is_none() {
        let span = playback_elapsed(options.clip_duration, options.playback_rate)?;
        let mut elapsed = playback_elapsed(options.clip_time, options.playback_rate)?;
        if span <= 0 {
            return None;
        }
        if options.clip_time >= MediaTime::ZERO && options.clip_time < options.clip_duration {
            elapsed = elapsed.min(span - 1);
        }
        MediaTime::from_ticks(span.checked_sub(1)?.checked_sub(elapsed)?)
    } else {
        options.clip_time
    };
    resolve_video_source_time_offset(VideoSourceTimeOptions {
        clip_time,
        trim_start: options.trim_start,
        playback_rate: if options.reverse && options.freeze_frame.is_none() {
            1.0
        } else {
            options.playback_rate
        },
        freeze_frame: options.freeze_frame,
        source_duration: options.source_duration,
    })
}

fn playback_elapsed(time: MediaTime, rate: f64) -> Option<i64> {
    let safe_rate = if rate.is_finite() && rate > 0.0 {
        rate.clamp(0.01, 5.0)
    } else {
        1.0
    };
    (time.as_ticks() as f64 * safe_rate).round().to_i64()
}

/// Reverse rendered PCM so preview and export share the exact sample ordering.
#[export]
pub fn reverse_audio_samples(mut samples: Vec<f32>) -> Vec<f32> {
    samples.reverse();
    samples
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectionalSourceTrims {
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
    #[serde(default)]
    pub reverse: bool,
}

/// Convert between source-order and playback-order handles; this is an involution.
#[export]
pub fn directional_source_trims(options: DirectionalSourceTrims) -> Option<DirectionalSourceTrims> {
    if options.trim_start < MediaTime::ZERO || options.trim_end < MediaTime::ZERO {
        return None;
    }
    Some(if options.reverse {
        DirectionalSourceTrims {
            trim_start: options.trim_end,
            trim_end: options.trim_start,
            ..options
        }
    } else {
        options
    })
}

/// One source-time policy for normal playback and a non-destructive frame hold.
#[export]
pub fn resolve_video_source_time(options: VideoSourceTimeOptions) -> Option<MediaTime> {
    if options.clip_time < MediaTime::ZERO || options.trim_start < MediaTime::ZERO {
        return None;
    }
    resolve_video_source_time_offset(options)
}

// Transitions alone may address negative clip time to read a validated source pre-roll.
pub(crate) fn resolve_video_source_time_offset(
    options: VideoSourceTimeOptions,
) -> Option<MediaTime> {
    let source = if let Some(frame) = options.freeze_frame {
        frame
    } else {
        let elapsed = playback_elapsed(options.clip_time, options.playback_rate)?;
        MediaTime::from_ticks(options.trim_start.as_ticks().checked_add(elapsed)?)
    };
    if source < MediaTime::ZERO || source.as_ticks() > 9_007_199_254_740_991 {
        return None;
    }
    if options
        .source_duration
        .is_some_and(|duration| source >= duration)
    {
        return None;
    }
    Some(source)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoFreezeFrameOptions {
    pub clip_start: MediaTime,
    pub clip_duration: MediaTime,
    pub playhead: MediaTime,
    pub trim_start: MediaTime,
    pub playback_rate: f64,
    pub source_duration: MediaTime,
}

/// A new hold must be sampled inside the selected clip and its source media.
#[export]
pub fn plan_video_freeze_frame(options: VideoFreezeFrameOptions) -> Option<MediaTime> {
    if options.clip_start < MediaTime::ZERO || options.clip_duration <= MediaTime::ZERO {
        return None;
    }
    let local = options
        .playhead
        .as_ticks()
        .checked_sub(options.clip_start.as_ticks())?;
    if local < 0 || local >= options.clip_duration.as_ticks() {
        return None;
    }
    resolve_video_source_time(VideoSourceTimeOptions {
        clip_time: MediaTime::from_ticks(local),
        trim_start: options.trim_start,
        playback_rate: options.playback_rate,
        freeze_frame: None,
        source_duration: Some(options.source_duration),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(ticks: i64) -> MediaTime {
        MediaTime::from_ticks(ticks)
    }
    fn sample() -> VideoFreezeFrameOptions {
        VideoFreezeFrameOptions {
            clip_start: time(120_000),
            clip_duration: time(360_000),
            playhead: time(240_000),
            trim_start: time(60_000),
            playback_rate: 2.0,
            source_duration: time(1_200_000),
        }
    }

    #[test]
    fn samples_trimmed_and_retimed_source_without_changing_clip_geometry() {
        assert_eq!(plan_video_freeze_frame(sample()), Some(time(300_000)));
        assert_eq!(
            plan_video_freeze_frame(VideoFreezeFrameOptions {
                playback_rate: 0.5,
                ..sample()
            }),
            Some(time(120_000))
        );
    }

    #[test]
    fn rejects_outside_clip_and_source_including_exclusive_end() {
        for playhead in [119_999, 480_000, i64::MAX] {
            assert_eq!(
                plan_video_freeze_frame(VideoFreezeFrameOptions {
                    playhead: time(playhead),
                    ..sample()
                }),
                None
            );
        }
        for duration in [-1, 0, 300_000] {
            assert_eq!(
                plan_video_freeze_frame(VideoFreezeFrameOptions {
                    source_duration: time(duration),
                    ..sample()
                }),
                None
            );
        }
        assert_eq!(
            plan_video_freeze_frame(VideoFreezeFrameOptions {
                clip_duration: time(0),
                ..sample()
            }),
            None
        );
        assert_eq!(
            plan_video_freeze_frame(VideoFreezeFrameOptions {
                trim_start: time(-1),
                ..sample()
            }),
            None
        );
    }

    #[test]
    fn frozen_source_ignores_playback_progress_trim_and_speed() {
        for clip_time in [0, 120_000, 900_000] {
            let options = VideoSourceTimeOptions {
                clip_time: time(clip_time),
                trim_start: time(240_000),
                playback_rate: 5.0,
                freeze_frame: Some(time(300_000)),
                source_duration: Some(time(1_200_000)),
            };
            assert_eq!(resolve_video_source_time(options), Some(time(300_000)));
            assert_eq!(
                resolve_video_source_time(VideoSourceTimeOptions {
                    freeze_frame: Some(time(-1)),
                    ..options
                }),
                None
            );
        }
    }

    #[test]
    fn preserves_rate_policy_and_rejects_overflow() {
        for rate in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                plan_video_freeze_frame(VideoFreezeFrameOptions {
                    playback_rate: rate,
                    ..sample()
                }),
                Some(time(180_000))
            );
        }
        assert_eq!(
            plan_video_freeze_frame(VideoFreezeFrameOptions {
                playback_rate: 100.0,
                ..sample()
            }),
            Some(time(660_000))
        );
        assert_eq!(
            plan_video_freeze_frame(VideoFreezeFrameOptions {
                trim_start: time(i64::MAX),
                ..sample()
            }),
            None
        );
    }
}
