//! Complete reference Ember primitives; platform rasterizers replay native plans.
#[cfg(test)]
#[path = "ember_admission_tests.rs"]
mod admission_tests;
#[path = "ember_breathe.rs"]
mod breathe;
#[path = "ember_catalog.rs"]
mod catalog;
#[path = "ember_clock.rs"]
mod clock;
#[path = "ember_collapse.rs"]
mod collapse;
#[path = "ember_cracks.rs"]
mod cracks;
#[path = "ember_draw.rs"]
mod draw;
#[path = "ember_ease.rs"]
mod ease;
#[path = "ember_fonts.rs"]
mod fonts;
#[path = "converge_grain.rs"]
mod grain;
#[path = "ember_hud.rs"]
mod hud;
#[path = "ember_ignite.rs"]
mod ignite;
#[path = "ember_keys.rs"]
mod keys;
#[path = "ember_light.rs"]
mod light;
#[path = "converge_math.rs"]
mod math;
#[path = "ember_model.rs"]
mod model;
#[path = "ember_particles.rs"]
mod particles;
#[path = "ember_plan.rs"]
mod plan;
#[cfg(test)]
#[path = "ember_recipe_tests.rs"]
mod recipe_tests;
#[path = "ember_shimmer.rs"]
mod shimmer;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "ember_test_support.rs"]
mod test_support;
#[cfg(test)]
#[path = "ember_tests.rs"]
mod tests;
#[path = "ember_validate.rs"]
mod validate;
pub(super) use catalog::catalog_entry;
pub(super) use fonts::append as append_font_requests;
pub use model::Ember;
pub use plan::Plan;
pub(super) const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;
pub(super) const MAX_TITLE: usize = 96;
pub(super) const MAX_CUES: usize = 32;
pub(super) const MAX_KEYS: usize = 64;
pub(super) const MAX_BEATS: usize = 4096;

pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub width: f64,
    pub height: f64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
    pub fonts: Option<&'a crate::mv_font_metrics::Context>,
    pub images: Option<&'a crate::mv_image_dimensions::Context>,
}
impl Ember {
    pub(super) fn image(&self) -> Option<&str> {
        if let Self::Collapse(a) = self {
            Some(&a.image)
        } else {
            None
        }
    }
    pub(super) fn runtime_ready(&self, s: &Sample<'_>) -> Result<(), String> {
        let hud = match self {
            Self::Breathe(a) => {
                clock::Envelope::sample(s)?;
                clock::beats(&a.beats, s)?;
                Some(&a.hud)
            }
            Self::Ignite(a) => {
                clock::Envelope::sample(s)?;
                clock::beats(&a.beats, s)?;
                Some(&a.hud)
            }
            Self::Collapse(a) => {
                s.images
                    .ok_or("Ember collapse requires decoded image dimensions")?
                    .image(&a.image)?;
                keys::resolve(a, s)?;
                None
            }
        };
        if let Some(hud) = hud {
            let metrics = s
                .fonts
                .ok_or("Ember requires measured whole-string font advances")?;
            let mut prefix = String::new();
            metrics.advance(&hud.font, "", 22.0, 0.0)?;
            for character in hud.title.chars() {
                prefix.push(character);
                metrics.advance(&hud.font, &hud::plain(&prefix), 22.0, 0.0)?;
            }
            if hud.title.contains('Ō') {
                metrics.advance(&hud.font, "O", 22.0, 0.0)?;
            }
        }
        Ok(())
    }
    pub(super) fn plan(&self, s: &Sample<'_>) -> Result<Plan, String> {
        self.runtime_ready(s)?;
        let mut d = draw::Draw::new(s.width, s.height);
        match self {
            Self::Breathe(a) => breathe::draw(&mut d, a, s)?,
            Self::Ignite(a) => ignite::draw(&mut d, a, s)?,
            Self::Collapse(a) => collapse::draw(&mut d, a, s)?,
        };
        let plan = Plan {
            commands: d.commands,
        };
        plan.validate_surfaces(self.scratch_pixels())?;
        Ok(plan)
    }
}
