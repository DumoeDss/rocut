use super::{catalog::*, model::*};
use crate::{mv_recipe::validate::color, programmatic_resources::Resource};

fn id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 240
}
fn text(value: &str, max: usize) -> bool {
    value.len() <= max * 4
        && (1..=max).contains(&value.chars().count())
        && value.chars().all(|c| !c.is_control())
}
fn position(value: &[f64; 2]) -> bool {
    value.iter().all(|v| POSITION.valid(*v))
}
fn line(font: &str, value: &str, at: &[f64; 2], size: f64, tracking: f64, opacity: f64) -> bool {
    id(font)
        && text(value, MAX_TEXT)
        && position(at)
        && SIZE.valid(size)
        && TRACKING.valid(tracking)
        && OPACITY.valid(opacity)
}
impl Afterimage {
    pub fn valid(&self) -> bool {
        id(&self.cutout.image)
            && id(&self.title_font)
            && self.cutout.rect[..2].iter().all(|v| POSITION.valid(*v))
            && self.cutout.rect[2..].iter().all(|v| EXTENT.valid(*v))
            && (1..=MAX_TITLE).contains(&self.glyphs.len())
            && self
                .glyphs
                .iter()
                .all(|g| text(&g.text, 1) && position(&g.center) && SIZE.valid(g.font_size))
            && position(&self.circle.center)
            && SIZE.valid(self.circle.radius)
            && line(
                &self.subtitle.font,
                &self.subtitle.text,
                &self.subtitle.position,
                self.subtitle.font_size,
                self.subtitle.tracking,
                self.subtitle.opacity,
            )
            && line(
                &self.credit.font,
                &self.credit.text,
                &self.credit.position,
                self.credit.font_size,
                self.credit.tracking,
                self.credit.opacity,
            )
            && [
                &self.color,
                &self.fringe_color,
                &self.background,
                &self.credit.color,
            ]
            .into_iter()
            .all(color)
            && OPACITY.valid(self.grain)
            && TIME_SCALE.valid(self.time_scale)
            && MOTION_SCALE.valid(self.motion_scale)
    }
    pub fn resources_valid(&self, resources: &[Resource]) -> bool {
        resources
            .iter()
            .any(|r| r.kind == "image" && r.id == self.cutout.image)
            && [&self.title_font, &self.subtitle.font, &self.credit.font]
                .into_iter()
                .all(|font| resources.iter().any(|r| r.kind == "font" && r.id == *font))
    }
    pub fn work(&self) -> u32 {
        // Circle, cutout, five raster draws, individually shaped text scalars;
        // each grain row charges one extra primitive (256 deterministic pixels).
        7 + self.glyphs.len() as u32
            + self.subtitle.text.chars().count() as u32
            + self.credit.text.chars().count() as u32
            + if self.grain > 0.0 { 256 } else { 0 }
    }
    pub fn scratch_pixels(&self, width: u32, height: u32) -> u64 {
        // Mask + sharp + four reduced rasters + blur scratch, conservatively
        // rounded up to four full-size surfaces (tiny rasters round up to 1px).
        // Grain ImageData and the selected tile are transient; expanded plan
        // payload is separate because every DAG leaf retains it.
        let full = u64::from(width) * u64::from(height);
        let reduced = [2, 4, 8, 4]
            .into_iter()
            .map(|d| u64::from((width / d).max(1)) * u64::from((height / d).max(1)))
            .sum::<u64>();
        (full * 4).max(full * 2 + reduced * 3) + if self.grain > 0.0 { 2 * 65_536 } else { 0 }
    }
    pub fn plan_pixels(&self) -> u64 {
        // Host -> iframe -> Worker can retain three cloned number[] arrays
        // (6 RGBA-equivalent tiles), plus raw gray/JSON/serialization allowance.
        // Admission estimate only: not a hard bound on browser/process RSS.
        if self.grain > 0.0 { 9 * 65_536 } else { 0 }
    }
}
