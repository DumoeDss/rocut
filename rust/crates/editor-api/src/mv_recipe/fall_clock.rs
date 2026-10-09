use super::{
    Sample,
    math::*,
    model::{Beats, Fall},
    plan::Operation,
};
use crate::mv_audio::StopKind;

pub(super) struct Clock {
    pub time: f64,
    pub start: f64,
    pub held: f64,
    pub quantized: f64,
    pub held_end: f64,
    pub progress: f64,
    pub kick: f64,
    pub pulses: Vec<f64>,
    pub pulse: f64,
    pub beat: f64,
}
impl Clock {
    pub fn new(a: &Fall, sample: &Sample<'_>) -> Result<Self, String> {
        let beats = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &sample
                    .analysis
                    .ok_or("fall requires reviewed beat analysis")?
                    .beats
            }
        };
        if sample.shot_start_ticks >= sample.shot_end_ticks
            || sample.song_ticks < sample.shot_start_ticks
            || sample.song_ticks > sample.shot_end_ticks
            || sample.shot_end_ticks > 2_592_000_000
            || beats.len() > 21600
            || beats.windows(2).any(|v| v[0] >= v[1])
            || beats.iter().any(|v| *v > 2_592_000_000)
        {
            return Err("fall requires a bounded source clock and ordered whole-song beats".into());
        }
        let time = sample.song_ticks as f64 / 120000.0;
        let start = sample.shot_start_ticks as f64 / 120000.0;
        let end = sample.shot_end_ticks as f64 / 120000.0;
        let freeze: Vec<_> = match &a.freeze {
            Some(events) => events.clone(),
            None => sample
                .analysis
                .and_then(|v| v.stops.as_ref())
                .into_iter()
                .flatten()
                .filter(|v| v.kind == StopKind::Stop && v.end > start && v.start < end)
                .map(|v| [v.start, v.end])
                .collect(),
        };
        let effective = held(time, &freeze);
        let held_end = held(end, &freeze);
        let kick = freeze.first().map_or(-1e9, |v| held(v[1], &freeze));
        let pulses = a.pulse.clone().unwrap_or_else(|| {
            freeze
                .first()
                .map(|v| vec![v[1] - 0.04])
                .unwrap_or_default()
        });
        let pulse = pulses.iter().fold(0.0_f64, |m, pt| {
            m.max(if time >= *pt {
                (-(time - pt) * 3.0).exp()
            } else {
                0.0
            })
        });
        // Compare beat seconds, not rounded held ticks: overlapping freezes can
        // create negative/non-grid held time in the original binary64 clock.
        let index = beats.partition_point(|v| *v as f64 / 120000.0 <= effective);
        let since = if index == 0 {
            1e9
        } else {
            effective - beats[index - 1] as f64 / 120000.0
        };
        Ok(Self {
            time,
            start,
            held: effective,
            held_end,
            kick,
            pulses,
            pulse,
            quantized: (effective * 12.0 + 1e-6).floor() / 12.0,
            progress: clamp((effective - start) / (held_end - start).max(0.1)),
            beat: (-7.0 * since).exp(),
        })
    }
    pub fn speed(&self, multiplier: f64, time: f64) -> f64 {
        multiplier
            * (0.85
                + 0.3 * smooth(self.start + 0.6, self.start + 1.4, time)
                + if time > self.kick {
                    1.8 * (-(time - self.kick) * 2.4).exp()
                } else {
                    0.0
                }
                + 0.8 * smooth(self.held_end - 0.9, self.held_end, time))
    }
    pub fn distance(&self, multiplier: f64) -> f64 {
        let dt: f64 = 1.0 / 120.0;
        let (mut tau, mut distance) = (self.start, 0.0);
        // Preserve original repeated binary64 addition and fractional last h.
        // Do not replace with integer-index time, a closed form or state cache.
        while tau < self.held - 1e-9 {
            let h = dt.min(self.held - tau);
            distance += h * self.speed(multiplier, tau + h / 2.0);
            tau += dt;
        }
        distance
    }
    pub fn camera(&self) -> Vec<Operation> {
        let ease = sine(self.progress);
        let rot = -0.05 + 0.08 * ease + 0.016 * (self.held * 0.9 + 1.0).sin();
        let zoom = 1.0 + 0.07 * ease;
        vec![
            Operation::Translate {
                offset: [960.0, 540.0],
            },
            Operation::Rotate { radians: rot },
            Operation::Scale {
                factors: [zoom, zoom],
            },
            Operation::Translate {
                offset: [-960.0, -540.0],
            },
        ]
    }
}
pub(super) fn held(t: f64, events: &[[f64; 2]]) -> f64 {
    let mut removed = 0.0;
    for [a, b] in events {
        removed += (t - a).clamp(0.0, b - a);
    }
    t - removed
}
