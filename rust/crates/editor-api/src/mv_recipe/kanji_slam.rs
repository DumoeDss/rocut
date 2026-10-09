//! Native complete kanjiSlam producer. The original JavaScript remains solely
//! in the independent oracle; production receives admitted raster operations.
#[path = "kanji_slam_budget.rs"]
mod budget;
#[path = "kanji_slam_character.rs"]
mod character;
#[path = "kanji_slam_clock.rs"]
mod clock;
#[path = "ember_draw.rs"]
mod draw;
#[path = "kanji_slam_finishing.rs"]
mod finishing;
#[path = "kanji_slam_fire.rs"]
mod fire;
#[path = "kanji_slam_fonts.rs"]
mod fonts;
#[path = "kanji_slam_glyph_art.rs"]
mod glyph_art;
#[path = "kanji_slam_glyphs.rs"]
mod glyphs;
#[path = "kanji_slam_impacts.rs"]
mod impacts;
#[path = "kanji_slam_labels.rs"]
mod labels;
#[path = "kanji_slam_math.rs"]
mod math;
#[path = "kanji_slam_model.rs"]
mod model;
#[path = "kanji_slam_palette.rs"]
mod palette;
#[path = "ember_plan.rs"]
mod plan;
#[path = "kanji_slam_producer.rs"]
mod producer;
#[path = "kanji_slam_raster.rs"]
mod raster;
#[path = "converge_math.rs"]
mod seeded;
#[path = "kanji_slam_sky.rs"]
mod sky;
#[path = "kanji_slam_state.rs"]
mod state;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "kanji_slam_tests.rs"]
mod tests;
#[path = "kanji_slam_validate.rs"]
mod validate;
pub use model::KanjiSlam;
pub use plan::Plan;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
impl KanjiSlam {
    pub(super) fn static_requests(
        &self,
        resources: &[crate::programmatic_resources::Resource],
        requests: &mut Vec<crate::mv_font_metrics::Request>,
    ) -> Result<(), String> {
        fonts::static_requests(self, resources, requests)
    }
    pub(super) fn sampled_requests(
        &self,
        sample: &Sample<'_>,
        resources: &[crate::programmatic_resources::Resource],
        requests: &mut Vec<crate::mv_font_metrics::Request>,
    ) -> Result<(), String> {
        let clock = clock::Clock::new(self, sample)?;
        let (labels, _) = labels::labels(self, &clock);
        fonts::static_requests(self, resources, requests)?;
        fonts::sampled_requests(&labels, resources, requests)
    }
}
