//! Complete falling scene; private until its native raster prerequisite passes.
#[path = "fall_background.rs"]
mod background;
#[path = "fall_budget.rs"]
mod budget;
#[path = "fall_character.rs"]
mod character;
#[path = "fall_clock.rs"]
mod clock;
#[path = "ember_draw.rs"]
mod draw;
#[path = "fall_finishing.rs"]
mod finishing;
#[path = "fall_geometry.rs"]
mod geometry;
#[path = "thread_math.rs"]
mod math;
#[path = "fall_model.rs"]
mod model;
#[path = "ember_plan.rs"]
mod plan;
#[path = "fall_producer.rs"]
mod producer;
#[path = "kanji_slam_raster.rs"]
mod raster;
#[path = "fall_ribbon.rs"]
mod ribbon;
#[path = "converge_math.rs"]
mod seeded;
#[path = "fall_streaks.rs"]
mod streaks;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "fall_tests.rs"]
mod tests;
#[path = "fall_validate.rs"]
mod validate;
pub use model::Fall;
pub use plan::Plan;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
