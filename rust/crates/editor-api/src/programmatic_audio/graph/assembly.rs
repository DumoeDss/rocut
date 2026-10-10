//! Stateful DSP runs outside these pure kernels. Track gain follows track FX;
//! bus gain follows bus FX; final mastering belongs to Rocut, exactly once.
use super::assembly_wire::{self, BufferKind, Output};
use super::bus_pcm;
use super::execution_model::PreparedTrack;

fn add_track(
    output: &mut [f32],
    track: &PreparedTrack,
    bytes: &[u8],
    sample_rate: u32,
) -> Result<(), String> {
    let frames = track
        .fx_stage
        .as_ref()
        .ok_or("Missing HyperFrames actual assembly geometry")?
        .expected_output_frames
        .min(track.output_trim_frames.unwrap_or(u64::MAX))
        .min((output.len() as u64 / 2).saturating_sub(track.start_sample));
    for frame in 0..frames {
        let gain = track.gain_at(frame as f64 / f64::from(sample_rate))? as f32;
        for channel in 0..2 {
            let index = frame as usize * 2 + channel;
            let value = f32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().unwrap());
            let target = &mut output[(track.start_sample + frame) as usize * 2 + channel];
            *target += value * gain;
            if !target.is_finite() {
                return Err("Non-finite HyperFrames canonical track sum".into());
            }
        }
    }
    Ok(())
}

/// Manifest {version:1,request:ExecutionRequest,busInstanceId,
/// buffers:[{kind:"track-post-fx",instanceId,byteLength}]}, then packed stereo
/// f32LE buffers. Returns full composition PCM for ONE bus's native FX stage.
#[bridge::export]
pub fn mix_hyperframes_audio_bus_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut input = assembly_wire::read(&input)?;
    if input.manifest.output.is_some() {
        return Err("Bus assembly cannot request a partial output".into());
    }
    let id = input
        .manifest
        .bus_instance_id
        .as_deref()
        .ok_or("Missing HyperFrames bus instance")?;
    let bus = input
        .plan
        .buses
        .iter()
        .find(|bus| bus.instance_id == id)
        .ok_or("Unknown HyperFrames assembly bus instance")?;
    let bus_id = bus.instance_id.clone();
    let requires = bus.requires_pcm;
    let mut output = vec![0.0f32; input.plan.render_frames as usize * 2];
    for index in 0..input.plan.tracks.len() {
        let track = &input.plan.tracks[index];
        if !requires
            || !track.requires_pcm
            || track.resolved_bus_instance_id.as_deref() != Some(&bus_id)
        {
            continue;
        }
        let id = track.instance_id.clone();
        let count = track
            .fx_stage
            .as_ref()
            .ok_or("Missing HyperFrames actual assembly geometry")?
            .expected_output_frames
            * 8;
        let pcm = assembly_wire::take(&mut input, BufferKind::TrackPostFx, &id, count)?;
        add_track(
            &mut output,
            &input.plan.tracks[index],
            pcm,
            input.plan.sample_rate,
        )?;
    }
    assembly_wire::finish(&input)?;
    Ok(output.into_iter().flat_map(f32::to_le_bytes).collect())
}

/// Manifest {version:1,request:ExecutionRequest,output:"canonical"|"crop",
/// buffers:[{kind:"track-post-fx"|"bus-post-fx",instanceId,byteLength}]}.
/// Only ungrouped tracks and required post-FX buses belong here. A grouped track
/// cannot be silently counted again. The complete canonical master is built
/// before cropping; headroom and negative bus curve gains are preserved.
#[bridge::export]
pub fn mix_hyperframes_audio_master_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut input = assembly_wire::read(&input)?;
    if input.manifest.bus_instance_id.is_some() || input.manifest.output.is_none() {
        return Err("Invalid HyperFrames master output selection".into());
    }
    let mut output = vec![0.0f32; input.plan.render_frames as usize * 2];
    // Stable admitted order, never packet order or HashMap iteration order.
    for index in 0..input.plan.tracks.len() {
        let track = &input.plan.tracks[index];
        if !track.requires_pcm || track.resolved_bus_instance_id.is_some() {
            continue;
        }
        let id = track.instance_id.clone();
        let count = track
            .fx_stage
            .as_ref()
            .ok_or("Missing HyperFrames actual assembly geometry")?
            .expected_output_frames
            * 8;
        let pcm = assembly_wire::take(&mut input, BufferKind::TrackPostFx, &id, count)?;
        add_track(
            &mut output,
            &input.plan.tracks[index],
            pcm,
            input.plan.sample_rate,
        )?;
    }
    for index in 0..input.plan.buses.len() {
        let bus = &input.plan.buses[index];
        if !bus.requires_pcm {
            continue;
        }
        let id = bus.instance_id.clone();
        let count = bus.fx_stage.max_output_bytes;
        let pcm = assembly_wire::take(&mut input, BufferKind::BusPostFx, &id, count)?;
        bus_pcm::add(
            &mut output,
            pcm,
            &input.plan.buses[index].fader,
            input.plan.sample_rate,
        )?;
    }
    assembly_wire::finish(&input)?;
    let range = if input.manifest.output == Some(Output::Crop) {
        let start = input.plan.crop_start_sample as usize * 2;
        start..start + input.plan.output_frames as usize * 2
    } else {
        0..output.len()
    };
    Ok(output[range]
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect())
}
