use super::model::{Beats, Fall};
use crate::{
    mv_recipe::{model::Span, validate::range},
    programmatic_resources::Resource,
};
impl Fall {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        end.is_some_and(|v| v <= 2_592_000_000)
            && span.duration_frames > 0
            && !self.image.is_empty()
            && self.image.len() <= 128
            && !self.image.chars().any(char::is_control)
            && self.vp.iter().all(|v| range(*v, -8192.0, 8192.0))
            && range(self.speed, 0.0, 8.0)
            && range(self.h, 1.0, 8192.0)
            && self.freeze.as_ref().is_none_or(|events| {
                events.len() <= 4096
                    && events
                        .iter()
                        .all(|[a, b]| range(*a, 0.0, 21600.0) && range(*b, 0.0, 21600.0) && a < b)
            })
            && self.pulse.as_ref().is_none_or(|events| {
                events.len() <= 64 && events.iter().all(|v| range(*v, 0.0, 21600.0))
            })
            && match &self.beats {
                Beats::Analysis {} => true,
                Beats::Manual { song_ticks } => {
                    song_ticks.len() <= 21600
                        && song_ticks.iter().all(|v| *v <= 2_592_000_000)
                        && song_ticks.windows(2).all(|v| v[0] < v[1])
                }
            }
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, resources: &[Resource]) -> bool {
        resources
            .iter()
            .filter(|r| r.id == self.image && r.kind == "image")
            .count()
            == 1
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
}
