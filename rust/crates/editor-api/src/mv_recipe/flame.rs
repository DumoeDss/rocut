//! Complete reference Flame. Rust resolves song time and emits native Canvas
//! primitives; only verified ROI pixel readback is supplied by the raster host.
#[path = "flame_budget.rs"]
mod budget;
#[path = "flame_clock.rs"]
mod clock;
#[path = "flame_dark.rs"]
mod dark;
#[path = "ember_draw.rs"]
mod draw;
#[path = "flame_fire.rs"]
mod fire;
#[path = "flame_hands.rs"]
mod hands;
#[path = "flame_math.rs"]
mod math;
#[path = "flame_model.rs"]
mod model;
#[path = "flame_particles.rs"]
mod particles;
#[path = "ember_plan.rs"]
mod plan;
#[path = "flame_producer.rs"]
mod producer;
#[path = "kanji_slam_raster.rs"]
mod raster;
#[path = "converge_math.rs"]
mod seeded;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "flame_tests.rs"]
mod tests;
#[path = "flame_validate.rs"]
mod validate;
pub use model::Flame;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<plan::Command>,
    pub raster_budget_bytes: u64,
}
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
