use super::{MAX_PCM_BYTES, schedule::Gain};
use bridge::export;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Clip {
    pcm_index: usize,
    output_start: u64,
    frames: u64,
    gains: Vec<Gain>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u32,
    sample_rate: u32,
    #[serde(default)]
    sample_origin: u64,
    channels: u32,
    output_frames: u64,
    pcm_bytes: Vec<u64>,
    clips: Vec<Clip>,
}

/// Wire IO: u32 LE JSON length, UTF-8 manifest, then packed interleaved stereo
/// f32LE buffers. Return interleaved PCM, not an encoded file or mastered output.
/// One binary argument avoids base64/JSON sample expansion across WASM.
#[export]
pub fn mix_programmatic_audio_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    if input.len() < 4 || input.len() as u64 > MAX_PCM_BYTES + 8 * 1024 * 1024 {
        return Err("Invalid or excessive audio PCM envelope".into());
    }
    let header = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    if header > 8 * 1024 * 1024 || header + 4 > input.len() {
        return Err("Invalid audio PCM header".into());
    }
    if (input.len() - header - 4) as u64 > MAX_PCM_BYTES {
        return Err("Audio PCM buffers exceed the total budget".into());
    }
    let m: Manifest = serde_json::from_slice(&input[4..4 + header]).map_err(|e| e.to_string())?;
    if m.version != 1
        || m.channels != 2
        || !matches!(m.sample_rate, 44100 | 48000)
        || m.output_frames == 0
        || m.output_frames > MAX_PCM_BYTES / 8
        || m.sample_origin
            .checked_add(m.output_frames)
            .is_none_or(|end| end > 9_007_199_254_740_991)
        || m.pcm_bytes.len() > 4096
        || m.clips.len() > 4096
    {
        return Err("Invalid audio PCM mix format/budget".into());
    }
    let mut offset = header + 4;
    let mut buffers = Vec::new();
    for count in m.pcm_bytes {
        if count == 0
            || count % 8 != 0
            || count > MAX_PCM_BYTES
            || count as usize > input.len() - offset
        {
            return Err("Invalid audio PCM buffer length".into());
        }
        let bytes = &input[offset..offset + count as usize];
        if bytes
            .chunks_exact(4)
            .any(|b| !f32::from_le_bytes(b.try_into().unwrap()).is_finite())
        {
            return Err("Non-finite audio PCM sample".into());
        }
        buffers.push(bytes);
        offset += count as usize;
    }
    if offset != input.len() {
        return Err("Unexpected trailing audio PCM bytes".into());
    }
    let mut output = vec![0f32; m.output_frames as usize * 2];
    for clip in m.clips {
        let bytes = buffers
            .get(clip.pcm_index)
            .ok_or("Missing audio PCM buffer")?;
        if clip.frames == 0
            || clip.frames > m.output_frames
            || clip.output_start > m.output_frames - clip.frames
            || clip.frames > bytes.len() as u64 / 8
        {
            return Err("Audio PCM clip exceeds its source/output range".into());
        }
        let mut position = 0u64;
        for gain in clip.gains {
            if gain.offset != position
                || gain.frames == 0
                || gain.frames > clip.frames - position
                || !gain.value.is_finite()
                || !(0.0..=64.0).contains(&gain.value)
            {
                return Err("Invalid or discontinuous audio gain spans".into());
            }
            if let Some(envelope) = &gain.envelope {
                envelope.validate()?;
            }
            for sample_index in position..position + gain.frames {
                let value = gain.envelope.as_ref().map_or(gain.value, |envelope| {
                    let absolute_sample = m.sample_origin + clip.output_start + sample_index;
                    envelope.evaluate(absolute_sample as f64 / m.sample_rate as f64)
                }) as f32;
                for channel in 0..2 {
                    let i = sample_index as usize * 2 + channel;
                    let start = i * 4;
                    let sample = f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap());
                    let target = &mut output[clip.output_start as usize * 2 + i];
                    *target += sample * value;
                    if !target.is_finite() {
                        return Err("Non-finite mixed audio sample".into());
                    }
                }
            }
            position += gain.frames;
        }
        if position != clip.frames {
            return Err("Audio gain spans must cover the complete clip".into());
        }
    }
    // Do not normalize or clip individual sources. Rocut's final master chain
    // must see the combined programmatic and ordinary timeline audio exactly once.
    Ok(output.into_iter().flat_map(f32::to_le_bytes).collect())
}
