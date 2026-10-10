//! Complete unchanged dark.js Ink scene: native clocks, network and ordered raster plan.
#[path = "ink_background.rs"]
mod background;
#[path = "ink_budget.rs"]
mod budget;
#[path = "ink_catalog.rs"]
mod catalog;
#[path = "ink_character.rs"]
mod character;
#[path = "ink_clock.rs"]
mod clock;
#[path = "ember_draw.rs"]
mod draw;
#[path = "ink_layers.rs"]
mod layers;
#[path = "ink_math.rs"]
mod math;
#[path = "ink_model.rs"]
mod model;
#[path = "ink_network.rs"]
mod network;
#[path = "ink_paths.rs"]
mod paths;
#[path = "ember_plan.rs"]
mod plan;
#[path = "ink_producer.rs"]
mod producer;
#[path = "ink_raster.rs"]
mod raster;
#[path = "converge_math.rs"]
mod seeded;
#[path = "ink_shape.rs"]
mod shape;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "ink_tests.rs"]
mod tests;
#[path = "ink_texture.rs"]
mod texture;
#[path = "ink_validate.rs"]
mod validate;
pub use model::Ink;
pub use plan::Plan;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
