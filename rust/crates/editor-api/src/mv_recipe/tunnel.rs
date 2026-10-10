//! Dedicated typo.js tunnel producer. Not publicly wired until native acceptance.
#[path = "tunnel_clock.rs"]
mod clock;
#[path = "ember_draw.rs"]
mod draw;
#[path = "tunnel_fonts.rs"]
mod fonts;
#[path = "tunnel_geometry.rs"]
mod geometry;
#[path = "tunnel_layers.rs"]
mod layers;
#[path = "tunnel_math.rs"]
mod math;
#[path = "tunnel_metrics.rs"]
mod metrics;
#[path = "tunnel_model.rs"]
mod model;
#[path = "tunnel_objects.rs"]
mod objects;
#[path = "tunnel_plan.rs"]
mod plan;
#[path = "tunnel_producer.rs"]
mod producer;
#[path = "converge_math.rs"]
mod seeded;
#[cfg(test)]
#[path = "tunnel_tests.rs"]
mod tests;
#[path = "tunnel_validate.rs"]
mod validate;
pub use fonts::{Admission, Fonts, Stack};
pub use metrics::{Measurement, MetricRequest};
pub use model::{Metrics, Tunnel};
pub use plan::Plan;
pub use producer::NativePost;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
