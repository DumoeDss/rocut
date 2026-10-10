use super::{
    Sample,
    math::*,
    model::{Beats, Ink},
    plan::Operation,
};
pub(super) struct Clock {
    pub time: f64,
    pub quantized: f64,
    pub ink_time: f64,
    pub progress: f64,
}
impl Clock {
    pub fn new(a: &Ink, s: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("ink requires reviewed beat analysis")?
                    .beats
            }
        };
        if ticks.is_empty()
            || ticks.len() > 21600
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|v| *v > 2_592_000_000)
            || a.downbeat_index0 as usize >= ticks.len()
            || !a.bpm.is_finite()
            || !(1.0..=1000.0).contains(&a.bpm)
            || s.shot_start_ticks >= s.shot_end_ticks
            || s.song_ticks < s.shot_start_ticks
            || s.song_ticks > s.shot_end_ticks
        {
            return Err(
                "ink requires nonempty bounded whole-song beats and a valid shot clock".into(),
            );
        }
        let beats: Vec<_> = ticks.iter().map(|v| *v as f64 / 120000.0).collect();
        let time = s.song_ticks as f64 / 120000.0;
        let start = s.shot_start_ticks as f64 / 120000.0;
        let end = s.shot_end_ticks as f64 / 120000.0;
        let quantized = (time * 12.0 + 1e-6).floor() / 12.0;
        let idx = beats.partition_point(|v| *v <= start + 1e-4) as i64 - 1;
        let first = idx - i64::from(a.downbeat_index0) + 1;
        let mut steps = 0.0;
        for guard in 0..64 {
            let ordinal = first + guard + i64::from(a.downbeat_index0);
            let at = beats.get(ordinal as usize).copied().unwrap_or_else(|| {
                beats.last().unwrap() + (ordinal - beats.len() as i64 + 1) as f64 * (60.0 / a.bpm)
            });
            if at > quantized {
                break;
            }
            steps += expo(clamp((quantized - at) / 0.22));
        }
        let ink_time = (quantized - start) + 0.1 * steps;
        if !ink_time.is_finite() {
            return Err("ink beat-lurch produced nonfinite growth".into());
        }
        Ok(Self {
            time,
            quantized,
            ink_time,
            progress: (time - start) / (end - start),
        })
    }
    pub fn camera(&self) -> Vec<Operation> {
        let z = 1.0 + 0.06 * sine(self.progress);
        vec![
            Operation::Translate {
                offset: [960.0, 1080.0 * 0.52],
            },
            Operation::Scale { factors: [z, z] },
            Operation::Translate {
                offset: [-960.0, -1080.0 * 0.52],
            },
        ]
    }
}
