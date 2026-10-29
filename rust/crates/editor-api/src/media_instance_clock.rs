//! Read-only physical clip clocks. No scene-parent topology is inferred.
use bridge::export;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::{
    DirectionalVideoSourceTimeOptions, MediaSourceSpanOptions, MediaTime,
    is_media_source_span_valid, resolve_directional_video_source_time,
};
const MAX: i64 = 9_007_199_254_740_991;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    pts_microseconds: i64,
    duration_microseconds: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Director {
    range_start_tick: i64,
    range_end_tick: i64,
    fps: i64,
    total_frames: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    expected_native_revision: u64,
    native_project_id: String,
    scene_id: String,
    clip_id: String,
    source_sha256: String,
    scene_tick: i64,
    decoded_end_microseconds: i64,
    #[serde(default)]
    frames: Vec<Frame>,
    #[serde(default)]
    timestamp_tolerance_microseconds: i64,
    director: Option<Director>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    document: Value,
    request: Request,
}
fn integer(v: &Value, key: &str) -> Result<i64, String> {
    v[key]
        .as_i64()
        .filter(|v| (0..=MAX).contains(v))
        .ok_or_else(|| format!("media-instance-invalid-{key}"))
}
fn resolve(e: Envelope) -> Result<Value, String> {
    let d = e.document;
    let r = e.request;
    if d["revision"].as_u64() != Some(r.expected_native_revision)
        || d["project"]["id"] != r.native_project_id
    {
        return Err("media-instance-project-revision-conflict".into());
    }
    if !crate::mv_audio::digest(&r.source_sha256)
        || !(0..=MAX).contains(&r.scene_tick)
        || !(1..=MAX).contains(&r.decoded_end_microseconds)
    {
        return Err("media-instance-request-invalid".into());
    }
    let scenes = d["project"]["sceneState"]["scenes"]
        .as_array()
        .ok_or("media-instance-scenes-unavailable")?;
    let scene = scenes
        .iter()
        .find(|s| s["id"] == r.scene_id)
        .ok_or("media-instance-scene-unavailable")?;
    let clips = d["clips"]
        .as_array()
        .ok_or("media-instance-clips-unavailable")?;
    let candidates: Vec<_> = clips.iter().filter(|c| c["id"] == r.clip_id).collect();
    if candidates.len() != 1 {
        return Err("media-instance-clip-ambiguous-or-unavailable".into());
    }
    let c = candidates[0];
    let track = d["tracks"]
        .as_array()
        .and_then(|a| a.iter().find(|t| t["id"] == c["trackId"]))
        .ok_or("media-instance-track-unavailable")?;
    if track["sceneId"] != r.scene_id {
        return Err("media-instance-scene-binding-conflict".into());
    }
    let a = d["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["id"] == c["assetId"]))
        .ok_or("media-instance-source-unavailable")?;
    if a["kind"] != "video"
        || a["sourceSha256"] != r.source_sha256
        || c.get("sourceComponent").is_some_and(|v| !v.is_null())
    {
        return Err("media-instance-fixed-video-conflict".into());
    }
    if c.get("rateCurve").is_some()
        || c["retime"].get("curve").is_some()
        || c["retime"].as_object().is_some_and(|v| {
            v.keys()
                .any(|k| !["rate", "reverse", "maintainPitch"].contains(&k.as_str()))
        })
    {
        return Err("media-instance-nonconstant-clock-unavailable".into());
    }
    let start = integer(c, "startTime")?;
    let duration = integer(c, "duration")?;
    let trim = integer(c, "trimStart")?;
    let trim_end = integer(c, "trimEnd")?;
    let source_duration = integer(a, "duration")?;
    let rate = if c["retime"].is_null() {
        1.0
    } else {
        c["retime"]["rate"]
            .as_f64()
            .ok_or("media-instance-rate-unavailable")?
    };
    if !rate.is_finite() || !(0.01..=5.0).contains(&rate) {
        return Err("media-instance-rate-unavailable".into());
    }
    let reverse = if c["retime"].get("reverse").is_none() {
        false
    } else {
        c["retime"]["reverse"]
            .as_bool()
            .ok_or("media-instance-direction-invalid")?
    };
    let freeze = if c["freezeFrame"].is_null() {
        None
    } else {
        Some(MediaTime::from_ticks(integer(c, "freezeFrame")?))
    };
    if duration <= 0 || start.checked_add(duration).is_none_or(|v| v > MAX) {
        return Err("media-instance-interval-invalid".into());
    }
    if r.scene_tick < start || r.scene_tick >= start + duration {
        return Err("media-instance-query-outside-half-open-clip".into());
    }
    if !is_media_source_span_valid(MediaSourceSpanOptions {
        trim_start: MediaTime::from_ticks(trim),
        trim_end: MediaTime::from_ticks(trim_end),
        duration: MediaTime::from_ticks(duration),
        source_duration: MediaTime::from_ticks(source_duration),
        playback_rate: rate,
        freeze_frame: freeze,
    }) {
        return Err("media-instance-source-range-unavailable".into());
    }
    let at = |local| {
        resolve_directional_video_source_time(DirectionalVideoSourceTimeOptions {
            clip_time: MediaTime::from_ticks(local),
            clip_duration: MediaTime::from_ticks(duration),
            trim_start: MediaTime::from_ticks(trim),
            playback_rate: rate,
            reverse,
            freeze_frame: freeze,
            source_duration: Some(MediaTime::from_ticks(source_duration)),
        })
        .map(|t| t.as_ticks())
        .ok_or("media-instance-source-clock-unavailable")
    };
    let first = at(0)?;
    let last = at(duration - 1)?;
    let source = at(r.scene_tick - start)?;
    if i128::from(first.max(last).max(source)) * 1_000_000
        >= i128::from(r.decoded_end_microseconds) * 120_000
    {
        return Err("media-instance-decoded-source-too-short".into());
    }
    let placement = json!({"nativeProjectId":r.native_project_id,"sceneId":r.scene_id,"clipId":r.clip_id,"trackId":c["trackId"],"assetId":a["id"],"sourceSha256":r.source_sha256,"clip":c,"sourceDurationTick":source_duration});
    let hash = format!("{:x}", Sha256::digest(placement.to_string().as_bytes()));
    let mut result = json!({"status":"ready","nativeRevision":r.expected_native_revision,"placementHash":hash,"placement":placement,"scene":{"coordinate":"scene-timeline-ticks","sceneId":r.scene_id,"tick":r.scene_tick},"projectGlobal":if scene["isMain"]==true {json!({"status":"main-scene-alias","tick":r.scene_tick})}else{json!({"status":"not-asserted","reason":"no-authoritative-sequence-offset"})},"source":{"coordinate":"asset-source-ticks","tick":source,"ticksPerSecond":120000,"timeSeconds":source as f64/120000.0},"requiredSources":[{"assetId":a["id"],"sourceSha256":r.source_sha256}]});
    if !r.frames.is_empty() {
        if r.frames.len() > 108_000 || !(0..=10_000).contains(&r.timestamp_tolerance_microseconds) {
            return Err("media-instance-frame-evidence-invalid".into());
        }
        let tolerance = i128::from(r.timestamp_tolerance_microseconds);
        let mut end = 0;
        let mut selected = None;
        for (i, f) in r.frames.iter().enumerate() {
            if f.pts_microseconds < 0
                || f.duration_microseconds <= 0
                || f.pts_microseconds
                    .checked_add(f.duration_microseconds)
                    .is_none_or(|v| v > MAX)
                || (i128::from(f.pts_microseconds) - i128::from(end)).abs() > tolerance
            {
                return Err("media-instance-frame-schedule-discontinuous".into());
            }
            end = f.pts_microseconds + f.duration_microseconds;
            let sample = i128::from(source) * 1_000_000;
            if sample >= i128::from(f.pts_microseconds) * 120_000
                && sample < i128::from(end) * 120_000
            {
                if selected.is_some() {
                    return Err("media-instance-frame-ambiguous".into());
                }
                selected = Some(i);
            }
        }
        if (i128::from(end) - i128::from(r.decoded_end_microseconds)).abs() > tolerance {
            return Err("media-instance-decoded-end-conflict".into());
        }
        let i = selected.ok_or("media-instance-sample-has-no-containing-frame")?;
        let f = &r.frames[i];
        result["frame"] = json!({"status":"mapped","index":i,"selection":"native-source-sample-contained-in-decoded-half-open-frame","ptsMicroseconds":f.pts_microseconds,"durationMicroseconds":f.duration_microseconds,"sourceSampleResidual":{"numerator":i128::from(source)*1_000_000-i128::from(f.pts_microseconds)*120_000,"denominator":1_000_000},"timestampToleranceMicroseconds":r.timestamp_tolerance_microseconds});
        if let Some(m) = r.director {
            if ![24, 25, 30, 50, 60].contains(&m.fps)
                || m.range_start_tick < 0
                || m.range_end_tick <= m.range_start_tick
                || m.range_end_tick > MAX
                || m.total_frames != r.frames.len() as i64
                || (i128::from(m.range_end_tick - m.range_start_tick) * i128::from(m.fps) + 47999)
                    / 48000
                    != i128::from(m.total_frames)
            {
                return Err("media-instance-director-schedule-invalid".into());
            }
            for (i, f) in r.frames.iter().enumerate() {
                let fps = i128::from(m.fps);
                if (i128::from(f.pts_microseconds) * fps - i as i128 * 1_000_000).abs()
                    > tolerance * fps
                    || (i128::from(f.duration_microseconds) * fps - 1_000_000).abs()
                        > tolerance * fps
                {
                    return Err("media-instance-director-frame-schedule-conflict".into());
                }
            }
            let scope = i128::from(m.range_start_tick) + i as i128 * 48000 / i128::from(m.fps);
            result["director"] = json!({"status":"mapped","coordinate":"director-render-scope-ticks","ticksPerSecond":48000,"tick":scope,"frameIndex":i,"at120000":{"numerator":scope*5,"denominator":2},"internalSceneInstances":"not-asserted"});
        }
    } else if r.director.is_some() {
        return Err("media-instance-decoded-frames-required".into());
    }
    Ok(result)
}
#[export]
pub fn query_media_instance_clock_json(input: String) -> String {
    let result = serde_json::from_str::<Envelope>(&input)
        .map_err(|_| "media-instance-schema-invalid".to_string())
        .and_then(resolve);
    match result {Ok(v)=>v,Err(reason)=>json!({"status":if reason.contains("conflict"){"conflict"}else{"unavailable"},"reason":reason})}.to_string()
}
