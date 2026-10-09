//! Complete reference thread scene. Rust owns timing and geometry; the platform
//! replays bounded Canvas primitives and supplies decoded image dimensions.
#[path = "thread_background.rs"]
mod background;
#[path = "thread_budget.rs"]
mod budget;
#[path = "thread_clock.rs"]
mod clock;
#[path = "ember_draw.rs"]
mod draw;
#[path = "thread_finishing.rs"]
mod finishing;
#[path = "thread_geometry.rs"]
mod geometry;
#[path = "thread_hand.rs"]
mod hand;
#[path = "thread_math.rs"]
mod math;
#[path = "thread_model.rs"]
mod model;
#[path = "ember_plan.rs"]
mod plan;
#[path = "thread_producer.rs"]
mod producer;
#[path = "kanji_slam_raster.rs"]
mod raster;
#[path = "thread_ribbon.rs"]
mod ribbon;
#[path = "converge_math.rs"]
mod seeded;
#[path = "thread_state.rs"]
mod state;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "thread_tests.rs"]
mod tests;
#[path = "thread_validate.rs"]
mod validate;
pub use model::Thread;
pub use plan::Plan;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
