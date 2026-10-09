use super::{
    Sample,
    model::{Beats, Thread},
};
use crate::mv_audio::StopKind;

pub(super) struct Clock {
    pub time: f64,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub held: f64,
    pub quantized: f64,
    pub kick: f64,
    pub arrive: f64,
    beats: Vec<f64>,
    downbeat: i64,
}
impl Clock {
    pub fn new(a: &Thread, s: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("thread requires reviewed beat analysis")?
                    .beats
            }
        };
        if ticks.len() > 21600
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|t| *t > 2_592_000_000)
            || a.downbeat_index0 as usize > ticks.len().saturating_sub(1)
            || !a.bpm.is_finite()
            || !(1.0..=1000.0).contains(&a.bpm)
            || s.shot_start_ticks >= s.shot_end_ticks
            || s.song_ticks < s.shot_start_ticks
            || s.song_ticks > s.shot_end_ticks
        {
            return Err("thread requires bounded whole-song beats and a valid shot clock".into());
        }
        let time = s.song_ticks as f64 / 120000.0;
        let start = s.shot_start_ticks as f64 / 120000.0;
        let end = s.shot_end_ticks as f64 / 120000.0;
        let stops = match &a.stops {
            Some(stops) => stops.clone(),
            None => s
                .analysis
                .and_then(|d| d.stops.as_ref())
                .into_iter()
                .flatten()
                .filter(|v| v.kind == StopKind::Stop && v.end > start && v.start < end)
                .map(|v| [v.start, v.end])
                .collect(),
        };
        let held = held(time, &stops);
        let kick = a
            .kick_at
            .unwrap_or_else(|| stops.last().map_or(start + (end - start) * 0.74, |s| s[1]));
        let beats: Vec<_> = ticks.iter().map(|v| *v as f64 / 120000.0).collect();
        // clock.at(clock.beat(kick)+1) cancels the downbeat offset. Empty beats
        // have no fallback anchor in the original; require an authored arrival.
        let next = beats.partition_point(|v| *v <= kick);
        let arrive = if let Some(arrive) = a.arrive_at {
            arrive
        } else {
            let at = beats
                .get(next)
                .copied()
                .or_else(|| beats.last().map(|v| v + 60.0 / a.bpm))
                .ok_or(
                    "thread with empty beats requires explicit arriveAt; no beat is fabricated",
                )?;
            (kick + 0.2).max(at)
        };
        if !held.is_finite()
            || !kick.is_finite()
            || !arrive.is_finite()
            || kick - 0.12 == start + 0.06
            || arrive == kick
        {
            return Err(
                "thread requires finite, nondegenerate growth and arrival intervals".into(),
            );
        }
        Ok(Self {
            time,
            start,
            end,
            duration: end - start,
            held,
            quantized: (held * 12.0 + 1e-6).floor() / 12.0,
            kick,
            arrive,
            beats,
            downbeat: i64::from(a.downbeat_index0),
        })
    }
    pub fn pulse(&self, t: f64, decay: f64) -> f64 {
        let index = self.beats.partition_point(|v| *v <= t);
        let since = if index == 0 {
            1e9
        } else {
            t - self.beats[index - 1]
        };
        (-decay * since).exp()
    }
    pub fn down_pulse(&self, t: f64, decay: f64) -> f64 {
        let beat = self.beats.partition_point(|v| *v <= t) as i64 - 1 - self.downbeat;
        if beat.rem_euclid(4) == 0 {
            self.pulse(t, decay)
        } else {
            0.0
        }
    }
}
pub(super) fn held(t: f64, stops: &[[f64; 2]]) -> f64 {
    let mut removed = 0.0;
    for [a, b] in stops {
        removed += (t - a).clamp(0.0, b - a);
    }
    t - removed
}
