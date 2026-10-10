//! Parameterized illustrated shot with pure Rust source/song-time plans.
#[path = "illust_native_catalog.rs"]
mod catalog;
#[path = "illust_native_fx.rs"]
mod fx;
#[path = "illust_native_model.rs"]
mod model;
#[path = "illust_native_plan.rs"]
mod plan;
#[path = "illust_native_producer.rs"]
mod producer;
#[path = "illust_native_sprite.rs"]
mod sprite;
pub(super) use catalog::entry as catalog_entry;
pub use model::Args;
pub(super) use model::{expanded_work, image_ids, plan_bytes_bound, scratch_pixels, valid};
pub use plan::Plan;
pub(super) use producer::plan;
