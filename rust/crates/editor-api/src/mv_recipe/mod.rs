//! Versioned MV recipes: policy and time evaluation live in Rust; browser code
//! receives an evaluated drawing plan, never expressions embedded in parameters.
mod afterimage;
mod ascii_sweep;
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
mod hex_float;
mod image_dimensions;
mod kanji_slam;
mod layers;
mod light_leak;
mod mesh_model;
mod model;
mod panel_model;
mod panels;
mod particle_scroll;
mod post;
mod post_automation;
mod post_catalog;
mod post_model;
mod post_parameter_catalog;
mod reference;
use time::replay;
mod burst;
mod fall;
mod flame;
pub(crate) mod heart;
mod heart_recipe;
mod illust_native;
mod ink;
pub(crate) mod jz;
pub(crate) mod memories;
mod memories_recipe;
mod meta_reference;
mod night_recipe;
pub(crate) mod road;
mod road_recipe;
mod scene_span;
mod shatter;
mod sprite_model;
mod sprites;
mod thread;
mod title_riff;
pub(crate) mod train;
mod transition_bend;
mod transition_model;
mod transition_peel;
mod native_transition;
pub use native_transition::{NativeTransitionStyle, NativeTransitionDirection, Clip as NativeTransitionClip, DrawCommand as NativeTransitionDrawCommand, Input as NativeTransitionInput, Blend as NativeTransitionBlend, native_transition_style_validate_json};
mod transition_shatter;
mod transitions;
mod tunnel;
pub(crate) mod tunnel_context;
mod type_card;
mod validate;
pub(crate) mod wet_floor;
pub use catalog::mv_recipe_catalog_json;
pub use model::{Plan, Recipe};

pub fn deserialize_recipe<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Recipe>, D::Error> {
    use serde::Deserialize;
    Recipe::deserialize(d).map(Some)
}
