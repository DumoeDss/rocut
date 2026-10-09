//! Authored retinal afterimage: fixed reference temporal response and multiscale
//! rasters, not a generic blur. Rust owns time/noise; Canvas only rasterizes.
#[path = "afterimage_catalog.rs"]
mod catalog;
#[path = "afterimage_constraints.rs"]
mod constraints;
#[path = "afterimage_math.rs"]
mod math;
#[path = "afterimage_model.rs"]
mod model;
#[path = "afterimage_plan.rs"]
mod plan;
#[cfg(test)]
#[path = "afterimage_recipe_tests.rs"]
mod recipe_tests;
#[cfg(test)]
#[path = "afterimage_tests.rs"]
mod tests;
pub(super) use catalog::catalog_entry;
pub use model::{Afterimage, Plan};
