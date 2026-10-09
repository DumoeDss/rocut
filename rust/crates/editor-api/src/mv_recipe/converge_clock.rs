use super::{Sample, math::*, model::Beats};

pub(super) struct Clock {
    pub t: f64,
    pub start: f64,
    pub white: f64,
    pub u: f64,
    pub seed: f64,
    pub beats: Vec<f64>,
    pub pulse: f64,
}
impl Clock {
    pub fn new(a: &super::Converge, s: &Sample<'_>) -> Result<Self, String> {
        let source = match &a.beats {
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("Converge requires reviewed audio analysis")?
                    .beats
            }
            Beats::Manual { song_ticks } => song_ticks,
        };
        let t = s.song_ticks as f64 / 120_000.0;
        let start = s.shot_start_ticks as f64 / 120_000.0;
        let white = a.white_at_ticks as f64 / 120_000.0;
        let all: Vec<_> = source.iter().map(|b| *b as f64 / 120_000.0).collect();
        let i = all.partition_point(|b| *b < start - 0.05 - 0.04);
        let beats = (0..8)
            .map(|k| {
                all.get(i + k).copied().unwrap_or_else(|| {
                    all.last().copied().unwrap_or(start - 0.05)
                        + (i + k + 1 - all.len()) as f64 * 0.46
                })
            })
            .filter(|b| *b < white - 0.05)
            .collect();
        let last = all.partition_point(|b| *b <= t);
        let pulse = if last == 0 {
            0.0
        } else {
            (-8.0 * (t - all[last - 1])).exp()
        };
        Ok(Self {
            t,
            start,
            white,
            u: clamp((t - start) / (white - start)),
            seed: f64::from(a.seed.wrapping_add(s.seed)),
            beats,
            pulse,
        })
    }
    pub fn swirl(&self, t: f64) -> f64 {
        let mut k = 0.0;
        for b in &self.beats {
            k += 0.42 * out(seg(t, *b, 0.32));
        }
        let u = clamp((t - self.start) / (self.white - self.start));
        k + u * u * 2.2 + u * 0.8
    }
    pub fn spiral(&self, angle: f64, r: f64) -> f64 {
        angle + 0.95 * (1400.0 / (r + 26.0)).ln() * 1.6 + self.swirl(self.t)
    }
    pub fn kin(&self, i: f64, seed: f64, min: f64, max: f64, arrival: f64, t: f64) -> [f64; 4] {
        let r0 = lerp(min, max, rnd(i, seed));
        let th0 = rnd(i, seed + 1.0) * TAU;
        let s0 = -0.45 + 0.4 * rnd(i, seed + 2.0);
        let arr = lerp(arrival, 1.02, rnd(i, seed + 3.0).powf(0.6));
        let u = clamp((t - self.start) / (self.white - self.start));
        let v = clamp((u - s0) / (arr - s0));
        let r = r0 * (1.0 - cube(v) * 0.985) * (1.0 - 0.3 * v);
        let th = th0 + 0.95 * (r0 / (r + 26.0)).ln() * 1.6 + self.swirl(t);
        [960.0 + th.cos() * r, 540.0 + th.sin() * r * 0.9, r, v]
    }
}
