//! Shared checked binary envelope; manifests carry source graph evidence, never
//! a caller-forged trusted execution plan or a caller-provided allocation limit.
use super::execution::{MAX_EXECUTION_JSON, prepare};
use super::execution_model::{ExecutionPlan, ExecutionRequest};
use crate::programmatic_audio::MAX_PCM_BYTES;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    pub version: u32,
    pub request: ExecutionRequest,
    pub instance_id: String,
    pub buffer_id: String,
}

pub(super) struct Envelope<'a> {
    pub manifest: Manifest,
    pub plan: ExecutionPlan,
    pub bytes: &'a [u8],
}

pub(super) fn read(input: &[u8]) -> Result<Envelope<'_>, String> {
    if input.len() < 4 || input.len() as u64 > MAX_PCM_BYTES + MAX_EXECUTION_JSON as u64 + 4 {
        return Err("Invalid or excessive HyperFrames PCM envelope".into());
    }
    let header = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    if header > MAX_EXECUTION_JSON || header + 4 > input.len() {
        return Err("Invalid HyperFrames PCM manifest size".into());
    }
    let manifest: Manifest = serde_json::from_slice(&input[4..4 + header])
        .map_err(|error| format!("Invalid HyperFrames PCM manifest: {error}"))?;
    if manifest.version != 1 {
        return Err("Unsupported HyperFrames PCM envelope version".into());
    }
    let bytes = &input[4 + header..];
    if bytes.len() as u64 > MAX_PCM_BYTES || bytes.len() % 8 != 0 {
        return Err("Invalid HyperFrames stereo PCM byte count".into());
    }
    let plan = prepare(&manifest.request)?;
    if !plan.pcm_geometry_ready {
        return Err("HyperFrames decoded PCM geometry must be finalized before execution".into());
    }
    if bytes
        .chunks_exact(4)
        .any(|value| !f32::from_le_bytes(value.try_into().unwrap()).is_finite())
    {
        return Err("Non-finite HyperFrames input PCM".into());
    }
    Ok(Envelope {
        manifest,
        plan,
        bytes,
    })
}
