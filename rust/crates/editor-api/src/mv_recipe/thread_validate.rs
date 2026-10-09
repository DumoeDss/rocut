use super::model::{Beats, Thread};
use crate::{
    mv_recipe::{model::Span, validate::range},
    programmatic_resources::Resource,
};
impl Thread {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        if !end.is_some_and(|v| v <= 2_592_000_000)
            || span.duration_frames == 0
            || !range(self.bpm, 1.0, 1000.0)
            || self.hand.is_empty()
            || self.hand.len() > 128
            || self.hand.chars().any(char::is_control)
            || !self.light.iter().all(|v| range(*v, -8192.0, 8192.0))
            || !range(self.hand_rot, -32.0, 32.0)
            || !range(self.hand_h, 1.0, 8192.0)
            || !range(self.hand_x, -8192.0, 8192.0)
            || !range(self.hand_y, -8192.0, 8192.0)
            || !self.kick_at.is_none_or(|v| range(v, 0.0, 21600.0))
            || !self.arrive_at.is_none_or(|v| range(v, 0.0, 21600.0))
            || !self.stops.as_ref().is_none_or(|stops| {
                stops.len() <= 4096
                    && stops
                        .iter()
                        .all(|[a, b]| range(*a, 0.0, 21600.0) && range(*b, 0.0, 21600.0) && a < b)
            })
        {
            return false;
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.len() > 21600
                || song_ticks.iter().any(|v| *v > 2_592_000_000)
                || song_ticks.windows(2).any(|p| p[0] >= p[1])
                || self.downbeat_index0 as usize > song_ticks.len().saturating_sub(1)
                || song_ticks.is_empty() && self.arrive_at.is_none()
            {
                return false;
            }
        }
        true
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, resources: &[Resource]) -> bool {
        resources
            .iter()
            .filter(|r| r.id == self.hand && r.kind == "image")
            .count()
            == 1
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
}
