use super::onsets::{Onset, StrongOnsets};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceFacts {
    method: String,
    normalization_scale: f64,
    events: Vec<SourceEvent>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceEvent {
    time: f64,
    strength: f64,
}

pub fn from_music(music: &Value, duration: f64) -> Result<Option<StrongOnsets>, String> {
    let Some(value) = music.get("strong_onsets") else {
        return Ok(None);
    };
    let facts: SourceFacts = serde_json::from_value(value.clone())
        .map_err(|e| format!("Invalid reference strong-onset evidence: {e}"))?;
    let events = facts
        .events
        .into_iter()
        .map(|event| {
            if !event.time.is_finite() || event.time < 0.0 || event.time >= duration {
                return Err("Strong onset must occur within source-audio duration".to_string());
            }
            Ok(Onset {
                at_ticks: (event.time * 120000.0).round() as u64,
                strength: event.strength,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let facts = StrongOnsets {
        method: facts.method,
        normalization_scale: facts.normalization_scale,
        events,
    };
    facts.validate(duration)?;
    Ok(Some(facts))
}
