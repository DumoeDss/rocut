use super::fx_model::FxChain;
use super::model::{Fades, Source, VolumePoint};
use crate::programmatic_audio::envelope::Point;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GraphPlan {
    pub version: u32,
    pub native_version: &'static str,
    pub semantics_profile: &'static str,
    pub stage: &'static str,
    pub execution_ready: bool,
    pub state_policy: &'static str,
    pub sample_rate: u32,
    pub channels: u32,
    pub render_start_sample: u64,
    pub render_frames: u64,
    pub crop_start_sample: u64,
    pub sample_origin: u64,
    pub output_frames: u64,
    pub sources: Vec<Source>,
    pub tracks: Vec<AdmittedTrack>,
    pub buses: Vec<AdmittedBus>,
    pub budget: Budget,
}

/// Admission estimates only. These do not budget a future executor's complete
/// working set, multi-stage buffers, worklets or convolution impulse storage.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Budget {
    pub encoded_source_bytes: u64,
    pub estimated_dry_pcm_bytes: u64,
    pub canonical_pcm_bytes: u64,
    pub output_pcm_bytes: u64,
    pub fx_node_count: usize,
    pub volume_keyframe_count: usize,
    pub automation_point_count: usize,
    pub automation_curve_values: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AdmittedTrack {
    pub instance_id: String,
    pub author_id: Option<String>,
    pub resource_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub authored_muted: bool,
    pub ancestor_hidden: bool,
    pub observed_at: f64,
    pub audible_media: bool,
    pub resolved_bus_instance_id: Option<String>,
    pub timing: TrackTiming,
    pub fader: TrackFader,
    pub fx_chain: FxChain,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fx_automation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub automation_diagnostics: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TrackTiming {
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub media_start: f64,
    pub source_duration: f64,
    pub playback_rate: f64,
    pub rate: serde_json::Value,
    pub r#loop: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TrackFader {
    pub kind: &'static str,
    pub evaluated: bool,
    // Not authorGain: native fallback can also depend on routing, live DOM
    // volume and prior ticks. Those facts have not been resolved at this stage.
    pub authored_volume: Option<f64>,
    pub fades: Fades,
    pub volume_keyframes: Option<Vec<VolumePoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_volume_lane: Option<Vec<Point>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AdmittedBus {
    pub instance_id: String,
    pub author_id: Option<String>,
    pub hidden: bool,
    pub member_instance_ids: Vec<String>,
    pub fader: BusFader,
    pub fx_chain: FxChain,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fx_automation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub automation_diagnostics: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BusFader {
    pub kind: &'static str,
    pub evaluated: bool,
    // Deliberately not a gain: native bus parsing/scheduling is not connected.
    pub raw_volume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_volume_lane: Option<Vec<Point>>,
}
