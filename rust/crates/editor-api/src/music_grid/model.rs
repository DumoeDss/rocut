use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

pub const MAX_TICK: i64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rational {
    pub numerator: i64,
    pub denominator: i64,
}
impl Rational {
    pub fn valid(&self) -> bool {
        self.numerator >= 0
            && self.numerator <= 1_000_000
            && self.denominator > 0
            && self.denominator <= 1_000_000
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeterSegment {
    pub id: String,
    pub source_start_tick: i64,
    pub source_end_tick: i64,
    pub meter: Rational,
    pub beat_unit: Rational,
    pub phase_quarter_notes: Rational,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bar_number: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}
impl MeterSegment {
    pub fn validate(&self, duration: i64) -> bool {
        text(&self.id)
            && self.source_start_tick >= 0
            && self.source_end_tick > self.source_start_tick
            && self.source_end_tick <= duration
            && self.meter.valid()
            && self.meter.numerator > 0
            && self.meter.numerator <= 64
            && self.meter.denominator <= 64
            && (self.meter.denominator & (self.meter.denominator - 1)) == 0
            && self.beat_unit.valid()
            && self.beat_unit.numerator > 0
            && self.beat_unit.denominator <= 64
            && (self.beat_unit.denominator & (self.beat_unit.denominator - 1)) == 0
            && self.phase_quarter_notes.valid()
            && i128::from(self.phase_quarter_notes.numerator) * i128::from(self.meter.denominator)
                < i128::from(self.meter.numerator)
                    * 4
                    * i128::from(self.phase_quarter_notes.denominator)
            && self.bar_number.is_none_or(|v| (0..=MAX_TICK).contains(&v))
            && self
                .confidence
                .is_none_or(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Point {
    pub id: String,
    pub source_tick: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downbeat: Option<bool>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grid {
    pub id: String,
    pub revision: u64,
    pub mode: String,
    pub asset_id: String,
    pub source_sha256: String,
    pub source_duration_tick: i64,
    pub review_reference: String,
    pub analysis_provenance: Option<Value>,
    pub points: Vec<Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub meter_segments: Vec<MeterSegment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual_bpm_provenance: Option<Value>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub id: String,
    pub grid_id: String,
    pub clip_id: String,
    pub asset_id: String,
    pub scene_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub version: u32,
    pub grids: Vec<Grid>,
    pub bindings: Vec<Binding>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            version: 1,
            grids: vec![],
            bindings: vec![],
        }
    }
}
pub fn text(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control)
}
pub fn points_valid(points: &[Point], duration: i64) -> bool {
    let mut ids = BTreeSet::new();
    !points.is_empty()
        && points.len() <= 100_000
        && points.iter().all(|p| {
            text(&p.id) && ids.insert(&p.id) && p.source_tick >= 0 && p.source_tick < duration
        })
        && points
            .windows(2)
            .all(|w| w[0].source_tick < w[1].source_tick)
}
impl State {
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = BTreeSet::new();
        if self.version != 1 || self.grids.len() > 1000 || self.bindings.len() > 10_000 {
            return Err("music-grid-state-invalid".into());
        }
        for grid in &self.grids {
            if grid.mode == "measured"
                && grid.analysis_provenance.as_ref().is_none_or(|p| {
                    p["inputSha256"] != grid.source_sha256
                        || p["review"]["status"] != "accepted"
                        || ["manifestSha256", "musicSha256", "envelopesSha256"]
                            .iter()
                            .any(|key| !p[key].as_str().is_some_and(crate::mv_audio::digest))
                })
            {
                return Err("music-grid-measured-provenance-invalid".into());
            }
            if !text(&grid.id)
                || !ids.insert(&grid.id)
                || grid.revision == 0
                || grid.revision > MAX_TICK as u64
                || !matches!(grid.mode.as_str(), "measured" | "manual")
                || !text(&grid.asset_id)
                || !crate::mv_audio::digest(&grid.source_sha256)
                || !text(&grid.review_reference)
                || grid.source_duration_tick <= 0
                || grid.source_duration_tick > MAX_TICK
                || !points_valid(&grid.points, grid.source_duration_tick)
                || grid.meter_segments.len() > 1000
                || !grid
                    .meter_segments
                    .iter()
                    .all(|s| s.validate(grid.source_duration_tick))
                || !grid
                    .meter_segments
                    .windows(2)
                    .all(|w| w[0].source_end_tick <= w[1].source_start_tick)
                || {
                    let mut ids = BTreeSet::new();
                    !grid.meter_segments.iter().all(|s| ids.insert(&s.id))
                }
                || grid.mode == "measured" && grid.analysis_provenance.is_none()
            {
                return Err("music-grid-invalid".into());
            }
            if let Some(provenance) = &grid.manual_bpm_provenance {
                let (points, segments) =
                    super::tempo::generate(provenance, grid.source_duration_tick)?;
                if grid.mode != "manual"
                    || serde_json::to_value(points).ok() != serde_json::to_value(&grid.points).ok()
                    || serde_json::to_value(segments).ok()
                        != serde_json::to_value(&grid.meter_segments).ok()
                {
                    return Err("music-grid-manual-bpm-provenance-invalid".into());
                }
            }
        }
        let mut bindings = BTreeSet::new();
        for binding in &self.bindings {
            if !text(&binding.id)
                || !bindings.insert(&binding.id)
                || !text(&binding.clip_id)
                || !text(&binding.scene_id)
                || !self
                    .grids
                    .iter()
                    .any(|g| g.id == binding.grid_id && g.asset_id == binding.asset_id)
            {
                return Err("music-grid-binding-invalid".into());
            }
        }
        Ok(())
    }
}
#[derive(Deserialize)]
pub struct Document {
    pub revision: u64,
    pub project: Value,
    pub tracks: Vec<Value>,
    pub clips: Vec<Value>,
    pub assets: Vec<Value>,
}
impl Document {
    pub fn state(&self) -> Result<State, String> {
        let state = match self.project.get("musicGridState") {
            Some(value) if !value.is_null() => {
                serde_json::from_value(value.clone()).map_err(|_| "music-grid-state-invalid")?
            }
            _ => State::default(),
        };
        state.validate()?;
        Ok(state)
    }
    pub fn revision(&self, expected: Option<u64>) -> Result<(), String> {
        if self.revision >= MAX_TICK as u64 || expected.is_some_and(|r| r != self.revision) {
            return Err("music-grid-native-revision-conflict".into());
        }
        Ok(())
    }
}
