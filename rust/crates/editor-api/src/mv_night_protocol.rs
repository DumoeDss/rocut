use crate::{
    mv_recipe::{train, wet_floor},
    programmatic_resources::Resource,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontInstance {
    pub id: String,
    pub resource_id: String,
    pub weight: u16,
    pub axes: BTreeMap<String, f64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BinaryPart {
    pub resource_id: String,
    pub offset: usize,
    pub length: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ImageFact {
    pub resource_id: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Deserialize)]
#[serde(tag = "scene", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Settings {
    WetFloor { settings: wet_floor::Settings },
    Train { settings: train::Settings },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Prepare {
    pub binding: Settings,
    pub resources: Vec<Resource>,
    pub font_instances: Vec<FontInstance>,
    pub byte_layout: Vec<BinaryPart>,
    pub decoded_images: Vec<ImageFact>,
    /// Absolute mapped song beats are owned once, not re-authored per frame.
    pub beats: Vec<f64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Sample {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub session_id: u32,
    pub scene: &'static str,
    pub reflection_required: bool,
    pub post_required: bool,
    pub reserved_bytes: u64,
    pub decode_requests: Vec<DecodedImage>,
    /// Owner-derived logical aliases, NOT physical/authored generic resources.
    pub font_resources: Vec<Resource>,
    pub font_bindings: Vec<FontInstance>,
    pub font_instance_bytes: u64,
    pub physical_encoded_bytes: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedImage {
    pub resource_id: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub session_id: u32,
    pub frame_id: u32,
    pub scene: serde_json::Value,
    pub post_required: bool,
    pub post: Option<crate::ReferencePostPlan>,
    pub lut: Option<crate::mv_lut_atlas_bridge::BoundRow>,
    pub reserved_bytes: u64,
    pub scope: &'static str,
}
