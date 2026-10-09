use super::model::{Beats, Flame, Mode, Vocal};
use crate::{
    mv_recipe::{model::Span, validate::range},
    programmatic_resources::Resource,
};
impl Flame {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        end.is_some_and(|v| v <= 2_592_000_000)
            && span.duration_frames > 0
            && range(self.bpm, 1.0, 1000.0)
            && self.image().len() <= 240
            && !self.image().is_empty()
            && !self.image().chars().any(char::is_control)
            && range(self.zoom_to, 1.0, 64.0)
            && range(self.h, 1.0, 4096.0)
            && self
                .face_at
                .iter()
                .chain(self.face_pos.iter())
                .all(|v| range(*v, -8192.0, 8192.0))
            && self.flame_at.is_none_or(|v| {
                v.iter().all(|n| range(*n, 0.0, 8192.0)) && v[3] > 0.0 && v[4] > 0.0 && v[5] > 0.0
            })
            && self.zoom_at.is_none_or(|v| range(v, 0.0, 21600.0))
            && self.ignite_at.is_none_or(|v| range(v, 0.0, 21600.0))
            && self.stops.as_ref().is_none_or(|s| {
                s.len() <= 4096
                    && s.iter()
                        .all(|[a, b]| range(*a, 0.0, 21600.0) && range(*b, 0.0, 21600.0) && a < b)
            })
            && match &self.beats {
                Beats::Analysis {} => true,
                Beats::Manual { song_ticks } => {
                    song_ticks.len() <= 21600
                        && song_ticks.iter().all(|v| *v <= 2_592_000_000)
                        && song_ticks.windows(2).all(|v| v[0] < v[1])
                        && self.downbeat_index0 as usize <= song_ticks.len().saturating_sub(1)
                        && (!song_ticks.is_empty()
                            || self.mode == Mode::Dark
                            || self.mode == Mode::Breathe && self.zoom_at.is_some())
                }
            }
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, r: &[Resource]) -> bool {
        r.iter()
            .filter(|r| r.id == self.image() && r.kind == "image")
            .count()
            == 1
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
            || self.mode == Mode::Breathe && matches!(self.vocal, Vocal::Analysis)
    }
}
