use super::{MAX_BEATS, MAX_SAFE_TICKS, model::*};
use crate::mv_recipe::{model::Span, validate::color};

impl Converge {
    pub fn valid(&self, song_start_ticks: u64, span: &Span, step: u64) -> bool {
        let start = u64::from(span.start_frame)
            .checked_mul(step)
            .and_then(|n| n.checked_add(song_start_ticks));
        let p = &self.palette;
        start.is_some_and(|start| {
            self.white_at_ticks > start && self.white_at_ticks <= MAX_SAFE_TICKS
        }) && self.grain.is_finite()
            && (0.0..=1.0).contains(&self.grain)
            && p.background.iter().all(color)
            && [
                p.shadow,
                p.dusk,
                p.verm,
                p.sunset,
                p.glow,
                p.hi,
                p.core,
                p.shard.body,
                p.shard.rim,
                p.shard.edge,
                p.firefly.body,
                p.firefly.core,
                p.firefly.edge,
                p.white,
            ]
            .iter()
            .all(color)
            && match &self.beats {
                Beats::Analysis {} => true,
                Beats::Manual { song_ticks } => {
                    song_ticks.len() <= MAX_BEATS
                        && song_ticks.iter().all(|v| *v <= MAX_SAFE_TICKS)
                        && song_ticks.windows(2).all(|p| p[0] < p[1])
                }
            }
    }
    pub fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
    pub fn work(&self) -> u32 {
        // Bound every paint: 9*72*4 thread strokes + arms/rings/streaks,
        // shard fill/rim/facet/glint, 44 fireflies, 96 embers and all glows/white.
        3500 + if self.grain > 0.0 { 256 } else { 0 }
    }
    pub fn scratch_pixels(&self) -> u64 {
        if self.grain > 0.0 { 2 * 65_536 } else { 0 }
    }
    pub fn plan_pixels(&self) -> u64 {
        // Conservative paths/paint/gradient numeric-JSON and three-realm copies.
        u64::from(self.work()) * 512 + if self.grain > 0.0 { 9 * 65_536 } else { 0 }
    }
}
