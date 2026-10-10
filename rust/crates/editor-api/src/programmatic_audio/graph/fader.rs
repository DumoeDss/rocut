use super::facts::seconds;
use super::fader_model::{GainSource, ResolvedAuthorGain};
use super::snapshot::Track;
use super::volume_lane::{envelope, max_gain, validate_points};
use crate::programmatic_audio::envelope::{GainEnvelope, Point};
#[path = "fader_history.rs"]
pub(super) mod history;

pub(super) fn observed_envelope(
    track: &Track,
    fact: &ResolvedAuthorGain,
    require_history: bool,
) -> Result<Option<GainEnvelope>, String> {
    let ResolvedAuthorGain::Observed {
        observed_at,
        gain_before_fades,
        source,
        points,
        fades,
        fallback,
    } = fact
    else {
        return Ok(None);
    };
    let native = &track.native;
    if !seconds(*observed_at)
        || !super::native_window::active(*observed_at, native.start, native.end)
        || !gain_before_fades.is_finite()
        || !(0.0..=max_gain()).contains(gain_before_fades)
        || fades.fade_in != native.fades.fade_in
        || fades.fade_out != native.fades.fade_out
    {
        return Err("Invalid HyperFrames resolved-author-gain clock/fade facts".into());
    }
    let raw_lane = super::facts::automation(
        track.attributes.automation.as_deref(),
        track.attributes.fx_chain.as_deref(),
    )?
    .volume_points;
    if *source == GainSource::Fallback {
        let Some(fallback) = fallback else {
            return Err("Missing native fallback gain facts".into());
        };
        if points.is_some()
            || raw_lane.is_some()
            || native
                .volume_keyframes
                .as_ref()
                .is_some_and(|p| !p.is_empty())
            || !fallback.current_element_volume.is_finite()
            || !(0.0..=1.0).contains(&fallback.current_element_volume)
            || !fallback.baseline_gain.is_finite()
            || !(0.0..=max_gain()).contains(&fallback.baseline_gain)
            || fallback
                .previous_runtime_volume
                .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        {
            return Err("Inconsistent HyperFrames native fallback gain facts".into());
        }
        // Pinned 0.8.139 sync fallback: E=Je(n.volume??1), C=js.get(el),
        // D=$s(el.volume). Validate the selected branch, not a static history.
        let baseline = native.volume.unwrap_or(1.0).clamp(0.0, max_gain());
        let current = fallback.current_element_volume;
        let expected = if fallback.routed {
            baseline
        } else {
            match fallback.previous_runtime_volume {
                None if baseline > 1.0 => baseline,
                None => current,
                Some(previous) if (current - previous).abs() > 1e-4 => current,
                Some(_) => baseline,
            }
        };
        if (fallback.baseline_gain - baseline).abs() > 1e-7
            || (gain_before_fades - expected).abs() > 1e-7
        {
            return Err("HyperFrames fallback gain disagrees with native branch facts".into());
        }
        if require_history {
            return Err("HyperFrames fallback author gain requires complete native history; a single observation is insufficient".into());
        }
        return Ok(None);
    }
    if fallback.is_some() {
        return Err("Normalized HyperFrames gain cannot carry fallback facts".into());
    }
    let points = points
        .as_ref()
        .filter(|points| !points.is_empty())
        .ok_or("Missing normalized HyperFrames fader points")?;
    validate_points(points, native.duration)?;
    let expected: Vec<Point> = match source {
        GainSource::VolumeLane => {
            raw_lane.ok_or("Normalized volume lane lacks authored automation evidence")?
        }
        GainSource::Gsap => {
            if raw_lane.is_some() {
                return Err("Native GSAP gain cannot override an authored volume lane".into());
            }
            native
                .volume_keyframes
                .as_ref()
                .ok_or("Missing native GSAP keyframe evidence")?
                .iter()
                .map(|point| Point {
                    t: point.time,
                    v: point.volume,
                    curve: None,
                    via_x: None,
                    via_y: None,
                })
                .collect()
        }
        GainSource::Fallback => unreachable!(),
    };
    if *points != expected {
        return Err("HyperFrames normalized fader disagrees with authored/native evidence".into());
    }
    let mut env = envelope(points.clone(), native.duration, 1.0);
    let expected_gain = env
        .level(*observed_at - native.start)
        .clamp(0.0, max_gain());
    if (expected_gain - gain_before_fades).abs() > 1e-7 {
        return Err(
            "HyperFrames author gain observation disagrees with normalized envelope".into(),
        );
    }
    env.fade_in = native.fades.fade_in;
    env.fade_out = native.fades.fade_out;
    env.validate()?;
    Ok(Some(env))
}

pub(super) fn resolve_fader<'a>(
    track: &'a Track,
    observations: impl Iterator<Item = &'a ResolvedAuthorGain>,
    require_history: bool,
) -> Result<Option<GainEnvelope>, String> {
    let mut result = None;
    for fact in std::iter::once(&track.resolved_author_gain).chain(observations) {
        if let Some(env) = observed_envelope(track, fact, require_history)? {
            if result.as_ref().is_some_and(|previous| previous != &env) {
                return Err(
                    "HyperFrames fader observations changed across canonical history".into(),
                );
            }
            result = Some(env);
        }
    }
    if !require_history {
        return Ok(None);
    }
    result.map(Some).ok_or_else(|| {
        format!(
            "Missing complete HyperFrames fader observation for {}",
            track.instance_id
        )
    })
}
