//! Reviewed Creator analysis, not a second audio analyzer. Portable project data.
mod clamped;
mod import;
mod onset_import;
mod onsets;
mod sampling;
mod stops;
pub use import::prepare_mv_audio_json;
pub use onsets::StrongOnsets;
pub use sampling::{Channel, Signal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub use stops::{Stop, StopKind};

pub const SCHEMA: &str = "rocut-mv-audio/1";
pub const CREATOR_SCHEMA: &str = "creator-mv-audio/1";
pub fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub status: String,
    pub reference: String,
}
impl Review {
    fn valid(&self) -> bool {
        self.status == "accepted"
            && !self.reference.trim().is_empty()
            && self.reference.len() <= 1024
            && !self.reference.chars().any(char::is_control)
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub schema: String,
    pub input_sha256: String,
    pub vocal_sha256: Option<String>,
    pub manifest_sha256: String,
    pub music_sha256: String,
    pub envelopes_sha256: String,
    pub review: Review,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Data {
    pub schema: String,
    pub provenance: Provenance,
    pub duration: f64,
    pub fps: u32,
    pub beats: Vec<u64>,
    pub downbeats: Vec<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "onsets::deserialize_optional"
    )]
    pub strong_onsets: Option<StrongOnsets>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "stops::deserialize_optional"
    )]
    pub stops: Option<Vec<Stop>>,
    pub channels: BTreeMap<Channel, Vec<f64>>,
    pub scales: BTreeMap<Channel, f64>,
}
impl Data {
    pub fn validate(&self) -> Result<(), String> {
        let p = &self.provenance;
        if self.schema != SCHEMA
            || p.schema != CREATOR_SCHEMA
            || !p.review.valid()
            || ![
                &p.input_sha256,
                &p.manifest_sha256,
                &p.music_sha256,
                &p.envelopes_sha256,
            ]
            .into_iter()
            .all(|s| digest(s))
            || p.vocal_sha256.as_ref().is_some_and(|s| !digest(s))
        {
            return Err("Audio analysis requires valid provenance and an explicit accepted review reference".into());
        }
        if !self.duration.is_finite()
            || !(0.1..=1800.0).contains(&self.duration)
            || !(1..=120).contains(&self.fps)
        {
            return Err("Analysis requires 0.1..1800 source seconds and 1..120 fps".into());
        }
        let frames = (self.duration * f64::from(self.fps)).ceil() as usize;
        for channel in [
            Channel::MixRms,
            Channel::LowPower,
            Channel::MidPower,
            Channel::HighPower,
        ] {
            if !self.channels.contains_key(&channel) {
                return Err("Required measured analysis channel missing".into());
            }
        }
        if self.channels.contains_key(&Channel::VocalRms) != p.vocal_sha256.is_some()
            || self.channels.keys().ne(self.scales.keys())
        {
            return Err(
                "Analysis channels must match their normalization scales and vocal provenance"
                    .into(),
            );
        }
        for (channel, values) in &self.channels {
            if values.len() != frames
                || values
                    .iter()
                    .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
                || !self.scales[channel].is_finite()
                || self.scales[channel] < 0.0
                || (self.scales[channel] == 0.0 && values.iter().any(|v| *v != 0.0))
            {
                return Err("Analysis channels require equal ceil(duration*fps) normalized samples and finite scales".into());
            }
        }
        for points in [&self.beats, &self.downbeats] {
            if points.len() > 21600
                || points.iter().any(|t| *t as f64 / 120000.0 >= self.duration)
                || points.windows(2).any(|p| p[0] >= p[1])
            {
                return Err("Audio points must be bounded, strictly increasing source ticks within duration".into());
            }
        }
        if self
            .downbeats
            .iter()
            .any(|p| self.beats.binary_search(p).is_err())
        {
            return Err("Downbeats must belong to measured/reviewed beats".into());
        }
        if let Some(onsets) = &self.strong_onsets {
            onsets.validate(self.duration)?;
        }
        if let Some(stops) = &self.stops {
            stops::validate(stops, self.duration)?;
        }
        Ok(())
    }
}
