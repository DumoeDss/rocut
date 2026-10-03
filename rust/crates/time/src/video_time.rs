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

/// One source-time policy for normal playback and a non-destructive frame hold.
#[export]
pub fn resolve_video_source_time(options: VideoSourceTimeOptions) -> Option<MediaTime> {
    if options.clip_time < MediaTime::ZERO || options.trim_start < MediaTime::ZERO {
        return None;
    }
    let source = if let Some(frame) = options.freeze_frame {
        frame
    } else {
        // Match the editor's existing supported playback-rate range.
        let rate = if options.playback_rate.is_finite() && options.playback_rate > 0.0 {
            options.playback_rate.clamp(0.01, 5.0)
        } else {
            1.0
        };
        let elapsed = (options.clip_time.as_ticks() as f64 * rate)
            .round()
            .to_i64()?;
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
