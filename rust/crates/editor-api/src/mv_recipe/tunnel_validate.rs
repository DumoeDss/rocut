use super::model::{Beats, Metrics, Tunnel};
use crate::{mv_recipe::model::Span, programmatic_resources::Resource};
impl Tunnel {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        if self.validate().is_err()
            || step == 0
            || span.duration_frames == 0
            || !end.is_some_and(|v| v <= 2_592_000_000)
        {
            return false;
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.is_empty()
                || song_ticks.len() > 21600
                || song_ticks.windows(2).any(|p| p[0] >= p[1])
                || song_ticks.iter().any(|v| *v > 2_592_000_000)
                || self.downbeat_index0 as usize >= song_ticks.len()
            {
                return false;
            }
        }
        true
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, resources: &[Resource]) -> bool {
        [
            &self.fonts.mincho800,
            &self.fonts.dot400,
            &self.fonts.heavy900,
            &self.fonts.noto400,
            &self.fonts.noto800,
            &self.fonts.noto900,
        ]
        .iter()
        .all(|id| {
            resources
                .iter()
                .filter(|r| &r.id == *id && r.kind == "font")
                .count()
                == 1
        }) && self.reveal.as_ref().is_none_or(|id| {
            resources
                .iter()
                .filter(|r| r.id == *id && r.kind == "image")
                .count()
                == 1
        })
    }
}
impl Metrics {
    pub(super) fn validate(&self) -> Result<(), String> {
        for map in [&self.mincho_800, &self.dot_400] {
            if map.len() > 2048
                || map.iter().any(|(key, v)| {
                    key.chars().count() != 1 || !v.is_finite() || !(0.0..=4096.0).contains(v)
                })
            {
                return Err("tunnel native metric admission failed".into());
            }
        }
        Ok(())
    }
}
