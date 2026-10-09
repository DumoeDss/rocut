//! Complete quiet/flicker type cards. Rust owns time, beats, optical layout and
//! seeded effects; the controlled font bridge supplies only 100px ink bounds.
#[path = "type_card_beats.rs"]
mod beats;
#[path = "type_card_catalog.rs"]
mod catalog;
#[path = "type_card_finishing.rs"]
mod finishing;
#[path = "type_card_flicker.rs"]
mod flicker;
#[path = "type_card_glitch.rs"]
mod glitch;
#[path = "type_card_math.rs"]
mod math;
#[path = "type_card_metrics.rs"]
mod metrics;
#[path = "type_card_model.rs"]
mod model;
#[path = "type_card_plan.rs"]
mod plan;
#[path = "type_card_quiet.rs"]
mod quiet;
#[cfg(test)]
#[path = "type_card_recipe_tests.rs"]
mod recipe_tests;
#[path = "type_card_rules.rs"]
mod rules;
#[cfg(test)]
#[path = "type_card_test_support.rs"]
mod test_support;
#[cfg(test)]
#[path = "type_card_tests.rs"]
mod tests;
#[path = "type_card_validate.rs"]
mod validate;
pub(super) use catalog::catalog_entry;
pub use model::TypeCard;
pub use plan::Plan;

pub(super) struct Sample<'a> {
    pub elapsed_ticks: u64,
    pub duration_ticks: u64,
    pub shot_start_ticks: u64,
    pub song_ticks: u64,
    pub width: f64,
    pub height: f64,
    pub seed: u32,
    pub fonts: Option<&'a crate::mv_font_metrics::Context>,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
impl Sample<'_> {
    fn elapsed(&self) -> f64 {
        self.elapsed_ticks as f64 / 120_000.0
    }
    fn duration(&self) -> f64 {
        self.duration_ticks as f64 / 120_000.0
    }
    fn point(&self, p: [f64; 2]) -> [f64; 2] {
        [p[0] * self.width, p[1] * self.height]
    }
    fn rect(&self, r: [f64; 4]) -> [f64; 4] {
        [
            r[0] * self.width,
            r[1] * self.height,
            r[2] * self.width,
            r[3] * self.height,
        ]
    }
}
impl TypeCard {
    pub(super) fn plan(&self, sample: &Sample<'_>) -> Result<Plan, String> {
        match self {
            Self::Quiet(settings) => quiet::resolve(settings, sample),
            Self::Flicker(settings) => flicker::resolve(settings, sample),
        }
    }
}
