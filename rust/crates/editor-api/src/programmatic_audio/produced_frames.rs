//! Source-hydrated original Remotion render frame order, never a host FPS loop.
use super::{MAX_ANALYSIS_FRAMES, MAX_OBSERVATION_BYTES};
use crate::programmatic::resolve_programmatic_frame_json;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    source: Value,
}

#[bridge::export]
pub fn resolve_remotion_produced_frames_json(input: String) -> String {
    let result = (|| -> Result<Value, String> {
        if input.len() > MAX_OBSERVATION_BYTES {
            return Err("Remotion produced frame source exceeds its byte budget".into());
        }
        let request: Request = serde_json::from_str(&input).map_err(|error| error.to_string())?;
        if request.version != 1
            || request.source["runtime"] != "html-document"
            || request.source["build"]["engine"] != "remotion"
            || request.source["build"]["engineVersion"] != "4.0.440"
        {
            return Err("Native produced scan requires a fixed compiled Remotion source".into());
        }
        let initial: Value = serde_json::from_str(&resolve_programmatic_frame_json(
            json!({"source":request.source,
            "clipStart":0,"clipDuration":1,"trimStart":0,"timelineTime":0})
            .to_string(),
        ))
        .map_err(|error| error.to_string())?;
        if let Some(error) = initial.get("error") {
            return Err(error
                .as_str()
                .unwrap_or("Invalid Remotion produced frame source")
                .into());
        }
        let first = &initial["frame"];
        let count = first["durationFrames"]
            .as_u64()
            .ok_or("Missing Remotion canonical duration")?;
        if count == 0 || count > u64::from(MAX_ANALYSIS_FRAMES) {
            return Err("Remotion canonical produced scan exceeds the native frame budget".into());
        }
        let numerator = first["frameRate"]["numerator"]
            .as_u64()
            .ok_or("Missing source frame rate")?;
        let denominator = first["frameRate"]["denominator"]
            .as_u64()
            .ok_or("Missing source frame rate")?;
        let step = 120000 * denominator / numerator;
        let duration = count * step;
        let mut frames = Vec::with_capacity(count as usize);
        for index in 0..count {
            let mapped: Value = serde_json::from_str(&resolve_programmatic_frame_json(
                json!({"source":request.source,
                "clipStart":0,"clipDuration":duration,"trimStart":0,"timelineTime":index*step})
                .to_string(),
            ))
            .map_err(|error| error.to_string())?;
            if let Some(error) = mapped.get("error") {
                return Err(error
                    .as_str()
                    .unwrap_or("Invalid native produced frame")
                    .into());
            }
            if mapped["frame"]["index"].as_u64() != Some(index) {
                return Err(
                    "Remotion produced source mapper changed the native canonical frame index"
                        .into(),
                );
            }
            frames.push(mapped["frame"].clone());
        }
        let plan = json!({"profile":"remotion-4.0.440-native-produced-frames-v1","canonicalStartFrame":0,
            "canonicalEndFrameExclusive":count,"nativeSampleRate":48000,"frames":frames});
        if plan.to_string().len() > MAX_OBSERVATION_BYTES {
            return Err(
                "Remotion produced frame contexts exceed the observation byte budget".into(),
            );
        }
        Ok(plan)
    })();
    match result {
        Ok(plan) => json!({"plan":plan}).to_string(),
        Err(error) => json!({"error":error}).to_string(),
    }
}
