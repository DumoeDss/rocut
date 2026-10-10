//! Deterministic numerical core for woven substrate and multi-bristle paint.
//! Native catalog and lossless pass transport; ordered source capture is pending.
//! No playback cache or wall-clock state.
#[path = "canvas/catalog.rs"]
mod catalog;
#[cfg(test)]
#[path = "canvas/catalog_tests.rs"]
mod catalog_tests;
#[path = "canvas/clock.rs"]
mod clock;
#[path = "canvas/contract.rs"]
mod contract;
#[path = "canvas/deposition.rs"]
mod deposition;
#[path = "canvas/gpu_pipeline.rs"]
pub(crate) mod gpu_pipeline;
#[path = "canvas/lighting.rs"]
mod lighting;
#[path = "canvas/params.rs"]
mod params;
#[path = "canvas/pass.rs"]
mod pass;
#[path = "canvas/prepared.rs"]
mod prepared;
#[path = "canvas/prepared_budget.rs"]
mod prepared_budget;
#[cfg(test)]
#[path = "canvas/prepared_tests.rs"]
mod prepared_tests;
#[path = "canvas/raster.rs"]
mod raster;
#[cfg(test)]
#[path = "canvas/registration_tests.rs"]
mod registration_tests;
#[path = "canvas/renderer_bridge.rs"]
mod renderer_bridge;
#[path = "canvas/replay.rs"]
mod replay;
#[cfg(test)]
#[path = "canvas/replay_tests.rs"]
mod replay_tests;
#[path = "canvas/resolve.rs"]
mod resolve;
#[path = "canvas/simulation.rs"]
mod simulation;
#[cfg(test)]
#[path = "canvas/tests.rs"]
mod tests;

pub(crate) use catalog::definition;
pub use contract::{CanvasConfig, CanvasError, CanvasStroke, ReplayEstimate, validate};
pub use params::parse;
pub use pass::{CanvasPass, decode_pass};
pub use prepared::{CanvasPreparation, PreparedCanvasPass};
pub use prepared_budget::{CanvasPreparationBudget, MAX_PREPARATION_BYTES, MAX_PREPARATION_WORK};
pub use raster::{CanvasRasterPayload, CanvasRasterUniforms, raster_payload, sample_rgba8_grid};
pub use renderer_bridge::validate_canvas_device_capture;
pub use replay::{CanvasReplayEstimate, CanvasReplayJob, CanvasReplayProgress};
pub(crate) use resolve::resolve;
pub use resolve::validate_canvas_schedule;
pub use simulation::{CanvasCell, CanvasState, rebuild, shade};

pub const TICKS_PER_SECOND: u64 = 120_000;
pub const STEP_TICKS: u64 = 6_000;
pub const MAX_DURATION_TICKS: u64 = 7_200_000;
pub const MAX_STROKES: usize = 16;

/// Canvas authoring bounds are narrower than shared time's numeric API.
/// Frame quantization itself delegates to the actual shared media-time implementation.
pub fn frame_floor(ticks: i64, numerator: u32, denominator: u32) -> Result<i64, CanvasError> {
    clock::frame_floor(ticks, numerator, denominator).map_err(CanvasError)
}
