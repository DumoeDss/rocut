use super::{CREATOR_SCHEMA, Channel, Data, Provenance, Review, SCHEMA, digest};
use bridge::export;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fingerprint {
    sha256: String,
    byte_length: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    manifest: Value,
    music: Value,
    envelopes: Value,
    manifest_file: Fingerprint,
    music_file: Fingerprint,
    envelopes_file: Fingerprint,
    expected_audio_sha256: String,
    review: Review,
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .ok_or_else(|| format!("Missing analysis string: {key}"))
}
fn number(v: &Value, key: &str) -> Result<f64, String> {
    v[key]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| format!("Invalid analysis number: {key}"))
}
fn checked_file(v: &Value, f: &Fingerprint) -> bool {
    digest(&f.sha256)
        && v["sha256"].as_str() == Some(&f.sha256)
        && v["bytes"].as_u64() == Some(f.byte_length)
}
fn points(v: &Value, key: &str) -> Result<Vec<u64>, String> {
    v[key]
        .as_array()
        .ok_or_else(|| format!("Missing analysis points: {key}"))?
        .iter()
        .map(|n| {
            n.as_f64()
                .filter(|n| n.is_finite() && (0.0..=1800.0).contains(n))
                .map(|n| (n * 120000.0).round() as u64)
                .ok_or_else(|| format!("Invalid analysis point: {key}"))
        })
        .collect()
}
fn prepare(r: Request) -> Result<Data, String> {
    for v in [&r.manifest, &r.music, &r.envelopes] {
        if text(v, "schema")? != CREATOR_SCHEMA
            || text(v, "time_coordinate")? != "source-audio-seconds"
        {
            return Err("Expected Creator MV audio v1 in source-audio-seconds".into());
        }
    }
    if text(&r.manifest, "status")? != "complete"
        || text(&r.manifest, "command")? != "analyze"
        || text(&r.manifest, "review")? != "required"
        || text(&r.music, "review")? != "required"
        || !r.review.valid()
    {
        return Err("Completed analysis and a separate accepted review reference are required; do not edit the producer review flag".into());
    }
    if !digest(&r.expected_audio_sha256)
        || r.manifest["inputs"]["audio"]["sha256"].as_str() != Some(&r.expected_audio_sha256)
        || !checked_file(&r.manifest["outputs"]["music.json"], &r.music_file)
        || !checked_file(&r.manifest["outputs"]["envelopes.json"], &r.envelopes_file)
        || !digest(&r.manifest_file.sha256)
    {
        return Err(
            "Analysis input or output fingerprints do not match the completed manifest".into(),
        );
    }
    let duration = number(&r.envelopes, "duration")?;
    let fps = r.envelopes["fps"]
        .as_u64()
        .filter(|n| (1..=120).contains(n))
        .ok_or("Invalid analysis fps")? as u32;
    if number(&r.music["audio"], "duration")? != duration
        || r.envelopes["frame_count"].as_u64() != Some((duration * f64::from(fps)).ceil() as u64)
        || text(&r.envelopes["normalization"], "method")?
            != "per-channel p95 (max if p95 is zero), clipped to [0,1]"
    {
        return Err("Analysis duration, frame count or normalization mismatch".into());
    }
    let mut channels = BTreeMap::new();
    let mut scales = BTreeMap::new();
    for (key, channel) in [
        ("mix_rms", Channel::MixRms),
        ("low_power", Channel::LowPower),
        ("mid_power", Channel::MidPower),
        ("high_power", Channel::HighPower),
        ("vocal_rms", Channel::VocalRms),
    ] {
        if channel == Channel::VocalRms && r.envelopes["channels"].get(key).is_none() {
            continue;
        }
        let values: Vec<f64> = serde_json::from_value(r.envelopes["channels"][key].clone())
            .map_err(|_| format!("Invalid measured channel: {key}"))?;
        channels.insert(channel, values);
        scales.insert(
            channel,
            number(&r.envelopes["normalization"]["scales"], key)?,
        );
    }
    let data = Data {
        schema: SCHEMA.into(),
        duration,
        fps,
        channels,
        scales,
        beats: points(&r.music, "beats")?,
        downbeats: points(&r.music, "downbeats")?,
        strong_onsets: super::onset_import::from_music(&r.music, duration)?,
        stops: super::stops::from_music(&r.music, duration)?,
        provenance: Provenance {
            schema: CREATOR_SCHEMA.into(),
            input_sha256: r.expected_audio_sha256,
            vocal_sha256: r.manifest["inputs"]
                .get("vocals")
                .map(|v| text(v, "sha256").map(str::to_owned))
                .transpose()?,
            manifest_sha256: r.manifest_file.sha256,
            music_sha256: r.music_file.sha256,
            envelopes_sha256: r.envelopes_file.sha256,
            review: r.review,
        },
    };
    data.validate()?;
    Ok(data)
}
#[export]
pub fn prepare_mv_audio_json(input: String) -> String {
    let result = serde_json::from_str::<Request>(&input)
        .map_err(|e| e.to_string())
        .and_then(prepare);
    match result {
        Ok(data) => serde_json::json!({"data":data}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
