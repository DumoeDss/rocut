use serde::{Deserialize, Deserializer, Serialize};

pub const METHOD: &str = "reference-onset-residual-p99-v1";

/// Only reference onset times and residual intensities, not band/grid guesses.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrongOnsets {
    pub method: String,
    pub normalization_scale: f64,
    pub events: Vec<Onset>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Onset {
    pub at_ticks: u64,
    /// Upper-clipped residual/p99; negative residuals are intentionally retained.
    pub strength: f64,
}

impl StrongOnsets {
    pub fn validate(&self, duration: f64) -> Result<(), String> {
        if self.method != METHOD
            || !self.normalization_scale.is_finite()
            || (self.events.is_empty() && self.normalization_scale != 0.0)
            || (!self.events.is_empty() && self.normalization_scale <= 0.0)
            || self.events.len() > 520
        {
            return Err("Strong onsets require the reference method, at most 520 events, zero scale for empty evidence and finite positive p99 otherwise".into());
        }
        if self.events.iter().any(|event| {
            event.at_ticks as f64 / 120000.0 >= duration
                || !event.strength.is_finite()
                || event.strength > 1.0
        }) || self
            .events
            .windows(2)
            .any(|pair| pair[0].at_ticks >= pair[1].at_ticks)
        {
            return Err("Strong onsets require strictly increasing source ticks within duration and finite upper-clipped strengths <= 1".into());
        }
        Ok(())
    }
}

// Missing old field is None, but an explicitly supplied null is malformed.
pub fn deserialize_optional<'de, D>(deserializer: D) -> Result<Option<StrongOnsets>, D::Error>
where
    D: Deserializer<'de>,
{
    StrongOnsets::deserialize(deserializer).map(Some)
}

#[cfg(test)]
#[path = "onset_tests.rs"]
mod tests;
