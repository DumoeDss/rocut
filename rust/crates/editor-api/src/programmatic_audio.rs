//! Native-engine audio observations are untrusted input, not editor tracks yet.
//! Keep admission and source-time interpretation here; hosts only collect IO.
use bridge::export;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

mod decode;
mod envelope;
mod graph;
mod hyperframes;
mod mix;
mod produced;
mod range;
pub use produced::resolve_remotion_produced_assets_json;
mod produced_frames;
pub use produced_frames::resolve_remotion_produced_frames_json;
mod produced_pcm;
pub use produced_pcm::{
    mix_remotion_produced_audio_pcm, prepare_remotion_inline_audio_sources_json,
};
mod produced_wav;
pub use produced_wav::encode_remotion_produced_audio_wav;
mod schedule;
mod source;
mod timing;
pub use decode::resolve_native_audio_decode_json;
pub use graph::resolve_hyperframes_audio_discovery_json;
pub use graph::resolve_hyperframes_bus_fader_json;
pub use graph::{
    apply_hyperframes_audio_track_gain_pcm, mix_hyperframes_audio_bus_pcm,
    mix_hyperframes_audio_master_pcm, prepare_hyperframes_audio_dry_track_pcm,
    resolve_hyperframes_audio_execution_plan_json, resolve_hyperframes_audio_observations_json,
    resolve_hyperframes_audio_seek_json,
};
pub use graph::{normalize_hyperframes_fx_chain_json, resolve_hyperframes_audio_graph_json};
pub use hyperframes::resolve_hyperframes_audio_frame_json;
pub use mix::mix_programmatic_audio_pcm;
pub use range::resolve_programmatic_audio_range_json;
pub use schedule::resolve_programmatic_audio_schedule_json;
pub use source::resolve_programmatic_audio_source_json;
pub(crate) use source::{AudioSettings, deserialize_audio};

const MAX_SOURCES: usize = 64;
const MAX_ASSETS: usize = 64;
const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SECONDS: f64 = 86_400.0;
const MAX_PCM_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ANALYSIS_FRAMES: u32 = 36_000;
const MAX_OBSERVATION_BYTES: usize = 32 * 1024 * 1024;

#[export]
pub fn programmatic_audio_policy_json() -> String {
    serde_json::json!({
        "version": 1, "maxSources": MAX_SOURCES, "maxAssetsPerFrame": MAX_ASSETS,
        "maxSourceBytes": MAX_BYTES, "maxTotalBytes": MAX_TOTAL_BYTES,
        "maxSeconds": MAX_SECONDS,
        "maxPcmBytes": MAX_PCM_BYTES, "outputChannels": 2, "sampleRates": [44100, 48000],
        "maxAnalysisFrames": MAX_ANALYSIS_FRAMES, "maxObservationBytes": MAX_OBSERVATION_BYTES,
        "mimeTypes": ["audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "video/mp4", "video/webm"]
    }).to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Media {
    id: String,
    mime_type: String,
    byte_length: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Asset {
    id: String,
    resource_id: String,
    #[serde(rename = "type")]
    kind: String,
    frame: u32,
    media_frame: f64,
    audio_start_frame: f64,
    playback_rate: f64,
    volume: f64,
    tone_frequency: f64,
    audio_stream_index: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    frame_index: u32,
    frames_per_second: f64,
    sources: Vec<Media>,
    assets: Vec<Asset>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    id: String,
    resource_id: String,
    #[serde(rename = "type")]
    kind: String,
    source_time: f64,
    playback_rate: f64,
    volume: f64,
    tone_frequency: f64,
    audio_stream_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gain_envelope: Option<envelope::GainEnvelope>,
}

fn observations(r: Request) -> Result<Vec<Observation>, String> {
    if r.version != 1
        || r.frame_index >= 1_000_000
        || !r.frames_per_second.is_finite()
        || r.frames_per_second <= 0.0
        || r.frames_per_second > 120_000.0
        || r.sources.len() > MAX_SOURCES
        || r.assets.len() > MAX_ASSETS
    {
        return Err("Invalid or excessive native audio frame request".into());
    }
    let mut sources = HashMap::new();
    let mut total = 0u64;
    for source in &r.sources {
        if source.id.len() != 64
            || !source
                .id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || source.byte_length == 0
            || source.byte_length > MAX_BYTES
            || !matches!(
                source.mime_type.as_str(),
                "audio/wav"
                    | "audio/mpeg"
                    | "audio/ogg"
                    | "audio/flac"
                    | "video/mp4"
                    | "video/webm"
            )
            || sources.insert(&source.id, source).is_some()
        {
            return Err("Invalid or duplicate native audio source".into());
        }
        total = total.saturating_add(source.byte_length);
    }
    if total > MAX_TOTAL_BYTES {
        return Err("Native audio sources exceed the total byte limit".into());
    }
    let mut ids = HashSet::new();
    r.assets
        .into_iter()
        .map(|a| {
            let source = sources
                .get(&a.resource_id)
                .ok_or("Native audio source is not admitted")?;
            if a.id.is_empty()
                || a.id.len() > 256
                || a.id.chars().any(char::is_control)
                || !ids.insert(a.id.clone())
                || !matches!(a.kind.as_str(), "audio" | "video")
                || (a.kind == "video" && !source.mime_type.starts_with("video/"))
                || a.frame != r.frame_index
                || !a.media_frame.is_finite()
                || !a.audio_start_frame.is_finite()
                || a.audio_start_frame < 0.0
                || a.media_frame < a.audio_start_frame
                || !a.playback_rate.is_finite()
                || !(0.01..=16.0).contains(&a.playback_rate)
                || !a.volume.is_finite()
                || !(0.0..=64.0).contains(&a.volume)
                || !a.tone_frequency.is_finite()
                || !(0.01..=2.0).contains(&a.tone_frequency)
                || a.audio_stream_index > 31
            {
                return Err("Invalid native audio observation".into());
            }
            // Remotion 4.0.440 getActualTrimLeft(seamless=false): trim is a
            // source-frame offset; playbackRate applies only to elapsed media time.
            // Multiplying all of mediaFrame by rate double-scales trimBefore.
            let source_time = (a.audio_start_frame
                + (a.media_frame - a.audio_start_frame) * a.playback_rate)
                / r.frames_per_second;
            if !source_time.is_finite() || !(0.0..=MAX_SECONDS).contains(&source_time) {
                return Err("Native audio source time exceeds the limit".into());
            }
            Ok(Observation {
                id: a.id,
                resource_id: a.resource_id,
                kind: a.kind,
                source_time,
                playback_rate: a.playback_rate,
                volume: a.volume,
                tone_frequency: a.tone_frequency,
                audio_stream_index: a.audio_stream_index,
                gain_envelope: None,
            })
        })
        .collect()
}

#[export]
pub fn resolve_remotion_audio_frame_json(input: String) -> String {
    let result = (|| {
        if input.len() > 262_144 {
            return Err("Native audio observation payload exceeds the limit".into());
        }
        let request = serde_json::from_str::<Request>(&input).map_err(|e| e.to_string())?;
        observations(request)
    })();
    match result {
        Ok(assets) => serde_json::json!({"assets": assets}).to_string(),
        Err(error) => serde_json::json!({"error": error}).to_string(),
    }
}
