//! Lossless delivery of the already mixed stereo native soundtrack.
//! This owner does not clamp, resample, reinterpret gains, or execute codecs.
use super::{MAX_OBSERVATION_BYTES, MAX_PCM_BYTES};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    sample_rate: u32,
    frames: u32,
}

#[bridge::export]
pub fn encode_remotion_produced_audio_wav(input: Vec<u8>) -> Result<Vec<u8>, String> {
    if input.len() < 4 || input.len() as u64 > MAX_PCM_BYTES + MAX_OBSERVATION_BYTES as u64 + 4 {
        return Err("Native produced WAV envelope exceeds its byte budget".into());
    }
    let length = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    if length > MAX_OBSERVATION_BYTES || length > input.len() - 4 {
        return Err("Invalid native produced WAV header".into());
    }
    let request: Request =
        serde_json::from_slice(&input[4..4 + length]).map_err(|error| error.to_string())?;
    let pcm = &input[4 + length..];
    let expected = u64::from(request.frames) * 8;
    if request.version != 1
        || !matches!(request.sample_rate, 44100 | 48000)
        || request.frames == 0
        || expected > MAX_PCM_BYTES
        || expected != pcm.len() as u64
    {
        return Err("Native produced WAV rate/frame geometry is not admitted".into());
    }
    if pcm
        .chunks_exact(4)
        .any(|sample| !f32::from_le_bytes(sample.try_into().unwrap()).is_finite())
    {
        return Err("Native produced WAV cannot contain nonfinite PCM".into());
    }
    let mut output = Vec::with_capacity(pcm.len() + 56);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(expected as u32 + 48).to_le_bytes());
    output.extend_from_slice(b"WAVEfmt ");
    output.extend_from_slice(&16u32.to_le_bytes());
    output.extend_from_slice(&3u16.to_le_bytes()); // WAVE_FORMAT_IEEE_FLOAT
    output.extend_from_slice(&2u16.to_le_bytes());
    output.extend_from_slice(&request.sample_rate.to_le_bytes());
    output.extend_from_slice(&(request.sample_rate * 8).to_le_bytes());
    output.extend_from_slice(&8u16.to_le_bytes());
    output.extend_from_slice(&32u16.to_le_bytes());
    output.extend_from_slice(b"fact");
    output.extend_from_slice(&4u32.to_le_bytes());
    output.extend_from_slice(&request.frames.to_le_bytes());
    output.extend_from_slice(b"data");
    output.extend_from_slice(&(expected as u32).to_le_bytes());
    output.extend_from_slice(pcm);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn packet(header: serde_json::Value, samples: &[f32]) -> Vec<u8> {
        let encoded = header.to_string();
        let mut bytes = (encoded.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(encoded.as_bytes());
        for value in samples {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn native_mix_is_delivered_losslessly_without_clamping() {
        for rate in [44100, 48000] {
            let pcm = [2.5f32, -3.0, -0.0, f32::MIN_POSITIVE];
            let input = packet(json!({"version":1,"sampleRate":rate,"frames":2}), &pcm);
            let wav = encode_remotion_produced_audio_wav(input).unwrap();
            assert_eq!(&wav[..4], b"RIFF");
            assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 64);
            assert_eq!(u16::from_le_bytes(wav[20..22].try_into().unwrap()), 3);
            assert_eq!(&wav[36..40], b"fact");
            assert_eq!(u32::from_le_bytes(wav[44..48].try_into().unwrap()), 2);
            assert_eq!(&wav[48..52], b"data");
            let expected: Vec<u8> = pcm.into_iter().flat_map(f32::to_le_bytes).collect();
            assert_eq!(&wav[56..], expected);
        }
    }
    #[test]
    fn invalid_rate_geometry_closed_header_and_nonfinite_pcm_fail() {
        for header in [
            json!({"version":2,"sampleRate":48000,"frames":1}),
            json!({"version":1,"sampleRate":96000,"frames":1}),
            json!({"version":1,"sampleRate":48000,"frames":0}),
            json!({"version":1,"sampleRate":48000,"frames":2}),
            json!({"version":1,"sampleRate":48000,"frames":1,"channels":2}),
        ] {
            assert!(encode_remotion_produced_audio_wav(packet(header, &[0.0, 0.0])).is_err());
        }
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(
                encode_remotion_produced_audio_wav(packet(
                    json!({"version":1,"sampleRate":48000,"frames":1}),
                    &[value, 0.0]
                ))
                .is_err()
            );
        }
        assert!(encode_remotion_produced_audio_wav(vec![255; 4]).is_err());
        assert!(encode_remotion_produced_audio_wav(Vec::new()).is_err());
    }
}
