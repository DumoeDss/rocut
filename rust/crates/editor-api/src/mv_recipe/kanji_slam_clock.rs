use super::{
    Sample,
    math::clamp,
    model::{Beats, KanjiSlam},
};

pub(super) struct Clock {
    pub time: f64,
    pub local: f64,
    pub duration: f64,
    pub progress: f64,
    pub shot_beats: Vec<f64>,
    pub hit: usize,
    pub elapsed: f64,
    pub next: f64,
    pub since: f64,
}
impl Clock {
    pub fn new(a: &KanjiSlam, sample: &Sample<'_>) -> Result<Self, String> {
        let ticks = match &a.beats {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis {} => {
                &sample
                    .analysis
                    .ok_or("kanjiSlam requires reviewed beat analysis")?
                    .beats
            }
        };
        if ticks.len() > 21600
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|t| *t > 2_592_000_000)
            || a.downbeat_index0 as usize > ticks.len().saturating_sub(1)
            || !a.bpm.is_finite()
            || !(1.0..=1000.0).contains(&a.bpm)
            || sample.shot_start_ticks >= sample.shot_end_ticks
            || sample.song_ticks < sample.shot_start_ticks
            || sample.song_ticks > sample.shot_end_ticks
        {
            return Err(
                "kanjiSlam requires bounded whole-song beats and a valid shot clock".into(),
            );
        }
        let time = sample.song_ticks as f64 / 120_000.0;
        let start = sample.shot_start_ticks as f64 / 120_000.0;
        let end = sample.shot_end_ticks as f64 / 120_000.0;
        let beats: Vec<_> = ticks.iter().map(|t| *t as f64 / 120_000.0).collect();
        // Keep floating source comparisons after tick conversion. Rounding the
        // tolerance to frame indices would change authored ±45 ms boundaries.
        let mut shot_beats: Vec<_> = beats
            .iter()
            .copied()
            .filter(|b| *b >= start - 0.045 && *b < end - 0.045)
            .collect();
        if shot_beats.first().is_none_or(|b| *b > start + 0.045) {
            shot_beats.insert(0, start);
        } else {
            shot_beats[0] = shot_beats[0].min(start);
        }
        let hit = shot_beats
            .partition_point(|b| *b <= time + 1e-6)
            .saturating_sub(1);
        let elapsed = time - shot_beats[hit];
        let next = shot_beats.get(hit + 1).copied().unwrap_or(end);
        let song_index = beats.partition_point(|b| *b <= time);
        let since = if song_index == 0 {
            1e9
        } else {
            time - beats[song_index - 1]
        };
        Ok(Self {
            time,
            local: time - start,
            duration: end - start,
            progress: clamp((time - start) / (end - start)),
            shot_beats,
            hit,
            elapsed,
            next,
            since,
        })
    }
    pub fn pulse(&self, decay: f64) -> f64 {
        (-decay * self.since).exp()
    }
    pub fn anticipation(&self) -> f64 {
        let k = clamp((self.time - (self.next - 2.0 / 30.0)) / (2.0 / 30.0));
        k * k
    }
}
