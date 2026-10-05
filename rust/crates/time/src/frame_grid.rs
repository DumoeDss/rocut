use crate::{FrameRate, MediaSourceSpanOptions, MediaTime, is_media_source_span_valid};
use bridge::export;
use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameGridClip {
    pub id: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
    pub source_duration: Option<MediaTime>,
    pub playback_rate: f64,
    pub freeze_frame: Option<MediaTime>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameGridOptions {
    pub frame_rate: FrameRate,
    pub clips: Vec<FrameGridClip>,
    pub markers: Vec<MediaTime>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameGridTiming {
    pub id: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum FrameGridResult {
    Ready {
        clips: Vec<FrameGridTiming>,
        markers: Vec<MediaTime>,
    },
    Rejected {
        reason: String,
    },
}

fn safe(time: MediaTime) -> bool {
    (0..=9_007_199_254_740_991).contains(&time.as_ticks())
}
fn rejected(reason: &str) -> FrameGridResult {
    FrameGridResult::Rejected {
        reason: reason.into(),
    }
}

/// Floor shared boundaries to the target grid, so adjacent clips remain adjacent
/// and no clip is extended beyond its original timeline end. Never delete a clip
/// that collapses below one frame. Source limits use the canonical playback clock.
#[export]
pub fn plan_frame_grid(options: FrameGridOptions) -> FrameGridResult {
    let Some(step) = options
        .frame_rate
        .ticks_per_frame()
        .filter(|step| *step > 0)
    else {
        return rejected("Invalid target frame rate");
    };
    let floor = |time: MediaTime| time.floor_to_frame(options.frame_rate).unwrap();
    let mut clips = Vec::with_capacity(options.clips.len());
    let mut ids = std::collections::HashSet::new();
    for clip in options.clips {
        if clip.id.is_empty()
            || !ids.insert(clip.id.clone())
            || ![clip.start, clip.duration, clip.trim_start, clip.trim_end]
                .into_iter()
                .all(safe)
            || clip.duration <= MediaTime::ZERO
            || !clip.playback_rate.is_finite()
            || !(0.01..=5.0).contains(&clip.playback_rate)
        {
            return rejected("Invalid clip timing");
        }
        let Some(end) = clip.start.as_ticks().checked_add(clip.duration.as_ticks()) else {
            return rejected("Clip timing overflow");
        };
        if !safe(MediaTime::from_ticks(end)) {
            return rejected("Clip timing overflow");
        }
        let start = floor(clip.start);
        let trim_start = floor(clip.trim_start);
        let trim_end = floor(clip.trim_end);
        let mut duration = floor(MediaTime::from_ticks(end)) - start;
        if let Some(source_duration) = clip.source_duration {
            let original = MediaSourceSpanOptions {
                trim_start: clip.trim_start,
                trim_end: clip.trim_end,
                duration: clip.duration,
                source_duration,
                playback_rate: clip.playback_rate,
                freeze_frame: clip.freeze_frame,
            };
            if !is_media_source_span_valid(original) {
                return rejected("Clip exceeds its media source");
            }
            let fits = |ticks| {
                is_media_source_span_valid(MediaSourceSpanOptions {
                    trim_start,
                    trim_end,
                    duration: MediaTime::from_ticks(ticks),
                    ..original
                })
            };
            if !fits(duration.as_ticks()) {
                let (mut low, mut high) = (0_i64, duration.as_ticks() / step);
                while low < high {
                    let mid = low + (high - low + 1) / 2;
                    if fits(mid * step) {
                        low = mid;
                    } else {
                        high = mid - 1;
                    }
                }
                duration = MediaTime::from_ticks(low * step);
            }
        }
        if duration < MediaTime::from_ticks(step) {
            return rejected(
                "A clip would become shorter than one frame; shorten its trims or use a higher frame rate",
            );
        }
        clips.push(FrameGridTiming {
            id: clip.id,
            start,
            duration,
            trim_start,
            trim_end,
        });
    }
    if !options.markers.iter().copied().all(safe) {
        return rejected("Invalid marker time");
    }
    FrameGridResult::Ready {
        clips,
        markers: options.markers.into_iter().map(floor).collect(),
    }
}
