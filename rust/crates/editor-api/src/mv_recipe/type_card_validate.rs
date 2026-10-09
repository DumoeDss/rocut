use super::{model::*, rules::*};
use crate::{mv_recipe::validate::color, programmatic_resources::Resource};

fn line(t: &Text) -> bool {
    id(&t.font)
        && text(&t.text, MAX_TEXT)
        && point(&t.position)
        && SIZE.valid(t.font_size)
        && TRACKING.valid(t.tracking)
        && color(&t.color)
}
fn layout(l: &Layout) -> bool {
    (1..=MAX_PARTS).contains(&l.parts.len())
        && l.parts
            .iter()
            .all(|p| text(&p.text, MAX_GLYPHS) && point(&p.position) && SIZE.valid(p.font_size))
        && match l.hold {
            Hold::Pulse { seconds } => HOLD.valid(seconds),
            Hold::Sustain => true,
        }
        && OPACITY.valid(l.glitch)
        && l.frame.as_ref().is_none_or(|f| {
            rect(&f.rect)
                && color(&f.color)
                && STROKE.valid(f.width)
                && rect(&f.indicator.rect)
                && color(&f.indicator.color)
        })
        && l.kick_glow
            .as_ref()
            .is_none_or(|g| point(&g.center) && RADIUS.valid(g.radius) && color(&g.color))
}
impl TypeCard {
    pub fn valid(&self) -> bool {
        match self {
            Self::Quiet(a) => {
                id(&a.font)
                    && (1..=MAX_GLYPHS).contains(&a.glyphs.len())
                    && a.glyphs
                        .iter()
                        .all(|g| text(&g.text, 1) && SCALE.valid(g.optical_scale))
                    && SIZE.valid(a.font_size)
                    && point(&a.center)
                    && GAP.valid(a.gap)
                    && LEAD.valid(a.lead)
                    && STAGGER.valid(a.stagger)
                    && FADE.valid(a.fade)
                    && color(&a.color)
                    && color(&a.background)
                    && OPACITY.valid(a.grain)
                    && a.subtitle.as_ref().is_none_or(line)
                    && a.rule.as_ref().is_none_or(|r| {
                        color(&r.color)
                            && OFFSET.valid(r.offset)
                            && LENGTH_SCALE.valid(r.length_scale)
                            && PADDING.valid(r.length_padding)
                            && STROKE.valid(r.width)
                            && SIZE.valid(r.tick_length)
                    })
            }
            Self::Flicker(a) => {
                id(&a.font)
                    && color(&a.background)
                    && a.layouts.iter().all(layout)
                    && match &a.beats {
                        Beats::Analysis {} => true,
                        Beats::Manual { song_ticks } => {
                            song_ticks.len() <= MAX_BEATS
                                && song_ticks.iter().all(|v| *v <= MAX_SAFE_TICKS)
                                && song_ticks.windows(2).all(|v| v[0] < v[1])
                        }
                    }
                    && a.rgb_colors.iter().chain(&a.noise_colors).all(color)
                    && OPACITY.valid(a.scanline_opacity)
                    && color(&a.idle_scan_color)
                    && OPACITY.valid(a.grain)
                    && (1..=MAX_MORSE).contains(&a.morse.elements.len())
                    && a.morse.elements.iter().all(|v| matches!(*v, 1 | 3))
                    && point(&a.morse.position)
                    && SIZE.valid(a.morse.unit)
                    && PADDING.valid(a.morse.gap)
                    && STROKE.valid(a.morse.height)
                    && color(&a.morse.lit_color)
                    && color(&a.morse.unlit_color)
                    && line(&a.morse.label)
                    && point(&a.flood.center)
                    && RADIUS.valid(a.flood.radius_from)
                    && RADIUS.valid(a.flood.radius_to)
                    && a.flood.radius_to >= a.flood.radius_from
                    && a.flood.colors.iter().all(color)
                    && a.flood.colors[3][3] == 0.0
                    && color(&a.flood.white)
                    && text(&a.negative.text, MAX_GLYPHS)
                    && point(&a.negative.position)
                    && SIZE.valid(a.negative.font_size)
                    && color(&a.negative.color)
            }
        }
    }
    pub fn uses_audio(&self) -> bool {
        matches!(
            self,
            Self::Flicker(Flicker {
                beats: Beats::Analysis {},
                ..
            })
        )
    }
    pub fn resources_valid(&self, resources: &[Resource]) -> bool {
        let mut fonts = match self {
            Self::Quiet(a) => vec![a.font.as_str()],
            Self::Flicker(a) => vec![a.font.as_str(), a.morse.label.font.as_str()],
        };
        if let Self::Quiet(a) = self {
            if let Some(sub) = &a.subtitle {
                fonts.push(&sub.font);
            }
        }
        fonts
            .into_iter()
            .all(|font| resources.iter().any(|r| r.id == font && r.kind == "font"))
    }
    pub fn work(&self) -> u32 {
        let text_count = |s: &str| s.chars().count() as u32;
        let cost = match self {
            Self::Quiet(a) => {
                a.glyphs.len() as u32 + 3 + a.subtitle.as_ref().map_or(0, |s| text_count(&s.text))
            }
            Self::Flicker(a) => {
                360 + 108
                    + 16
                    + 8
                    + a.morse.elements.len() as u32
                    + text_count(&a.morse.label.text)
                    + text_count(&a.negative.text)
                    + a.layouts
                        .iter()
                        .map(|l| l.parts.iter().map(|p| text_count(&p.text) * 3).sum::<u32>())
                        .max()
                        .unwrap_or(0)
            }
        };
        cost + if self.grain() > 0.0 { 256 } else { 0 }
    }
    fn grain(&self) -> f64 {
        match self {
            Self::Quiet(a) => a.grain,
            Self::Flicker(a) => a.grain,
        }
    }
    pub fn scratch_pixels(&self, width: u32, height: u32) -> u64 {
        // Sequential text filters, one RGB scratch plus filter scratch, and grain tile/ImageData.
        u64::from(width) * u64::from(height) * 4 + if self.grain() > 0.0 { 2 * 65_536 } else { 0 }
    }
    pub fn plan_pixels(&self) -> u64 {
        // Three-realm command/metric copies, plus the same cloned-grain allowance as afterimage.
        u64::from(self.work()) * 128 + if self.grain() > 0.0 { 9 * 65_536 } else { 0 }
    }
}
