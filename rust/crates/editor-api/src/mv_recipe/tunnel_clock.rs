use super::{
    Sample,
    math::*,
    model::{Beats, Tunnel},
};
pub(super) struct Clock {
    pub t: f64,
    pub lt: f64,
    pub start: f64,
    pub end: f64,
    pub dur: f64,
    pub beats: Vec<f64>,
    pub downbeat: i64,
}
impl Clock {
    pub fn new(a: &Tunnel, s: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("tunnel requires reviewed beat analysis")?
                    .beats
            }
        };
        if ticks.is_empty()
            || ticks.len() > 21600
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|t| *t > 2_592_000_000)
            || a.downbeat_index0 as usize >= ticks.len()
            || s.shot_start_ticks >= s.shot_end_ticks
            || s.shot_end_ticks > 2_592_000_000
            || s.song_ticks < s.shot_start_ticks
            || s.song_ticks > s.shot_end_ticks
        {
            return Err("tunnel invalid whole-song beat/shot clock".into());
        }
        let start = s.shot_start_ticks as f64 / 120000.0;
        let end = s.shot_end_ticks as f64 / 120000.0;
        let t = s.song_ticks as f64 / 120000.0;
        Ok(Self {
            t,
            lt: t - start,
            start,
            end,
            dur: end - start,
            beats: ticks.iter().map(|t| *t as f64 / 120000.0).collect(),
            downbeat: a.downbeat_index0 as i64,
        })
    }
    pub fn index(&self, t: f64) -> i64 {
        self.beats.partition_point(|b| *b <= t) as i64 - 1
    }
    pub fn beat(&self, t: f64) -> i64 {
        self.index(t) - self.downbeat
    }
    pub fn in_bar(&self, t: f64) -> i64 {
        self.beat(t).rem_euclid(4)
    }
    pub fn since(&self, t: f64) -> f64 {
        let i = self.index(t);
        if i < 0 {
            1e9
        } else {
            t - self.beats[i as usize]
        }
    }
    pub fn pulse(&self, k: f64) -> f64 {
        (-k * self.since(self.t)).exp()
    }
    pub fn down_pulse(&self, k: f64) -> f64 {
        if self.in_bar(self.t) == 0 {
            self.pulse(k)
        } else {
            0.0
        }
    }
    pub fn roll(&self) -> f64 {
        0.09 * self.lt
            + 0.035 * (self.lt * 1.7).sin()
            + 0.05
                * damp(self.since(self.t))
                * if self.in_bar(self.t) % 2 != 0 {
                    1.0
                } else {
                    -1.0
                }
    }
}
