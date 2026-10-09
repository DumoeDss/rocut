use super::{MAX_BEATS, MAX_CUES, MAX_KEYS, MAX_SAFE_TICKS, MAX_TITLE, model::*};
use crate::{
    mv_recipe::{
        model::Span,
        validate::{color, range},
    },
    programmatic_resources::Resource,
};

fn beats(value: &Beats) -> bool {
    match value {
        Beats::Analysis {} => true,
        Beats::Manual { song_ticks } => {
            song_ticks.len() <= MAX_BEATS
                && song_ticks.iter().all(|t| *t <= MAX_SAFE_TICKS)
                && song_ticks.windows(2).all(|p| p[0] < p[1])
        }
    }
}
fn intervals(values: &[[u64; 2]]) -> bool {
    values.len() <= MAX_CUES && values.iter().all(|[a, b]| a < b && *b <= MAX_SAFE_TICKS)
}
fn hud(value: &Hud) -> bool {
    !value.font.is_empty()
        && !value.title.is_empty()
        && value.title.chars().count() <= MAX_TITLE
        && !value.title.chars().any(char::is_control)
        && value.clock.hour <= 99
        && value.clock.minute <= 99
        && (1..=120).contains(&value.clock.fps)
}
impl Ember {
    pub(super) fn palette(&self) -> &Palette {
        match self {
            Self::Breathe(a) => &a.palette,
            Self::Ignite(a) => &a.palette,
            Self::Collapse(a) => &a.palette,
        }
    }
    pub(super) fn grain(&self) -> f64 {
        match self {
            Self::Breathe(a) => a.grain,
            Self::Ignite(a) => a.grain,
            Self::Collapse(a) => a.grain,
        }
    }
    pub fn valid(&self, song_start: u64, span: &Span, step: u64) -> bool {
        let Some(start) = u64::from(span.start_frame)
            .checked_mul(step)
            .and_then(|v| v.checked_add(song_start))
        else {
            return false;
        };
        let p = self.palette();
        range(self.grain(), 0.0, 1.0)
            && [
                p.background,
                p.aura,
                p.dusk,
                p.verm,
                p.sunset,
                p.glow,
                p.hi,
                p.core,
            ]
            .iter()
            .all(color)
            && match self {
                Self::Breathe(a) => {
                    beats(&a.beats)
                        && hud(&a.hud)
                        && intervals(&a.stops_ticks)
                        && intervals(&a.flares_ticks)
                        && a.thumps_ticks.len() <= MAX_CUES
                        && a.thumps_ticks.iter().all(|v| *v <= MAX_SAFE_TICKS)
                }
                Self::Ignite(a) => {
                    beats(&a.beats)
                        && hud(&a.hud)
                        && intervals(&a.stops_ticks)
                        && range(a.ring, 1.0, 1000.0)
                        && a.crack_at_ticks <= MAX_SAFE_TICKS
                        && match a.black_from {
                            BlackFrom::LastBeat {} => true,
                            BlackFrom::At { song_ticks } => {
                                song_ticks > start && song_ticks <= MAX_SAFE_TICKS
                            }
                        }
                }
                Self::Collapse(a) => {
                    !a.image.is_empty()
                        && a.focus.iter().all(|v| range(*v, -4096.0, 4096.0))
                        && a.end_ticks > start
                        && a.end_ticks <= MAX_SAFE_TICKS
                        && match &a.keys {
                            Keys::Analysis { beats: value } => beats(value),
                            Keys::Manual { values } => {
                                (3..=MAX_KEYS).contains(&values.len())
                                    && values.iter().all(|k| {
                                        k.song_ticks <= MAX_SAFE_TICKS && range(k.factor, 0.0, 1.0)
                                    })
                                    && values.windows(2).all(|p| {
                                        p[0].song_ticks != p[1].song_ticks
                                            && (p[1].song_ticks < p[0].song_ticks
                                                || super::ease::iris_segment_valid(
                                                    p[0].factor,
                                                    p[1].factor,
                                                    p[1].easing,
                                                ))
                                    })
                                    && values[2].song_ticks < a.end_ticks
                            }
                        }
                }
            }
    }
    pub fn uses_audio(&self) -> bool {
        !matches!(
            self,
            Self::Collapse(Collapse {
                keys: Keys::Manual { .. },
                ..
            })
        )
    }
    pub fn resources_valid(&self, resources: &[Resource]) -> bool {
        let (id, kind) = match self {
            Self::Breathe(a) => (&a.hud.font, "font"),
            Self::Ignite(a) => (&a.hud.font, "font"),
            Self::Collapse(a) => (&a.image, "image"),
        };
        resources
            .iter()
            .filter(|r| r.id == *id && r.kind == kind)
            .count()
            == 1
    }
    pub fn work(&self) -> u32 {
        let base = match self {
            Self::Breathe(a) => {
                600 + 64 * a.flares_ticks.len() as u32
                    + a.thumps_ticks.len() as u32
                    + a.hud.title.chars().count() as u32
            }
            Self::Ignite(_) => 3800,
            Self::Collapse(a) => {
                900 + 2 * match &a.keys {
                    Keys::Manual { values } => values.len() as u32,
                    Keys::Analysis { .. } => 9,
                }
            }
        };
        base + if self.grain() > 0.0 { 256 } else { 0 }
    }
    pub fn scratch_pixels(&self) -> u64 {
        (if matches!(self, Self::Breathe(_)) {
            2 * 1600 * 900
        } else {
            0
        }) + if self.grain() > 0.0 { 2 * 65_536 } else { 0 }
    }
    pub fn plan_pixels(&self) -> u64 {
        // Numeric geometry/paints, all225 blits and repeated DAG serialization/clones.
        u64::from(self.work()) * 512 + if self.grain() > 0.0 { 9 * 65_536 } else { 0 }
    }
}
