use super::model::Fades;
use crate::programmatic_audio::envelope::Point;
use serde::Deserialize;

#[derive(Deserialize, Default)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum ResolvedAuthorGain {
    #[default]
    Unobserved,
    #[serde(rename_all = "camelCase")]
    Observed {
        observed_at: f64,
        gain_before_fades: f64,
        source: GainSource,
        points: Option<Vec<Point>>,
        fades: Fades,
        fallback: Option<FallbackFacts>,
    },
}

#[derive(Deserialize, PartialEq)]
pub(super) enum GainSource {
    #[serde(rename = "normalized-volume-lane")]
    VolumeLane,
    #[serde(rename = "normalized-GSAP")]
    Gsap,
    #[serde(rename = "fallback")]
    Fallback,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FallbackFacts {
    pub routed: bool,
    pub previous_runtime_volume: Option<f64>,
    pub current_element_volume: f64,
    pub baseline_gain: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FaderObservation {
    pub instance_id: String,
    pub resolved_author_gain: ResolvedAuthorGain,
}
