use super::{
    Sample,
    math::clamp,
    model::{Beats, TitleRiff},
};

pub(super) struct Clock {
    pub beats: Vec<f64>,
    pub cues: [f64; 20],
    pub time: f64,
    pub end: f64,
    pub index: i64,
    pub beat: i64,
    pub bar: i64,
    pub in_bar: i64,
    pub phase: f64,
    pub pulse: f64,
}
impl Clock {
    pub fn new(a: &TitleRiff, s: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &s.analysis
                    .ok_or("titleRiff requires reviewed beat analysis")?
                    .beats
            }
        };
        if ticks.len() > 21600
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|t| *t > 2_592_000_000)
            || a.downbeat_index0 as usize > ticks.len().saturating_sub(1)
        {
            return Err(
                "titleRiff requires explicit ordered beats and a valid downbeat index".into(),
            );
        }
        let beats: Vec<_> = ticks.iter().map(|v| *v as f64 / 120_000.0).collect();
        let time = s.song_ticks as f64 / 120_000.0;
        let start = s.shot_start_ticks as f64 / 120_000.0;
        let first = beats.partition_point(|b| *b < start - 0.04);
        let cues = std::array::from_fn(|k| {
            beats.get(first + k).copied().unwrap_or_else(|| {
                beats.last().copied().unwrap_or(start) + (first + k + 1 - beats.len()) as f64 * 0.46
            })
        });
        let index = beats.partition_point(|b| *b <= time) as i64 - 1;
        let beat = index - i64::from(a.downbeat_index0);
        let (phase, pulse) = if index < 0 {
            (0.0, 0.0)
        } else {
            let from = beats[index as usize];
            let to = beats
                .get(index as usize + 1)
                .copied()
                .unwrap_or(from + 60.0 / a.bpm);
            (
                clamp((time - from) / (to - from)),
                (-9.0 * (time - from)).exp(),
            )
        };
        Ok(Self {
            beats,
            cues,
            time,
            end: s.shot_end_ticks as f64 / 120_000.0,
            index,
            beat,
            bar: beat.div_euclid(4),
            in_bar: beat.rem_euclid(4),
            phase,
            pulse,
        })
    }
    pub fn at(&self, cue: i8) -> f64 {
        if cue < 0 {
            1e9
        } else {
            self.cues[cue as usize]
        }
    }
    pub fn recap_index(&self) -> usize {
        self.cues
            .iter()
            .enumerate()
            .filter(|(_, b)| self.time >= **b - 0.02)
            .map(|(i, _)| i)
            .last()
            .unwrap_or(0)
    }
}
