//! Canonical clip-local dry PCM, before fader and FX. No gain-scaled legacy mix.
use super::pcm;

/// Input: u32 LE manifest byte count, UTF-8 manifest, then ONE tempo-adjusted
/// stereo f32LE decoded source. Manifest {version:1,request:ExecutionRequest,
/// instanceId,bufferId} is revalidated; bufferId is the plan's dry source ID.
/// Output clock is clip-local zero; startSample is applied only during mixing.
#[bridge::export]
pub fn prepare_hyperframes_audio_dry_track_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let envelope = pcm::read(&input)?;
    let track = envelope
        .plan
        .tracks
        .iter()
        .find(|track| track.instance_id == envelope.manifest.instance_id)
        .ok_or("Unknown HyperFrames dry track instance")?;
    let source = envelope
        .plan
        .decoded_sources
        .iter()
        .find(|source| source.id == track.decoded_source_id)
        .ok_or("Missing HyperFrames decoded source plan")?;
    let stage = track
        .fx_stage
        .as_ref()
        .ok_or("Missing HyperFrames actual dry geometry")?;
    let frames = source
        .frames
        .ok_or("Missing HyperFrames actual decoded geometry")?;
    if envelope.manifest.buffer_id != source.id
        || Some(envelope.bytes.len() as u64) != source.pcm_bytes
    {
        return Err("HyperFrames dry PCM does not match the checked decoded source".into());
    }
    let mut output = vec![0u8; stage.input_frames as usize * 8];
    for frame in 0..stage.input_frames {
        let source_index = track.source_start_sample
            + if track.r#loop {
                frame % track.source_period_frames
            } else {
                frame
            };
        if source_index < frames {
            let from = source_index as usize * 8;
            let to = frame as usize * 8;
            output[to..to + 8].copy_from_slice(&envelope.bytes[from..from + 8]);
        }
    }
    Ok(output)
}

/// Same envelope with bufferId == instanceId and ONE complete native post-FX
/// buffer, including its native tail. Apply author gain and clip fades AFTER FX;
/// do not master, normalize, clip, crop or mix this track independently.
#[bridge::export]
pub fn apply_hyperframes_audio_track_gain_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let envelope = pcm::read(&input)?;
    let track = envelope
        .plan
        .tracks
        .iter()
        .find(|track| track.instance_id == envelope.manifest.instance_id)
        .ok_or("Unknown HyperFrames post-FX track instance")?;
    let stage = track
        .fx_stage
        .as_ref()
        .ok_or("Missing HyperFrames actual FX geometry")?;
    if envelope.manifest.buffer_id != track.instance_id
        || envelope.bytes.len() as u64 != stage.expected_output_frames * 8
    {
        return Err("HyperFrames post-FX PCM does not match the checked track stage".into());
    }
    let mut output = Vec::with_capacity(envelope.bytes.len());
    for (frame, samples) in envelope.bytes.chunks_exact(8).enumerate() {
        let gain = if track.muted {
            0.0
        } else {
            track
                .fader
                .as_ref()
                .ok_or("Missing complete HyperFrames post-FX fader")?
                .evaluate(frame as f64 / f64::from(envelope.plan.sample_rate)) as f32
        };
        for channel in samples.chunks_exact(4) {
            let sample = f32::from_le_bytes(channel.try_into().unwrap()) * gain;
            if !sample.is_finite() {
                return Err("Non-finite HyperFrames post-fader PCM".into());
            }
            output.extend_from_slice(&sample.to_le_bytes());
        }
    }
    Ok(output)
}
