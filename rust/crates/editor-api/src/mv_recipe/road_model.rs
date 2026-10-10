use serde::{Deserialize, Serialize};
#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Tear,
    Run,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FreezeStyle {
    Photo,
    None,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub char: Option<String>,
    #[serde(default)]
    pub impact: Option<f64>,
    #[serde(default)]
    pub horizon: Option<f64>,
    #[serde(default)]
    pub open: Option<f64>,
    #[serde(default)]
    pub dolly: Option<f64>,
    #[serde(default)]
    pub slow_at: Option<f64>,
    #[serde(default)]
    pub freeze_at: Option<f64>,
    #[serde(default)]
    pub freeze_style: Option<FreezeStyle>,
}
pub struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: &'a [u64],
    pub bpm: f64,
    pub stops: &'a [u64],
    pub downbeats: &'a [u64],
    pub resources: &'a [crate::programmatic_resources::Resource],
}
pub fn validate(a: &Args, s: &Sample<'_>) -> Result<(), String> {
    if s.shot_start_ticks >= s.shot_end_ticks
        || s.shot_end_ticks > 2_592_000_000
        || s.song_ticks < s.shot_start_ticks
        || s.song_ticks > s.shot_end_ticks
        || s.beats.is_empty()
        || s.beats.len() > 21600
        || !s.bpm.is_finite()
        || !(1.0..=1000.0).contains(&s.bpm)
        || [s.beats, s.stops, s.downbeats].iter().any(|v| {
            v.len() > 21600
                || v.windows(2).any(|p| p[0] >= p[1])
                || v.iter().any(|n| *n > 2_592_000_000)
        })
        || [a.impact, a.horizon, a.open, a.dolly, a.slow_at, a.freeze_at]
            .into_iter()
            .flatten()
            .any(|t| !t.is_finite() || !(0.0..=21600.0).contains(&t))
    {
        return Err("Invalid Road authored times or whole-song clock/audio facts".into());
    }
    Ok(())
}
