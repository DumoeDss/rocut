use super::snapshot::Snapshot;
use crate::programmatic_audio::range::Rate;
use crate::programmatic_audio::timing::{AudioTiming, deserialize_timing};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const NATIVE_VERSION: &str = "0.8.139";
pub(super) const SEMANTICS_PROFILE: &str = "rocut-hyperframes-0.8.139-audio-graph-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GraphRequest {
    pub version: u32,
    pub semantics_profile: String,
    #[serde(default, deserialize_with = "deserialize_timing")]
    pub timing: AudioTiming,
    pub frame_rate: Rate,
    pub sample_rate: u32,
    pub first_frame: u32,
    pub frame_count: u32,
    pub duration_frames: u32,
    pub sources: Vec<Source>,
    pub snapshot: Snapshot,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Source {
    pub id: String,
    pub mime_type: String,
    pub byte_length: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NativeClip {
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub media_start: f64,
    pub source_duration: f64,
    pub playback_rate: f64,
    pub rate: Value,
    pub r#loop: bool,
    pub volume: Option<f64>,
    pub fades: Fades,
    pub volume_keyframes: Option<Vec<VolumePoint>>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Fades {
    pub fade_in: f64,
    pub fade_out: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VolumePoint {
    pub time: f64,
    pub volume: f64,
}
