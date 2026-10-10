use super::model::{Beats, Ink};
use crate::{
    mv_recipe::{model::Span, validate::range},
    programmatic_resources::Resource,
};
impl Ink {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        if span.duration_frames == 0
            || !end.is_some_and(|v| v <= 2_592_000_000)
            || self.char.is_empty()
            || self.char.len() > 128
            || self.char.chars().any(char::is_control)
            || !range(self.h, 1., 8192.)
            || !range(self.x, -8192., 8192.)
            || !range(self.y, -8192., 8192.)
            || !range(self.bpm, 1., 1000.)
        {
            return false;
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.is_empty()
                || song_ticks.len() > 21600
                || song_ticks.iter().any(|v| *v > 2_592_000_000)
                || song_ticks.windows(2).any(|v| v[0] >= v[1])
                || self.downbeat_index0 as usize >= song_ticks.len()
            {
                return false;
            }
        }
        true
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, resources: &[Resource]) -> bool {
        resources
            .iter()
            .filter(|r| r.id == self.char && r.kind == "image")
            .count()
            == 1
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
}
