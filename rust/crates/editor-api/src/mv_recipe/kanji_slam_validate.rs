use super::model::*;
use crate::{
    mv_recipe::{
        model::{Color, Span},
        validate::range,
    },
    programmatic_resources::Resource,
};
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
}
fn color(c: &Color) -> bool {
    c.iter().all(|v| range(*v, 0.0, 1.0)) && c[3] == 1.0
}
impl KanjiSlam {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let end = u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(song_start));
        let a = self;
        let w = &a.wind;
        if !end.is_some_and(|end| end <= 2_592_000_000)
            || span.duration_frames == 0
            || !range(a.bpm, 1.0, 1000.0)
            || !(1..=8).contains(&a.glyphs.len())
            || a.glyphs.iter().any(|s| !text(s, 8))
            || a.glyphs.iter().map(|s| s.chars().count()).sum::<usize>() > 32
            || !range(a.char_x, -8192.0, 8192.0)
            || !range(a.char_y, -8192.0, 8192.0)
            || !range(a.char_h, 1.0, 8192.0)
            || !a.face.iter().all(|v| range(*v, 0.0, 1.0))
            || !color(&a.color)
            || !color(&a.rim)
            || !a.rim_off.iter().all(|v| range(*v, -128.0, 128.0))
            || !range(a.rim_a, 0.0, 1.0)
            || !range(a.halo_a, 0.0, 1.0)
            || !a.voice_dir.is_none_or(|v| range(v, -32.0, 32.0))
            || !range(w.from, 0.001, 0.999)
            || ![-1, 1].contains(&w.dir)
            || !range(w.amp, 0.0, 128.0)
            || !range(w.freq, 0.0, 32.0)
            || !range(w.speed, -64.0, 64.0)
            || !range(w.q, 1.0, 120.0)
            || !(1..=16).contains(&a.slots.len())
            || !(1..=16).contains(&a.frames.len())
            || a.slots.iter().any(|s| {
                !range(s.x, -8192.0, 8192.0)
                    || !range(s.y, -8192.0, 8192.0)
                    || !range(s.s, 0.01, 8.0)
                    || !range(s.r, -32.0, 32.0)
            })
            || a.frames.iter().any(|f| {
                !range(f.z, 0.01, 8.0)
                    || !range(f.dx, -8192.0, 8192.0)
                    || !range(f.dy, -8192.0, 8192.0)
            })
        {
            return false;
        }
        if let Beats::Manual { song_ticks } = &a.beats {
            if song_ticks.len() > 21600
                || song_ticks.iter().any(|t| *t > 2_592_000_000)
                || song_ticks.windows(2).any(|w| w[0] >= w[1])
                || a.downbeat_index0 as usize > song_ticks.len().saturating_sub(1)
            {
                return false;
            }
        }
        if a.sky == Sky::Day && a.bg.is_none() {
            a.sky_grad.as_ref().is_some_and(|s| {
                (2..=16).contains(&s.len())
                    && s.iter().all(|(k, c)| range(*k, 0.0, 1.0) && color(c))
                    && s.windows(2).all(|w| w[0].0 < w[1].0)
            })
        } else {
            a.sky_grad.is_none()
        }
    }
    pub(in crate::mv_recipe) fn resources_valid(&self, resources: &[Resource]) -> bool {
        let unique = |id: &str, kind: &str| {
            resources
                .iter()
                .filter(|r| r.id == id && r.kind == kind)
                .count()
                == 1
        };
        self.images().iter().all(|id| unique(id, "image"))
            && [&self.fonts.monument, &self.fonts.lyric, &self.fonts.counter]
                .iter()
                .all(|id| unique(id, "font"))
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
}
