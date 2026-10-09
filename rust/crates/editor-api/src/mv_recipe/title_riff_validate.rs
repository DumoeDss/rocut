use super::model::*;
use crate::{
    mv_recipe::{model::Span, validate::range},
    programmatic_resources::Resource,
};

fn text(value: &str, max: usize, empty: bool) -> bool {
    (empty || !value.is_empty())
        && value.chars().count() <= max
        && !value.chars().any(char::is_control)
}
impl TitleRiff {
    pub(in crate::mv_recipe) fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let start = u64::from(span.start_frame)
            .checked_mul(step)
            .and_then(|v| v.checked_add(song_start));
        let end = start.and_then(|v| {
            u64::from(span.duration_frames)
                .checked_mul(step)
                .and_then(|d| v.checked_add(d))
        });
        let c = self.cues;
        if !start
            .zip(end)
            .is_some_and(|(start, end)| start < end && end <= 2_592_000_000)
            || !range(self.bpm, 0.01, 1000.0)
            || !range(self.grain, 0.0, 1.0)
            || !text(&self.credit, 128, true)
            || !text(&self.sub, 128, true)
            || !self.glyphs.iter().all(|v| text(v, 32, false))
            || ![
                &self.hud.title,
                &self.hud.when,
                &self.hud.bpm,
                &self.hud.geo,
                &self.hud.place,
                &self.hud.len,
            ]
            .iter()
            .all(|v| text(v, 256, true))
            || ![
                c.sun, c.hud, c.hud2, c.zan, c.cross, c.ko, c.split, c.lock, c.exit,
            ]
            .iter()
            .all(|k| (0..20).contains(k))
            || !(-1..20).contains(&c.neg)
            || !(-1..20).contains(&c.sil)
            || c.lock >= c.exit
            || c.sil >= c.lock
        {
            return false;
        }
        if !match &self.ruby {
            Ruby::Disabled(v) => !v,
            Ruby::Pair(pair) => pair.iter().all(|s| text(s, 32, true)),
        } {
            return false;
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.len() > 21600
                || song_ticks.iter().any(|t| *t > 2_592_000_000)
                || song_ticks.windows(2).any(|p| p[0] >= p[1])
                || self.downbeat_index0 as usize > song_ticks.len().saturating_sub(1)
            {
                return false;
            }
        }
        if !self.outro() {
            return self.recap.is_none() && self.final_image.is_none();
        }
        self.final_image.as_ref().is_some_and(|v| !v.is_empty())
            && self.recap.as_ref().is_some_and(|items| {
                (1..=32).contains(&items.len())
                    && items.iter().all(|r| {
                        !r.bg.is_empty()
                            && r.character.as_ref().is_none_or(|v| !v.is_empty())
                            && range(r.h, 0.001, 8.0)
                            && range(r.cx, -8.0, 8.0)
                            && range(r.cy, -8.0, 8.0)
                            && range(r.view.zoom, 0.001, 8.0)
                            && range(r.view.x, -4.0, 4.0)
                            && range(r.view.y, -4.0, 4.0)
                            && range(r.view.rot, -32.0, 32.0)
                    })
            })
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
            && [
                &self.fonts.title,
                &self.fonts.hud,
                &self.fonts.ruby,
                &self.fonts.subtitle,
            ]
            .iter()
            .all(|id| unique(id, "font"))
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        matches!(self.beats, Beats::Analysis {})
    }
}
