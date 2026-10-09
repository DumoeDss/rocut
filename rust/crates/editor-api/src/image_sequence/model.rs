use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MIME: &str = "application/vnd.rocut.image-sequence+json";
pub const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_frames: usize,
    pub max_manifests: usize,
    pub max_closure_bytes: u64,
    pub max_source_bytes: u64,
    pub max_resource_bytes: u64,
    pub max_manifest_bytes: u64,
    pub max_decoded_bytes: u64,
    pub max_dimension: u32,
    pub max_source_files: usize,
    pub max_source_parts: usize,
    pub max_parameter_depth: usize,
    pub max_parameter_elements: usize,
    pub max_parameter_string_bytes: usize,
    pub max_parameter_bytes: usize,
}

pub const LIMITS: Limits = Limits {
    max_frames: 36_000,
    max_manifests: 8,
    max_closure_bytes: 8 * 1024 * 1024 * 1024,
    max_source_bytes: 2 * 1024 * 1024 * 1024,
    max_resource_bytes: 16 * 1024 * 1024,
    max_manifest_bytes: 16 * 1024 * 1024,
    max_decoded_bytes: 128 * 1024 * 1024,
    max_dimension: 8192,
    max_source_files: 4096,
    max_source_parts: 8192,
    max_parameter_depth: 16,
    max_parameter_elements: 4096,
    max_parameter_string_bytes: 16 * 1024,
    max_parameter_bytes: 256 * 1024,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameLimits {
    pub max_decoded_bytes: u64,
    pub max_dimension: u32,
}
pub fn frame_limits() -> FrameLimits {
    FrameLimits {
        max_decoded_bytes: LIMITS.max_decoded_bytes,
        max_dimension: LIMITS.max_dimension,
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rate {
    pub numerator: u32,
    pub denominator: u32,
}
impl Rate {
    pub fn valid_playback(self) -> bool {
        self.numerator <= 120_000 && (1..=120_000).contains(&self.denominator)
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Alpha {
    Opaque,
    Straight,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub shot_id: String,
    pub render_id: String,
    pub frame_rate: Rate,
    pub width: u32,
    pub height: u32,
    pub first_file_frame: u64,
    pub alpha: Alpha,
    pub color_space: String,
    pub frames: Vec<Resource>,
    pub provenance: Provenance,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub engine: String,
    pub version: String,
    pub entry_file: String,
    pub parameters: Value,
    pub original_manifest: Resource,
    pub source_files: Vec<SourceFile>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceFile {
    pub path: String,
    pub byte_length: u64,
    pub sha256: String,
    pub parts: Vec<Resource>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestInput {
    pub resource_id: String,
    pub manifest: Manifest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceImage {
    pub image_key: String,
    pub manifest_id: String,
    pub manifest_sha256: String,
    pub ordinal: usize,
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
    pub alpha: Alpha,
}
