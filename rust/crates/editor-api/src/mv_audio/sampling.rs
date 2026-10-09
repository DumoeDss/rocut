use super::Data;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    MixRms,
    LowPower,
    MidPower,
    HighPower,
    VocalRms,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Clock {
    Song,
    Source,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Missing {
    Zero,
    Error,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Signal {
    Envelope {
        channel: Channel,
        clock: Clock,
        missing: Missing,
    },
    BeatPulse {
        decay: f64,
        clock: Clock,
        missing: Missing,
    },
    BarPulse {
        decay: f64,
        clock: Clock,
        missing: Missing,
    },
}
impl Signal {
    pub fn valid(&self) -> bool {
        match self {
            Self::Envelope { .. } => true,
            Self::BeatPulse { decay, .. } | Self::BarPulse { decay, .. } => {
                decay.is_finite() && (0.01..=100.0).contains(decay)
            }
        }
    }
    pub fn sample(&self, data: Option<&Data>, song: f64, source: f64) -> Result<f64, String> {
        let (clock, missing) = match self {
            Self::Envelope { clock, missing, .. }
            | Self::BeatPulse { clock, missing, .. }
            | Self::BarPulse { clock, missing, .. } => (*clock, *missing),
        };
        let seconds = match clock {
            Clock::Song => song,
            Clock::Source => source,
        };
        let ticks = (seconds * 120000.0).round() as u64;
        let value = data
            .filter(|d| seconds >= 0.0 && seconds < d.duration)
            .and_then(|d| match self {
                Self::Envelope { channel, .. } => d.channels.get(channel).map(|values| {
                    let n = ticks * u64::from(d.fps);
                    let a = (n / 120000) as usize;
                    let first = values[a.min(values.len() - 1)];
                    let next = values[(a + 1).min(values.len() - 1)];
                    first + (next - first) * (n % 120000) as f64 / 120000.0
                }),
                Self::BeatPulse { decay, .. } => pulse(&d.beats, ticks, *decay),
                Self::BarPulse { decay, .. } => pulse(&d.downbeats, ticks, *decay),
            });
        match (value, missing) {
            (Some(v), _) => Ok(v),
            (None, Missing::Zero) => Ok(0.0),
            (None, Missing::Error) => {
                Err("Requested audio signal unavailable at this song/source time".into())
            }
        }
    }
}
fn pulse(points: &[u64], time: u64, decay: f64) -> Option<f64> {
    let next = points.partition_point(|p| *p <= time);
    if next == 0 || next >= points.len() {
        return None;
    }
    // Real intervals only. No fixed BPM, no pulse invented after the last beat.
    let phase = (time - points[next - 1]) as f64 / (points[next] - points[next - 1]) as f64;
    Some((-decay * phase).exp())
}
