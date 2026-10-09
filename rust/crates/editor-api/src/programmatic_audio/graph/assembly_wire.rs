//! Complete canonical graph stage buffers. Identity and stage are independent
//! of the supplied order; no partial/missing/extraneous buffer is silently mixed.
use super::execution::{MAX_EXECUTION_JSON, prepare};
use super::execution_model::{ExecutionPlan, ExecutionRequest};
use crate::programmatic_audio::MAX_PCM_BYTES;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum BufferKind {
    TrackPostFx,
    BusPostFx,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BufferDescriptor {
    pub kind: BufferKind,
    pub instance_id: String,
    pub byte_length: u64,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) enum Output {
    Canonical,
    Crop,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    pub version: u32,
    pub request: ExecutionRequest,
    pub bus_instance_id: Option<String>,
    pub output: Option<Output>,
    pub buffers: Vec<BufferDescriptor>,
}

pub(super) struct Input<'a> {
    pub manifest: Manifest,
    pub plan: ExecutionPlan,
    pub buffers: HashMap<(BufferKind, String), &'a [u8]>,
}

pub(super) fn read(input: &[u8]) -> Result<Input<'_>, String> {
    if input.len() < 4 || input.len() as u64 > MAX_PCM_BYTES + MAX_EXECUTION_JSON as u64 + 4 {
        return Err("Invalid or excessive HyperFrames assembly envelope".into());
    }
    let header = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    if header > MAX_EXECUTION_JSON || header + 4 > input.len() {
        return Err("Invalid HyperFrames assembly manifest size".into());
    }
    if (input.len() - header - 4) as u64 > MAX_PCM_BYTES {
        return Err("HyperFrames assembly buffers exceed the PCM byte limit".into());
    }
    let manifest: Manifest = serde_json::from_slice(&input[4..4 + header])
        .map_err(|error| format!("Invalid HyperFrames assembly manifest: {error}"))?;
    if manifest.version != 1 || manifest.buffers.len() > 96 {
        return Err("Invalid HyperFrames assembly version/buffer count".into());
    }
    let plan = prepare(&manifest.request)?;
    if !plan.pcm_geometry_ready {
        return Err("HyperFrames decoded PCM geometry must be finalized before assembly".into());
    }
    let mut offset = 4 + header;
    let mut buffers = HashMap::new();
    for descriptor in &manifest.buffers {
        let count = descriptor.byte_length;
        if descriptor.instance_id.len() > 256
            || (count == 0
                && !plan.tracks.iter().any(|track| {
                    descriptor.kind == BufferKind::TrackPostFx
                        && descriptor.instance_id == track.instance_id
                        && track.requires_pcm
                        && track
                            .fx_stage
                            .as_ref()
                            .is_some_and(|stage| stage.expected_output_frames == 0)
                }))
            || count > MAX_PCM_BYTES
            || count % 8 != 0
            || count > (input.len() - offset) as u64
        {
            return Err("Invalid HyperFrames assembly PCM descriptor".into());
        }
        let bytes = &input[offset..offset + count as usize];
        if bytes
            .chunks_exact(4)
            .any(|value| !f32::from_le_bytes(value.try_into().unwrap()).is_finite())
        {
            return Err("Non-finite HyperFrames assembly input PCM".into());
        }
        if buffers
            .insert((descriptor.kind, descriptor.instance_id.clone()), bytes)
            .is_some()
        {
            return Err("Duplicate HyperFrames assembly buffer instance/stage".into());
        }
        offset += count as usize;
    }
    if offset != input.len() {
        return Err("Unexpected trailing HyperFrames assembly PCM bytes".into());
    }
    Ok(Input {
        manifest,
        plan,
        buffers,
    })
}

pub(super) fn take<'a>(
    input: &mut Input<'a>,
    kind: BufferKind,
    id: &str,
    bytes: u64,
) -> Result<&'a [u8], String> {
    let pcm = input
        .buffers
        .remove(&(kind, id.to_owned()))
        .ok_or_else(|| format!("Missing HyperFrames assembly buffer for {id}"))?;
    if pcm.len() as u64 != bytes {
        return Err("HyperFrames assembly buffer length disagrees with checked stage".into());
    }
    Ok(pcm)
}

pub(super) fn finish(input: &Input<'_>) -> Result<(), String> {
    if !input.buffers.is_empty() {
        return Err("Unexpected or nonparticipating HyperFrames assembly buffer".into());
    }
    Ok(())
}
