use super::bus_schedule::BusSchedule;
use super::fader_model::FaderObservation;
use super::fx_model::FxChain;
use super::model::{GraphRequest, Source};
use crate::programmatic_audio::envelope::GainEnvelope;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ExecutionRequest {
    pub version: u32,
    pub graph: GraphRequest,
    #[serde(default)]
    pub fader_observations: Vec<FaderObservation>,
    #[serde(default)]
    pub decoded_source_observations: Option<Vec<super::rate_geometry::Observation>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecutionPlan {
    pub version: u32,
    pub semantics_profile: &'static str,
    pub stage: &'static str,
    pub execution_ready: bool,
    pub pcm_geometry_ready: bool,
    pub state_policy: &'static str,
    pub sample_phase_policy: &'static str,
    pub sample_rate: u32,
    pub channels: u32,
    pub render_frames: u64,
    pub crop_start_sample: u64,
    pub output_frames: u64,
    pub sources: Vec<Source>,
    pub decoded_sources: Vec<DecodedSource>,
    pub tracks: Vec<PreparedTrack>,
    pub buses: Vec<PreparedBus>,
    pub working_set: WorkingSet,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DecodedSource {
    pub id: String,
    pub resource_id: String,
    pub playback_rate: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub source_sample: u64,
    pub frames: Option<u64>,
    pub pcm_bytes: Option<u64>,
    pub max_frames: u64,
    pub max_pcm_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation_key: Option<String>,
    pub gain_applied: bool,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_preparation: Option<super::rate_prepare::RatePreparation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FxStage {
    pub sample_rate: u32,
    pub input_frames: u64,
    pub expected_output_frames: u64,
    pub max_output_bytes: u64,
    pub normalized_fx_chain: FxChain,
    pub native_fx_automation: Option<serde_json::Value>,
    pub native_tail_seconds: f64,
    pub automation_points: usize,
    pub automation_curve_values: usize,
    pub automation_scheduled_events: usize,
    pub automation_diagnostics: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreparedTrack {
    pub instance_id: String,
    pub resolved_bus_instance_id: Option<String>,
    pub decoded_source_id: String,
    pub start_sample: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_trim_frames: Option<u64>,
    pub source_start_sample: u64,
    pub source_period_frames: u64,
    pub r#loop: bool,
    pub muted: bool,
    pub audible_media: bool,
    pub requires_pcm: bool,
    pub fader: Option<GainEnvelope>,
    pub fx_stage: Option<FxStage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreparedBus {
    pub instance_id: String,
    pub member_instance_ids: Vec<String>,
    pub muted: bool,
    pub requires_pcm: bool,
    pub fader: BusSchedule,
    pub fx_stage: FxStage,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkingSet {
    pub limit_bytes: u64,
    pub known_buffer_bytes: u64,
    pub estimated_native_reserve_bytes: u64,
    pub estimated_peak_bytes: u64,
    pub decoded_pcm_bytes: u64,
    pub rate_preparation_bytes: u64,
    pub canonical_mix_bytes: u64,
    pub largest_stage_transport_bytes: u64,
    pub explicit_native_buffer_bytes: u64,
    pub nominal_native_history_bytes: u64,
    pub retained_track_fx_bytes: u64,
    pub retained_bus_fx_bytes: u64,
    pub largest_assembly_input_bytes: u64,
    pub automation_buffer_bytes: u64,
    pub browser_total_memory_guaranteed: bool,
}
