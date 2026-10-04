//! Frame-aligned, non-ripple transitions between adjacent picture clips.
//! The caller selects two clips from one visible video track. This module never
//! changes their geometry or synthesizes missing source handles by freezing.
use serde::{Deserialize, Serialize};

use crate::video_time::resolve_video_source_time_offset;
use crate::{FrameRate, MediaTime, VideoSourceTimeOptions};

const MAX_SAFE_TICK: i64 = 9_007_199_254_740_991;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TransitionSource {
    Image,
    Video {
        trim_start: MediaTime,
        source_duration: MediaTime,
        playback_rate: f64,
        #[serde(default)]
        freeze_frame: Option<MediaTime>,
    },
}

crate::strict_object::strict_object! {
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionClip {
    pub id: String,
    pub track_id: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub source: TransitionSource,
}
}

#[derive(Clone, Debug)]
pub struct ClipTransitionOptions {
    pub outgoing: TransitionClip,
    pub incoming: TransitionClip,
    pub duration_frames: u32,
    pub frame_rate: FrameRate,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionPlanError {
    InvalidFrameRate,
    InvalidDuration,
    InvalidClip,
    DifferentTracks,
    SameClip,
    NotAdjacent,
    UnalignedCut,
    InsufficientClipDuration,
    InvalidSource,
    MissingOutgoingHandle,
    MissingIncomingHandle,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransitionWindow {
    pub start: MediaTime,
    pub cut: MediaTime,
    pub end: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransitionSample {
    /// Quantized project time used by both preview and export.
    pub time: MediaTime,
    pub progress: f64,
    /// Animation clocks hold endpoint values while source handles run outside the edit.
    pub outgoing_local_time: MediaTime,
    pub incoming_local_time: MediaTime,
    /// Images have no source clock; explicitly frozen video retains its frame.
    pub outgoing_source: Option<MediaTime>,
    pub incoming_source: Option<MediaTime>,
}

#[derive(Clone, Debug)]
pub struct ClipTransitionPlan {
    options: ClipTransitionOptions,
    window: ClipTransitionWindow,
    frame_ticks: i64,
}

fn safe_nonnegative(ticks: i64) -> bool {
    (0..=MAX_SAFE_TICK).contains(&ticks)
}

fn clip_end(clip: &TransitionClip) -> Result<i64, TransitionPlanError> {
    let start = clip.start.as_ticks();
    let duration = clip.duration.as_ticks();
    let end = start
        .checked_add(duration)
        .ok_or(TransitionPlanError::InvalidClip)?;
    if clip.id.is_empty()
        || clip.track_id.is_empty()
        || !safe_nonnegative(start)
        || duration <= 0
        || !safe_nonnegative(end)
    {
        return Err(TransitionPlanError::InvalidClip);
    }
    Ok(end)
}

fn validate_source(source: TransitionSource) -> Result<(), TransitionPlanError> {
    if let TransitionSource::Video {
        trim_start,
        source_duration,
        playback_rate,
        freeze_frame,
    } = source
    {
        let duration = source_duration.as_ticks();
        if duration <= 0
            || !safe_nonnegative(duration)
            || !safe_nonnegative(trim_start.as_ticks())
            || !playback_rate.is_finite()
            || !(0.01..=5.0).contains(&playback_rate)
            || freeze_frame
                .is_some_and(|frame| frame.as_ticks() < 0 || frame.as_ticks() >= duration)
        {
            return Err(TransitionPlanError::InvalidSource);
        }
    }
    Ok(())
}

/// Signed local time is intentional: the incoming clip reads its trimmed-away
/// pre-roll, while the outgoing clip reads its source beyond the edit point.
fn source_at(clip: &TransitionClip, time: i64) -> Option<Option<MediaTime>> {
    let TransitionSource::Video {
        trim_start,
        source_duration,
        playback_rate,
        freeze_frame,
    } = clip.source
    else {
        return Some(None);
    };
    resolve_video_source_time_offset(VideoSourceTimeOptions {
        clip_time: MediaTime::from_ticks(time.checked_sub(clip.start.as_ticks())?),
        trim_start,
        playback_rate,
        freeze_frame,
        source_duration: Some(source_duration),
    })
    .map(Some)
}

/// At least two project frames are required. For odd durations the additional
/// frame lies after the cut. No timeline ripple or source-audio change occurs.
pub fn plan_clip_transition(
    options: ClipTransitionOptions,
) -> Result<ClipTransitionPlan, TransitionPlanError> {
    let frame_ticks = options
        .frame_rate
        .ticks_per_frame()
        .filter(|ticks| *ticks > 0)
        .ok_or(TransitionPlanError::InvalidFrameRate)?;
    if options.duration_frames < 2 {
        return Err(TransitionPlanError::InvalidDuration);
    }
    let outgoing_end = clip_end(&options.outgoing)?;
    let incoming_end = clip_end(&options.incoming)?;
    if options.outgoing.id == options.incoming.id {
        return Err(TransitionPlanError::SameClip);
    }
    if options.outgoing.track_id != options.incoming.track_id {
        return Err(TransitionPlanError::DifferentTracks);
    }
    let cut = options.incoming.start.as_ticks();
    if outgoing_end != cut {
        return Err(TransitionPlanError::NotAdjacent);
    }
    if cut % frame_ticks != 0 {
        return Err(TransitionPlanError::UnalignedCut);
    }
    let before = i64::from(options.duration_frames / 2)
        .checked_mul(frame_ticks)
        .ok_or(TransitionPlanError::InvalidDuration)?;
    let after = i64::from(options.duration_frames - options.duration_frames / 2)
        .checked_mul(frame_ticks)
        .ok_or(TransitionPlanError::InvalidDuration)?;
    let start = cut
        .checked_sub(before)
        .ok_or(TransitionPlanError::InvalidDuration)?;
    let end = cut
        .checked_add(after)
        .ok_or(TransitionPlanError::InvalidDuration)?;
    if start < options.outgoing.start.as_ticks() || end > incoming_end {
        return Err(TransitionPlanError::InsufficientClipDuration);
    }
    validate_source(options.outgoing.source)?;
    validate_source(options.incoming.source)?;
    // These endpoints bracket every rendered frame because supported rates are positive.
    // Sample the last frame, never the exclusive end or an arbitrary final tick.
    let last = end - frame_ticks;
    for (clip, error) in [
        (
            &options.outgoing,
            TransitionPlanError::MissingOutgoingHandle,
        ),
        (
            &options.incoming,
            TransitionPlanError::MissingIncomingHandle,
        ),
    ] {
        if source_at(clip, start).is_none() || source_at(clip, last).is_none() {
            return Err(error);
        }
    }
    Ok(ClipTransitionPlan {
        options,
        frame_ticks,
        window: ClipTransitionWindow {
            start: MediaTime::from_ticks(start),
            cut: MediaTime::from_ticks(cut),
            end: MediaTime::from_ticks(end),
        },
    })
}

impl ClipTransitionPlan {
    pub fn window(&self) -> ClipTransitionWindow {
        self.window
    }

    pub fn sample(&self, playhead: MediaTime) -> Option<ClipTransitionSample> {
        let ticks = playhead.as_ticks();
        if ticks < self.window.start.as_ticks() || ticks >= self.window.end.as_ticks() {
            return None;
        }
        let time = ticks.div_euclid(self.frame_ticks) * self.frame_ticks;
        Some(ClipTransitionSample {
            time: MediaTime::from_ticks(time),
            progress: (time - self.window.start.as_ticks()) as f64
                / (self.window.end.as_ticks() - self.window.start.as_ticks()) as f64,
            outgoing_local_time: MediaTime::from_ticks(
                (time - self.options.outgoing.start.as_ticks())
                    .clamp(0, self.options.outgoing.duration.as_ticks()),
            ),
            incoming_local_time: MediaTime::from_ticks(
                (time - self.options.incoming.start.as_ticks())
                    .clamp(0, self.options.incoming.duration.as_ticks()),
            ),
            outgoing_source: source_at(&self.options.outgoing, time)?,
            incoming_source: source_at(&self.options.incoming, time)?,
        })
    }
}
