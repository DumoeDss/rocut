//! Versioned MV recipes: policy and time evaluation live in Rust; browser code
//! receives an evaluated drawing plan, never expressions embedded in parameters.
mod ascii_sweep;
mod afterimage;
mod audio;
mod catalog;
#[cfg(test)]
mod catalog_tests;
mod cloth;
mod converge;
mod ember;
mod evaluate;
mod generator_evaluate;
mod generator_model;
mod generators;
mod grid;
mod image_dimensions;
mod kanji_slam;
mod hex_float;
mod light_leak;
mod layers;
mod mesh_model;
mod model;
mod panel_model;
mod panels;
mod particle_scroll;
mod post;
mod post_automation;
mod post_catalog;
mod post_model;
mod reference;
use time::replay;
mod shatter;
mod sprite_model;
mod sprites;
mod transition_bend;
mod transition_model;
mod transition_peel;
mod transition_shatter;
mod transitions;
mod type_card;
mod title_riff;
mod thread;
mod tunnel;
pub(crate) mod tunnel_context;
mod fall;
mod flame;
mod ink;
mod road_recipe;
pub(crate) mod heart;
mod heart_recipe;
mod night_recipe;
pub(crate) mod wet_floor;
pub(crate) mod train;
pub(crate) mod memories;
mod memories_recipe;
mod burst;
mod illust_native;
mod meta_reference;
pub(crate) mod jz;
mod scene_span;
pub(crate) mod road;
mod validate;
pub use catalog::mv_recipe_catalog_json;
pub use model::{Plan, Recipe};

pub fn deserialize_recipe<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Recipe>, D::Error> {
    use serde::Deserialize;
    Recipe::deserialize(d).map(Some)
}
