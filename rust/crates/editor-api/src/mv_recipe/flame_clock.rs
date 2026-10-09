use super::{
    Sample,
    math::*,
    model::{Beats, Flame, Mode, Vocal},
};
use crate::mv_audio::{Channel, StopKind};
pub(super) struct Clock {
    pub t: f64,
    pub start: f64,
    pub end: f64,
    pub p: f64,
    pub tq: f64,
    pub spb: f64,
    pub stops: Vec<[f64; 2]>,
    pub zoom: f64,
    pub ignite: f64,
    pub vocal: f64,
    beats: Vec<f64>,
    downbeat: i64,
}
impl Clock {
    pub fn new(a: &Flame, s: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("flame requires reviewed beat analysis")?
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
            return Err("flame requires bounded whole-song beats and a valid shot clock".into());
        }
        let t = s.song_ticks as f64 / 120000.0;
        let start = s.shot_start_ticks as f64 / 120000.0;
        let end = s.shot_end_ticks as f64 / 120000.0;
        let global = |left: f64, right: f64| -> Vec<[f64; 2]> {
            s.analysis
                .and_then(|d| d.stops.as_ref())
                .into_iter()
                .flatten()
                .filter(|v| v.kind == StopKind::Stop && v.end > left && v.start < right)
                .map(|v| [v.start, v.end])
                .collect()
        };
        let stops = a.stops.clone().unwrap_or_else(|| global(start, end));
        // Dark ignition derives from GLOBAL stops even when a.stops is explicit.
        let ignite = a.ignite_at.unwrap_or_else(|| {
            global(start - 0.05, start + 0.3)
                .into_iter()
                .find(|v| v[0] <= start + 0.1)
                .map_or(start + 0.12, |v| v[1])
        });
        let beats: Vec<f64> = ticks.iter().map(|v| *v as f64 / 120000.0).collect();
        let mut c = Self {
            t,
            start,
            end,
            p: inv(start, end, t),
            tq: (t * 12.0 + 1e-6).floor() / 12.0,
            spb: 60.0 / a.bpm,
            stops,
            zoom: 0.0,
            ignite,
            vocal: 0.0,
            beats,
            downbeat: i64::from(a.downbeat_index0),
        };
        c.zoom = match a.zoom_at {
            Some(v) => v,
            None if a.mode == Mode::Breathe => c.at(c.beat(end - 0.06))?,
            None => end,
        };
        if a.mode == Mode::Breathe {
            if c.zoom == start || c.zoom == end || c.zoom + 0.1 == end {
                return Err("flame breathe requires nondegenerate zoom intervals".into());
            }
            c.vocal = match a.vocal {
                Vocal::Zero => 0.0,
                Vocal::Analysis => s
                    .analysis
                    .ok_or("flame breathe requires vocal analysis or explicit vocal=zero")?
                    .sample_envelope_clamped(Channel::VocalRms, t)?,
            };
        }
        Ok(c)
    }
    pub fn beat(&self, t: f64) -> i64 {
        self.beats.partition_point(|v| *v <= t) as i64 - 1 - self.downbeat
    }
    pub fn at(&self, k: i64) -> Result<f64, String> {
        let i = k + self.downbeat;
        let measured = if i < 0 {
            None
        } else {
            self.beats.get(i as usize).copied()
        };
        measured
            .or_else(|| {
                self.beats
                    .last()
                    .map(|v| v + (i - self.beats.len() as i64 + 1) as f64 * self.spb)
            })
            .ok_or_else(|| "flame beat clock has no measured anchor".into())
    }
    pub fn pulse(&self, t: f64, decay: f64) -> f64 {
        let i = self.beats.partition_point(|v| *v <= t);
        let since = if i == 0 { 1e9 } else { t - self.beats[i - 1] };
        (-decay * since).exp()
    }
    pub fn down(&self, t: f64, decay: f64) -> f64 {
        if self.beat(t).rem_euclid(4) == 0 {
            self.pulse(t, decay)
        } else {
            0.0
        }
    }
    pub fn steps(&self, start: f64, t: f64, len: f64) -> Result<f64, String> {
        let mut sum = 0.0;
        let first = self.beat(start + 1e-4) + 1;
        for guard in 0..64 {
            let at = self.at(first + guard)?;
            if at > t {
                break;
            }
            sum += expo(clamp((t - at) / len));
        }
        Ok(sum)
    }
}
