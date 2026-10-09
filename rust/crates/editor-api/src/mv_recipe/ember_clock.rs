use super::{Sample, model::*};
use crate::mv_audio::Channel;

pub(super) fn seconds(ticks: u64) -> f64 {
    ticks as f64 / 120_000.0
}
pub(super) fn beats(source: &Beats, s: &Sample<'_>) -> Result<Vec<f64>, String> {
    let ticks = match source {
        Beats::Manual { song_ticks } => song_ticks,
        Beats::Analysis {} => {
            &s.analysis
                .ok_or("Ember requires reviewed audio analysis")?
                .beats
        }
    };
    Ok(ticks.iter().map(|v| seconds(*v)).collect())
}
pub(super) fn from(all: &[f64], start: f64, count: usize) -> Vec<f64> {
    let index = all.partition_point(|b| *b < start - 0.04);
    (0..count)
        .map(|k| {
            all.get(index + k).copied().unwrap_or_else(|| {
                all.last().copied().unwrap_or(start) + (index + k + 1 - all.len()) as f64 * 0.46
            })
        })
        .collect()
}
pub(super) fn last_before(all: &[f64], end: f64) -> f64 {
    all.iter()
        .copied()
        .take_while(|beat| *beat < end - 0.05)
        .last()
        .unwrap_or(end - 0.46)
}
pub(super) fn pulse(all: &[f64], t: f64, k: f64) -> f64 {
    let index = all.partition_point(|b| *b <= t);
    if index == 0 {
        0.0
    } else {
        (-k * (t - all[index - 1])).exp()
    }
}
pub(super) fn in_stops(stops: &[[u64; 2]], t: f64) -> bool {
    stops
        .iter()
        .any(|[a, b]| t >= seconds(*a) && t < seconds(*b))
}
pub(super) struct Envelope {
    pub rms: f64,
    pub low: f64,
    pub mid: f64,
    pub vocal: f64,
}
impl Envelope {
    pub fn sample(s: &Sample<'_>) -> Result<Self, String> {
        let data = s
            .analysis
            .ok_or("Ember breathe/ignite require measured audio envelopes")?;
        let time = seconds(s.song_ticks);
        let get = |channel| data.sample_envelope_clamped(channel, time);
        Ok(Self {
            rms: get(Channel::MixRms)?,
            low: get(Channel::LowPower)?,
            mid: get(Channel::MidPower)?,
            vocal: if data.channels.contains_key(&Channel::VocalRms) {
                get(Channel::VocalRms)?
            } else {
                0.0
            },
        })
    }
}
