use super::{MAX_BYTES, MAX_PCM_BYTES, MAX_SECONDS};
use bridge::export;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    mime_type: String,
    byte_length: u64,
    audio_stream_index: u32,
    sample_rate: u32,
    source_sample: u64,
    frames: u64,
    playback_rate: f64,
    tone_frequency: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata: Option<Metadata>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    channels: u32,
    sample_rate: u32,
    origin_seconds: f64,
}

#[export]
pub fn resolve_native_audio_decode_json(input: String) -> String {
    let result = (|| -> Result<Request, String> {
        if input.len() > 4096 {
            return Err("Native audio decode request exceeds the limit".into());
        }
        let r: Request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        if r.version != 1
            || r.byte_length == 0
            || r.byte_length > MAX_BYTES
            || !matches!(
                r.mime_type.as_str(),
                "audio/wav"
                    | "audio/mpeg"
                    | "audio/ogg"
                    | "audio/flac"
                    | "video/mp4"
                    | "video/webm"
            )
            || r.audio_stream_index > 31
            || !matches!(r.sample_rate, 44100 | 48000)
            || r.frames == 0
            || r.frames > MAX_PCM_BYTES / 8
            || !r.playback_rate.is_finite()
            || !(0.01..=16.0).contains(&r.playback_rate)
            || !r.tone_frequency.is_finite()
            || !(0.01..=2.0).contains(&r.tone_frequency)
            || r.source_sample as f64 / r.sample_rate as f64 * r.playback_rate > MAX_SECONDS
            || r.source_sample.checked_add(r.frames).is_none()
            || r.source_sample > 9_007_199_254_740_991
        {
            return Err("Invalid or excessive native audio decode request".into());
        }
        if let Some(m) = &r.metadata {
            if !(1..=64).contains(&m.channels)
                || !(1000..=384000).contains(&m.sample_rate)
                || !m.origin_seconds.is_finite()
                || m.origin_seconds.abs() > MAX_SECONDS
            {
                return Err("Native audio metadata exceeds the Rust limits".into());
            }
        }
        Ok(r)
    })();
    match result {
        Ok(r) => {
            serde_json::json!({"plan": r, "channels": 2, "outputBytes": r.frames * 8}).to_string()
        }
        Err(error) => serde_json::json!({"error": error}).to_string(),
    }
}
