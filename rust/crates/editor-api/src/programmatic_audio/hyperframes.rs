//! Accept facts sampled at the pinned HyperFrames runtime's native sync point.
//! Native code owns nested timing, loop wrapping and its resolved gain. The
//! common admission and PCM schedule remain the sole host-independent policy.
use super::{Asset, MAX_SECONDS, Media, Observation, Request, observations};
use bridge::export;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeAsset {
    id: String,
    resource_id: String,
    #[serde(rename = "type")]
    kind: String,
    time: f64,
    start: f64,
    end: f64,
    source_duration: f64,
    source_time: f64,
    playback_rate: f64,
    volume: f64,
    muted: bool,
    in_window: bool,
    #[serde(default)]
    gain_envelope: Option<super::envelope::GainEnvelope>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeRequest {
    version: u32,
    frame_index: u32,
    frames_per_second: f64,
    sources: Vec<Media>,
    assets: Vec<NativeAsset>,
}

fn normalize(r: NativeRequest) -> Result<Vec<Observation>, String> {
    let time = f64::from(r.frame_index) / r.frames_per_second;
    for asset in &r.assets {
        if let Some(envelope) = &asset.gain_envelope {
            envelope.validate()?;
            if (envelope.start - asset.start).abs() > 1e-7
                || (envelope.duration - (asset.end - asset.start)).abs() > 1e-7
                || (envelope.evaluate(asset.time) - asset.volume).abs() > 1e-7
            {
                return Err("HyperFrames gain envelope disagrees with its native observation".into());
            }
        }
        if !time.is_finite()
            || !asset.time.is_finite()
            || (asset.time - time).abs() > 1e-7
            || !asset.start.is_finite()
            || !(0.0..=MAX_SECONDS).contains(&asset.start)
            || !asset.end.is_finite()
            || !(asset.start..=MAX_SECONDS).contains(&asset.end)
            || !asset.source_duration.is_finite()
            || !(0.0..=MAX_SECONDS).contains(&asset.source_duration)
            || asset.source_duration == 0.0
            || !asset.source_time.is_finite()
            || !(0.0..=MAX_SECONDS).contains(&asset.source_time)
            || (asset.in_window && (time + 1e-7 < asset.start || time >= asset.end))
        {
            return Err("Invalid HyperFrames native audio timing observation".into());
        }
    }
    // Reuse the same strict source/ID/type/gain/rate admission as every native
    // soundtrack. The synthetic frame mapping is used only for that validation;
    // preserve the original native f64 time, without a frame round trip.
    let mapped = observations(Request {
        version: r.version,
        frame_index: r.frame_index,
        frames_per_second: r.frames_per_second,
        sources: r.sources,
        assets: r
            .assets
            .iter()
            .map(|a| Asset {
                id: a.id.clone(),
                resource_id: a.resource_id.clone(),
                kind: a.kind.clone(),
                frame: r.frame_index,
                media_frame: a.source_time * r.frames_per_second / a.playback_rate,
                audio_start_frame: 0.0,
                playback_rate: a.playback_rate,
                volume: a.volume,
                tone_frequency: 1.0,
                audio_stream_index: 0,
            })
            .collect(),
    })?;
    Ok(mapped
        .into_iter()
        .zip(r.assets)
        .filter_map(|(mut output, native)| {
            // Terminal video pictures may hold after source EOF. They are not an
            // audible replay of that last frame, and muted clips remain silent.
            if native.muted || !native.in_window || native.source_time >= native.source_duration {
                return None;
            }
        output.source_time = native.source_time;
        output.gain_envelope = native.gain_envelope;
            Some(output)
        })
        .collect())
}

#[export]
pub fn resolve_hyperframes_audio_frame_json(input: String) -> String {
    let result = (|| {
        if input.len() > 262_144 {
            return Err("HyperFrames audio observation payload exceeds the limit".into());
        }
        let request = serde_json::from_str::<NativeRequest>(&input).map_err(|e| e.to_string())?;
        normalize(request)
    })();
    match result {
        Ok(assets) => serde_json::json!({"assets": assets}).to_string(),
        Err(error) => serde_json::json!({"error": error}).to_string(),
    }
}
