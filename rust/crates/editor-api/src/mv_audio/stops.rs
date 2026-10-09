//! Reviewed stop evidence, never inferred from envelope samples. Source seconds
//! and authored order are retained: held-time consumers must not merge overlaps.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub const MAX_STOPS: usize = 4096;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopKind {
    Stop,
    Gap,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stop {
    pub kind: StopKind,
    pub start: f64,
    pub end: f64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "depth"
    )]
    pub depth_db: Option<f64>,
}

fn depth<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    f64::deserialize(d).map(Some)
}

pub fn deserialize_optional<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<Stop>>, D::Error> {
    Vec::<Stop>::deserialize(d).map(Some)
}

pub fn validate(events: &[Stop], duration: f64) -> Result<(), String> {
    if events.len() > MAX_STOPS
        || events.iter().any(|e| {
            !e.start.is_finite()
                || !e.end.is_finite()
                || e.start < 0.0
                || e.start >= e.end
                || e.end > duration
                || e.depth_db.is_some_and(|d| !d.is_finite())
        })
    {
        return Err("Stop evidence requires at most 4096 finite, positive-length source-second intervals within duration and finite optional depthDb".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceStop {
    kind: StopKind,
    start: f64,
    end: f64,
    #[serde(default, deserialize_with = "depth")]
    depth_db: Option<f64>,
}

pub fn from_music(music: &Value, duration: f64) -> Result<Option<Vec<Stop>>, String> {
    let Some(value) = music.get("stops") else {
        return Ok(None);
    };
    let events: Vec<SourceStop> = serde_json::from_value(value.clone())
        .map_err(|e| format!("Invalid reviewed stop evidence: {e}"))?;
    let events: Vec<Stop> = events
        .into_iter()
        .map(|e| Stop {
            kind: e.kind,
            start: e.start,
            end: e.end,
            depth_db: e.depth_db,
        })
        .collect();
    validate(&events, duration)?;
    Ok(Some(events))
}

#[cfg(test)]
#[path = "stop_tests.rs"]
mod tests;
