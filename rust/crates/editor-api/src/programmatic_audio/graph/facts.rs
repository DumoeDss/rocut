//! Bounded native track facts, not evaluated faders or an execution schedule.
use super::snapshot::Track;
use crate::programmatic_audio::MAX_SECONDS;
use crate::programmatic_audio::envelope::MAX_GAIN_POINTS;

pub(super) fn bounded_text(value: Option<&str>, bytes: usize, label: &str) -> Result<(), String> {
    if value.is_some_and(|value| value.len() > bytes) {
        return Err(format!(
            "HyperFrames graph {label} exceeds its byte safety limit"
        ));
    }
    Ok(())
}

pub(super) fn seconds(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_SECONDS).contains(&value)
}

pub(super) fn automation(
    value: Option<&str>,
    fx_chain: Option<&str>,
) -> Result<super::fx_automation::FxAutomationAdmission, String> {
    let chain = super::validation::chain(fx_chain, &mut 0)?;
    super::fx_automation::admit_fx_automation(value, &chain)
}

pub(super) fn validate_track(track: &Track, time: f64) -> Result<usize, String> {
    let native = &track.native;
    if !matches!(track.kind.as_str(), "audio" | "video")
        || !seconds(track.observed_at)
        || (track.observed_at - time).abs() > 1e-7
        || ![
            native.start,
            native.end,
            native.duration,
            native.media_start,
            native.source_duration,
            native.fades.fade_in,
            native.fades.fade_out,
        ]
        .into_iter()
        .all(seconds)
        || native.source_duration == 0.0
        || native.end < native.start
        || (native.start + native.duration - native.end).abs() > 1e-7
        || native.volume.is_some_and(|volume| !volume.is_finite())
    {
        return Err("Invalid or inconsistent HyperFrames native track timing/fader facts".into());
    }
    if !native.playback_rate.is_finite() || !(0.01..=16.0).contains(&native.playback_rate) {
        return Err("HyperFrames static playback rate exceeds the safety limit".into());
    }
    super::rate_lane::admit(track)?;
    if let super::fader_model::ResolvedAuthorGain::Observed { observed_at, .. } =
        &track.resolved_author_gain
    {
        if !seconds(*observed_at) || (*observed_at - time).abs() > 1e-7 {
            return Err(
                "HyperFrames snapshot resolved gain clock disagrees with the snapshot".into(),
            );
        }
    }
    bounded_text(
        track.attributes.has_audio.as_deref(),
        4096,
        "hasAudio attribute",
    )?;
    let points = native.volume_keyframes.as_deref().unwrap_or(&[]);
    if points.len() > MAX_GAIN_POINTS {
        return Err("HyperFrames track volume keyframes exceed the safety limit".into());
    }
    let max_gain = 10.0f64.powf(12.0 / 20.0);
    let mut previous = None;
    for point in points {
        if !seconds(point.time)
            || !point.volume.is_finite()
            || !(0.0..=max_gain).contains(&point.volume)
            || previous.is_some_and(|time| point.time <= time)
        {
            return Err("Invalid or unordered native-normalized track volume keyframes".into());
        }
        previous = Some(point.time);
    }
    Ok(points.len())
}
