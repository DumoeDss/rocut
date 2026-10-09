use super::{
    Sample,
    character::Character,
    clock::Clock,
    fonts::ink_request,
    glyph_art,
    model::KanjiSlam,
    plan::{Command, Plan, Step},
};
use crate::{mv_font_metrics, mv_image_dimensions};

#[path = "kanji_slam_budget_geometry.rs"]
mod geometry;

// Final admission charges this fixed per-leaf envelope. Discovery only charges
// statically known scratch until decoded and measured resource facts arrive.
// No raster ticket exists before those facts and emitted lifetimes are checked.
const SCRATCH_PIXELS: u64 = 40 * 1024 * 1024;
pub(super) const MAX_PLAN_BYTES: usize = 4 * 1024 * 1024;
impl KanjiSlam {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        4096
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (MAX_PLAN_BYTES as u64 * 3 + 3) / 4
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&mv_image_dimensions::Context>,
    ) -> Result<u64, String> {
        if images.is_none() {
            return Ok(geometry::static_floor(self));
        }
        if let Some(images) = images {
            let image = images.image(&self.character)?;
            let padding = ((self.wind.amp * 1.6).ceil() + 2.0) as u32;
            let [w, h] = if self.wind.axis == super::model::Axis::Col {
                [image.width, image.height + 2 * padding]
            } else {
                [image.width + 2 * padding, image.height]
            };
            if w > 4096 || h > 4096 {
                return Err("kanjiSlam padded image exceeds bounded scratch dimensions".into());
            }
        }
        Ok(SCRATCH_PIXELS)
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        sample: &Sample<'_>,
        fonts: &mv_font_metrics::Context,
        images: &mv_image_dimensions::Context,
    ) -> Result<(), String> {
        let clock = Clock::new(self, sample)?;
        Character::new(self, &clock, images)?;
        self.scratch_pixels(Some(images))?;
        for id in self.images() {
            images.image(id)?;
        }
        // Declare/read every authored glyph, including not-yet-visible words.
        for ch in self.glyphs.iter().flat_map(|v| v.chars()) {
            fonts.bounds(&self.fonts.monument, &ink_request(ch))?;
            glyph_art::geometry(ch, 0, self, fonts)?;
        }
        geometry::validate(self, fonts, images, SCRATCH_PIXELS)?;
        Ok(())
    }
    pub(super) fn verify_plan(
        &self,
        plan: &Plan,
        _fonts: &mv_font_metrics::Context,
        images: &mv_image_dimensions::Context,
    ) -> Result<(), String> {
        let (commands, steps) = work(&plan.commands);
        if commands > 4096 || steps > 100_000 {
            return Err("kanjiSlam exceeds expanded primitive/path budget".into());
        }
        plan.validate_surfaces(self.scratch_pixels(Some(images))?)?;
        if serde_json::to_vec(plan).map_err(|e| e.to_string())?.len() > MAX_PLAN_BYTES {
            return Err("kanjiSlam exceeds4MiB serialized plan/copy budget".into());
        }
        Ok(())
    }
}
fn path_steps(path: &[Step]) -> usize {
    path.iter()
        .map(|s| if matches!(s, Step::Rect { .. }) { 5 } else { 1 })
        .sum()
}
pub(super) fn work(commands: &[Command]) -> (usize, usize) {
    let (mut count, mut steps) = (0, 0);
    for command in commands {
        count += 1;
        match command {
            Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                let (c, s) = work(commands);
                count += c;
                steps += s;
            }
            Command::RectBatch { rects, clip, .. } => {
                steps += 5 * rects.len() + clip.as_ref().map_or(0, |c| path_steps(&c.path));
            }
            Command::CircleBatch { circles, clip, .. } => {
                steps += 2 * circles.len() + clip.as_ref().map_or(0, |c| path_steps(&c.path));
            }
            Command::Path { path, clip, .. } => {
                steps += path_steps(path) + clip.as_ref().map_or(0, |c| path_steps(&c.path));
            }
            Command::Blit { clip, .. }
            | Command::Image { clip, .. }
            | Command::SurfacePatternRect { clip, .. }
            | Command::TextStroke { clip, .. }
            | Command::Rect { clip, .. } => {
                steps += clip.as_ref().map_or(0, |c| path_steps(&c.path));
            }
            _ => {}
        }
    }
    (count, steps)
}
