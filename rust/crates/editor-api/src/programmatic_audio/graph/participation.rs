//! Shared canonical participation policy. Inert declarations still require
//! admission and valid observed facts; only their full gain history is optional.
use super::snapshot::{Bus, Track};
use super::topology::audible_media;
use crate::programmatic_audio::timing::AudioTiming;

pub(super) struct Participation {
    pub start_sample: u64,
    pub input_frames: u64,
    pub clip_frames: u64,
    pub audible_media: bool,
    pub muted: bool,
    pub requires_pcm: bool,
}

pub(super) fn sample_aligned(value: f64, label: &str) -> Result<u64, String> {
    if !value.is_finite() || value < 0.0 || (value - value.round()).abs() > 1e-6 {
        return Err(format!(
            "HyperFrames {label} has unsupported fractional-sample phase; no native phase oracle is established"
        ));
    }
    Ok(value.round() as u64)
}

/// Call only after source/clock/topology admission has resolved bus membership.
pub(super) fn participation(
    track: &Track,
    buses: &[Bus],
    bus_instance_id: Option<&str>,
    sample_rate: u32,
    canonical_frames: u64,
    timing: AudioTiming,
) -> Result<Participation, String> {
    let start_sample = super::export_timing::start_sample(timing, track.native.start, sample_rate)?;
    let frames = if (super::rate_lane::admit(track)?.is_some()
        && super::rate_prepare::observed_pcm(&track.native, sample_rate))
        || super::rate_prepare::needs_scalar_preparation(&track.native, sample_rate)
    {
        // Participation is based on the declaration, never the decoder's later
        // observation. A short/empty decode cannot bypass complete gain history.
        (track.native.duration * f64::from(sample_rate)).ceil() as u64
    } else {
        sample_aligned(
            track.native.duration * f64::from(sample_rate),
            "clip duration",
        )?
    };
    let input_frames = frames.min(canonical_frames.saturating_sub(start_sample));
    let audible_media = audible_media(track);
    let muted = track.authored_muted || track.ancestor_hidden || !audible_media;
    let bus_hidden = bus_instance_id
        .is_some_and(|id| buses.iter().any(|bus| bus.instance_id == id && bus.hidden));
    Ok(Participation {
        start_sample,
        input_frames,
        clip_frames: frames,
        audible_media,
        muted,
        requires_pcm: input_frames > 0 && !muted && !bus_hidden,
    })
}
