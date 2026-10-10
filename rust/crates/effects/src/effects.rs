mod adjustment;
mod blaze;
mod bubble;
mod canvas;
mod clouds;
mod color_uniforms;
mod decrypt_reveal;
mod displacement;
mod droplets;
mod flame_wrap;
mod frost;
mod input_preflight;
#[cfg(test)]
mod input_preflight_tests;
mod laser;
pub mod liquid_object;
mod liquid_catalog;
#[cfg(test)]
mod liquid_contract_tests;
#[cfg(test)]
mod liquid_oracle_tests;
mod liquid_params;
mod liquid_pass;
mod liquid_pipeline;
mod liquid_prepared;
#[cfg(test)]
mod liquid_prepared_tests;
mod liquid_replay;
#[cfg(test)]
mod liquid_replay_tests;
mod liquid_sim;
mod pass_preflight;
mod pipeline;
mod stylized;
mod stylized_catalog;
mod stylized_clock;
mod stylized_uniforms;
mod wave_catalog;
mod wave_events;
mod wave_uniforms;

pub use bubble::validate_bubble_schedule;
pub use canvas::validate_canvas_schedule;
pub use canvas::{
    CanvasCell, CanvasConfig, CanvasError, CanvasPass, CanvasPreparation, CanvasPreparationBudget,
    CanvasRasterPayload, CanvasRasterUniforms, CanvasReplayEstimate, CanvasReplayJob,
    CanvasReplayProgress, CanvasState, CanvasStroke,
    MAX_PREPARATION_BYTES as MAX_CANVAS_PREPARATION_BYTES,
    MAX_PREPARATION_WORK as MAX_CANVAS_PREPARATION_WORK, PreparedCanvasPass,
    decode_pass as decode_canvas_pass, raster_payload as build_canvas_raster_payload,
    sample_rgba8_grid as sample_canvas_rgba8_grid,
    validate_canvas_device_capture,
};
pub use frost::{MAX_FROST_STROKES, MAX_FROST_TICKS, validate_frost_schedule};
pub use liquid_params::validate_liquid_schedule;
pub use liquid_prepared::{LIQUID_REQUEST_MEMORY_LIMIT, LiquidPreparation, PreparedLiquidPass};
pub use stylized::resolve_stylized_effect_json;
pub use stylized_catalog::stylized_effect_catalog_json;
pub use wave_catalog::MAX_WAVE_EVENTS;
pub use wave_events::validate_wave_schedule;

pub use adjustment::{
    ColorAdjustment, ColorAdjustmentCatalog, ColorAdjustmentField, ColorAdjustmentPreset,
    color_adjustment_catalog, normalize_color_adjustment,
};
mod types;

pub use input_preflight::validate_effects_input;
pub use pass_preflight::validate_effect_pass;
pub use pipeline::{ApplyEffectsOptions, EffectPipeline, EffectsError};
pub use types::{EffectPass, UniformValue};
