//! Native rate evidence must agree with the first normalized authored rate lane.
use super::snapshot::Track;
use crate::programmatic_audio::envelope::Point;
use serde::Deserialize;

pub(super) const MIN_RATE: f64 = 0.1;
pub(super) const MAX_RATE: f64 = 10.0;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeLane {
    target: String,
    points: Vec<Point>,
}

pub(super) fn admit(track: &Track) -> Result<Option<Vec<Point>>, String> {
    let normalized = super::facts::automation(
        track.attributes.automation.as_deref(),
        track.attributes.fx_chain.as_deref(),
    )?
    .rate_points;
    match normalized {
        Some(points) => {
            let lane: NativeLane = serde_json::from_value(track.native.rate.clone()).map_err(
                |_| "HyperFrames native rate automation lane lacks normalized authored evidence",
            )?;
            if lane.target != "rate" || lane.points != points {
                return Err("HyperFrames native rate automation disagrees with the normalized authored lane".into());
            }
            Ok(Some(points))
        }
        None => {
            let rate = track.native.rate.as_f64().ok_or(
                "HyperFrames native rate automation lane lacks normalized authored evidence",
            )?;
            if !rate.is_finite() || rate != track.native.playback_rate {
                return Err("HyperFrames native static rate disagrees with playbackRate".into());
            }
            Ok(None)
        }
    }
}
