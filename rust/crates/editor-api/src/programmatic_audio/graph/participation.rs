//! Shared canonical participation policy. Inert declarations still require
//! admission and valid observed facts; only their full gain history is optional.
use super::snapshot::{Bus, Track};
use super::topology::audible_media;

pub(super) struct Participation {
    pub start_sample: u64,
    pub input_frames: u64,
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
) -> Result<Participation, String> {
    let start_sample = sample_aligned(track.native.start * f64::from(sample_rate), "clip start")?;
    let frames = sample_aligned(
        track.native.duration * f64::from(sample_rate),
        "clip duration",
    )?;
    let input_frames = frames.min(canonical_frames.saturating_sub(start_sample));
    let audible_media = audible_media(track);
    let muted = track.authored_muted || track.ancestor_hidden || !audible_media;
    let bus_hidden = bus_instance_id
        .is_some_and(|id| buses.iter().any(|bus| bus.instance_id == id && bus.hidden));
    Ok(Participation {
        start_sample,
        input_frames,
        audible_media,
        muted,
        requires_pcm: input_frames > 0 && !muted && !bus_hidden,
    })
}
