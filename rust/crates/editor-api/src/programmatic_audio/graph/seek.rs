//! Internal collection descriptors. Native seconds are independent of the
//! enclosing picture frame's integer context; this is not a public frame API.
use super::discovery::resolve_hyperframes_audio_discovery_json;
use super::model::NATIVE_VERSION;
use super::validation::MAX_GRAPH_BYTES;
use crate::programmatic::resolve_programmatic_frame_json;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Seek {
    time: f64,
    instance_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    source: Value,
    graph: Value,
    #[serde(default)]
    seek: Option<Seek>,
    #[serde(default, rename = "nativeHistoryScan")]
    native_history_scan: bool,
}

fn descriptor(request: Request) -> Result<Value, String> {
    if request.source["runtime"] != "html-document"
        || request.source["build"]["engine"] != "hyperframes"
        || request.source["build"]["engineVersion"] != NATIVE_VERSION
        || request.source["audio"]["version"] != 1
        || request.source["audio"]["mode"] != "native"
    {
        return Err("Native seek requires a compiled native-audio HyperFrames source".into());
    }
    // Preserve all source/resource validation and decoder policies from the
    // existing frame mapper. No relaxed source DTO is accepted by this seam.
    let mapped: Value = serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":request.source,"clipStart":0,"clipDuration":1,
            "trimStart":0,"timelineTime":0})
        .to_string(),
    ))
    .map_err(|error| error.to_string())?;
    if let Some(error) = mapped.get("error") {
        return Err(error
            .as_str()
            .unwrap_or("Invalid native seek source")
            .into());
    }
    let mut frame = mapped["frame"].clone();
    if frame.is_null()
        || frame["frameRate"] != request.graph["frameRate"]
        || frame["durationFrames"] != request.graph["durationFrames"]
    {
        return Err("Native seek source and graph composition clocks disagree".into());
    }
    // Reuse the complete discovery admission, including identity, topology,
    // source budgets and FX. Only an actual discovery candidate is seekable.
    let discovered: Value = serde_json::from_str(&resolve_hyperframes_audio_discovery_json(
        request.graph.to_string(),
    ))
    .map_err(|error| error.to_string())?;
    if let Some(error) = discovered.get("error") {
        return Err(error.as_str().unwrap_or("Invalid native seek graph").into());
    }
    let plan = &discovered["plan"];
    let duration = plan["compositionSeconds"]
        .as_f64()
        .ok_or("Missing native seek composition clock")?;
    if request.native_history_scan {
        if request.seek.is_some() {
            return Err("Native history scan cannot also request a discovery seek".into());
        }
        let mut scan = plan["nativeHistoryScan"].clone();
        let frames = scan["times"]
            .as_array()
            .ok_or("Missing native history scan times")?
            .iter()
            .map(|time| {
                let mut mapped = frame.clone();
                native_frame_clock(&mut mapped, time.as_f64().unwrap());
                mapped
            })
            .collect::<Vec<_>>();
        scan["frames"] = json!(frames);
        return Ok(json!({"nativeHistoryScan":scan}));
    }
    let requested_seek = request.seek.ok_or("Missing native discovery seek")?;
    if !requested_seek.time.is_finite()
        || requested_seek.time < 0.0
        || requested_seek.time >= duration
    {
        return Err("Native seek time must be finite and inside the composition".into());
    }
    let seek = serde_json::to_value(&requested_seek).map_err(|error| error.to_string())?;
    if !plan["seeks"]
        .as_array()
        .is_some_and(|seeks| seeks.contains(&seek))
    {
        return Err(
            "Native seek time and instance identities must match a discovery candidate".into(),
        );
    }
    native_frame_clock(&mut frame, requested_seek.time);
    Ok(json!({"frame":frame,"seek":seek}))
}

fn native_frame_clock(frame: &mut Value, time: f64) {
    let numerator = frame["frameRate"]["numerator"].as_u64().unwrap();
    let denominator = frame["frameRate"]["denominator"].as_u64().unwrap();
    let frames = frame["durationFrames"].as_u64().unwrap();
    let index = ((time * numerator as f64 / denominator as f64).floor() as u64).min(frames - 1);
    let picture_ticks = index * (120_000 * denominator / numerator);
    frame["index"] = json!(index);
    frame["sourceTime"] = json!(picture_ticks);
    frame["timelineTime"] = json!(picture_ticks);
    if frame.get("sampleTime").is_some() {
        frame["sampleTime"] = json!(picture_ticks);
    }
    // The pinned driver's renderSeek consumes this exact native f64 value.
    // Never reconstruct it from index, integer ticks, or the audio sample grid.
    frame["time"] = json!(time);
}

/// Validate a discovery candidate and recover its render context without
/// quantizing its native clock. Browser snapshots returned after this seek are
/// still untrusted and require normal Rust graph/fader admission.
#[bridge::export]
pub fn resolve_hyperframes_audio_seek_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_GRAPH_BYTES {
            return Err("HyperFrames native seek payload exceeds the byte safety limit".into());
        }
        let request: Request = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid HyperFrames native seek JSON: {error}"))?;
        descriptor(request)
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error":error}).to_string(),
    }
}
