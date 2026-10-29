use super::model::*;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::{
    is_media_source_span_valid, resolve_directional_video_source_time,
    DirectionalVideoSourceTimeOptions, FrameRate, MediaSourceSpanOptions, MediaTime,
};

pub struct LiveClip<'a> {
    pub clip: &'a Value,
    pub asset: &'a Value,
    pub scene: String,
}
pub fn live_clip<'a>(doc: &'a Document, id: &str) -> Result<LiveClip<'a>, String> {
    let clip = doc
        .clips
        .iter()
        .find(|c| c["id"] == id)
        .ok_or("music-grid-clip-unavailable")?;
    let track = doc
        .tracks
        .iter()
        .find(|t| t["id"] == clip["trackId"])
        .ok_or("music-grid-track-unavailable")?;
    let asset = doc
        .assets
        .iter()
        .find(|a| a["id"] == clip["assetId"])
        .ok_or("music-grid-source-unavailable")?;
    if asset["kind"] != "audio" && !(asset["kind"] == "video" && clip["sourceComponent"] == "audio")
    {
        return Err("music-grid-song-clip-required".into());
    }
    let scene = track["sceneId"]
        .as_str()
        .filter(|s| text(s))
        .ok_or("music-grid-scene-unavailable")?
        .to_owned();
    if !doc.project["sceneState"]["scenes"]
        .as_array()
        .is_some_and(|scenes| scenes.iter().any(|s| s["id"] == scene))
    {
        return Err("music-grid-scene-unavailable".into());
    }
    Ok(LiveClip { clip, asset, scene })
}
pub fn integer(v: &Value, key: &str) -> Result<i64, String> {
    v[key]
        .as_i64()
        .filter(|n| (0..=MAX_TICK).contains(n))
        .ok_or_else(|| format!("music-grid-invalid-{key}"))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedPoint {
    pub id: String,
    pub source_tick: i64,
    pub downbeat: Option<bool>,
    pub exact_tick: ExactTick,
    pub tick: i64,
    pub frame_tick: i64,
    pub frame_quantization_delta: i64,
    pub frame_quantization_residual: ExactTick,
    pub source_mapping_delta: i64,
}
#[derive(Serialize)]
pub struct ExactTick {
    pub numerator: i64,
    pub denominator: i64,
}
fn rate_fraction(rate: f64) -> Result<(i64, i64), String> {
    if !rate.is_finite() || !(0.01..=5.0).contains(&rate) {
        return Err("music-grid-rate-unavailable".into());
    }
    let value = rate.to_string();
    let (whole, fraction) = value.split_once('.').unwrap_or((&value, ""));
    if fraction.len() > 6 {
        return Err("music-grid-rate-precision-unavailable".into());
    }
    let den = 10_i64.pow(fraction.len() as u32);
    let num = whole
        .parse::<i64>()
        .map_err(|_| "music-grid-rate-unavailable")?
        * den
        + fraction.parse::<i64>().unwrap_or(0);
    Ok((num, den))
}
fn nearest_fraction(num: i128, den: i128) -> Result<i64, String> {
    let floor = num.div_euclid(den);
    i64::try_from(floor + i128::from(num.rem_euclid(den) * 2 > den))
        .map_err(|_| "music-grid-overflow".into())
}
pub fn project_clock(
    doc: &Document,
    grid: &Grid,
    binding: &Binding,
    clock: &str,
) -> Result<(Vec<ProjectedPoint>, String, Value), String> {
    project_clock_points(doc, grid, binding, clock, false)
}
pub fn project_anchor_clock(
    doc: &Document,
    grid: &Grid,
    binding: &Binding,
    clock: &str,
) -> Result<(Vec<ProjectedPoint>, String, Value), String> {
    project_clock_points(doc, grid, binding, clock, true)
}
fn project_clock_points(
    doc: &Document,
    grid: &Grid,
    binding: &Binding,
    clock: &str,
    boundaries: bool,
) -> Result<(Vec<ProjectedPoint>, String, Value), String> {
    let live = live_clip(doc, &binding.clip_id)?;
    let scene = doc.project["sceneState"]["scenes"]
        .as_array()
        .and_then(|scenes| scenes.iter().find(|s| s["id"] == live.scene))
        .ok_or("music-grid-scene-unavailable")?;
    if clock != "scene-timeline-ticks"
        && !(clock == "project-timeline-ticks" && scene["isMain"] == true)
    {
        return Err("music-grid-target-clock-unavailable:no-authoritative-sequence-offset".into());
    }
    if live.scene != binding.scene_id
        || live.asset["id"] != binding.asset_id
        || live.asset["sourceSha256"] != grid.source_sha256
        || integer(live.asset, "duration")? != grid.source_duration_tick
    {
        return Err("music-grid-source-binding-conflict".into());
    }
    let c = live.clip;
    if c.get("freezeFrame").is_some_and(|v| !v.is_null())
        || c.get("rateCurve").is_some()
        || c["retime"].get("curve").is_some()
        || c["retime"].as_object().is_some_and(|v| {
            v.keys()
                .any(|k| !["rate", "reverse", "maintainPitch"].contains(&k.as_str()))
        })
    {
        return Err("music-grid-nonconstant-mapping-unavailable".into());
    }
    let start = integer(c, "startTime")?;
    let duration = integer(c, "duration")?;
    let trim = integer(c, "trimStart")?;
    if duration <= 0 || start.checked_add(duration).is_none_or(|v| v > MAX_TICK) {
        return Err("music-grid-clip-timing-unavailable".into());
    }
    let rate = c["retime"]["rate"].as_f64().unwrap_or(1.0);
    if c.get("retime").is_some_and(|retime| {
        !retime.is_null()
            && (retime["rate"].as_f64().is_none()
                || retime.get("reverse").is_some_and(|v| !v.is_boolean()))
    }) {
        return Err("music-grid-rate-unavailable".into());
    }
    let reverse = c["retime"]["reverse"].as_bool().unwrap_or(false);
    let (num, den) = rate_fraction(rate)?;
    if !is_media_source_span_valid(MediaSourceSpanOptions {
        trim_start: MediaTime::from_ticks(trim),
        trim_end: MediaTime::from_ticks(integer(c, "trimEnd")?),
        duration: MediaTime::from_ticks(duration),
        source_duration: MediaTime::from_ticks(grid.source_duration_tick),
        playback_rate: rate,
        freeze_frame: None,
    }) {
        return Err("music-grid-source-range-unavailable".into());
    }
    let source_at = |tick| {
        resolve_directional_video_source_time(DirectionalVideoSourceTimeOptions {
            clip_time: MediaTime::from_ticks(tick),
            clip_duration: MediaTime::from_ticks(duration),
            trim_start: MediaTime::from_ticks(trim),
            playback_rate: rate,
            reverse,
            freeze_frame: None,
            source_duration: Some(MediaTime::from_ticks(grid.source_duration_tick)),
        })
        .map(|t| t.as_ticks())
    };
    let first = source_at(0).ok_or("music-grid-source-range-unavailable")?;
    source_at(duration - 1).ok_or("music-grid-source-range-unavailable")?;
    let fps: FrameRate = serde_json::from_value(doc.project["frameRate"].clone())
        .map_err(|_| "music-grid-frame-rate-unavailable")?;
    let step = fps
        .ticks_per_frame()
        .filter(|s| *s > 0)
        .ok_or("music-grid-frame-rate-unavailable")?;
    let mut result = vec![];
    for point in &grid.points {
        let elapsed_num = if boundaries && reverse {
            i128::from(duration) * i128::from(num)
                - i128::from(point.source_tick - trim) * i128::from(den)
        } else {
            i128::from(if reverse {
                first - point.source_tick
            } else {
                point.source_tick - trim
            }) * i128::from(den)
        };
        let span = i128::from(duration) * i128::from(num);
        if elapsed_num < 0 || elapsed_num > span || (!boundaries && elapsed_num == span) {
            continue;
        }
        let exact_num = i128::from(start) * i128::from(num) + elapsed_num;
        if exact_num.abs() > i128::from(MAX_TICK) {
            return Err("music-grid-exact-coordinate-unavailable".into());
        }
        let tick = nearest_fraction(exact_num, i128::from(num))?;
        if tick > start + duration || (!boundaries && tick == start + duration) {
            continue;
        }
        let frame = nearest_fraction(exact_num, i128::from(num) * i128::from(step))?
            .checked_mul(step)
            .ok_or("music-grid-overflow")?;
        result.push(ProjectedPoint {
            id: point.id.clone(),
            source_tick: point.source_tick,
            downbeat: point.downbeat,
            exact_tick: ExactTick {
                numerator: i64::try_from(exact_num).map_err(|_| "music-grid-overflow")?,
                denominator: num,
            },
            tick,
            frame_tick: frame,
            frame_quantization_delta: frame - tick,
            frame_quantization_residual: ExactTick {
                numerator: i64::try_from(i128::from(frame) * i128::from(num) - exact_num)
                    .map_err(|_| "music-grid-overflow")?,
                denominator: num,
            },
            source_mapping_delta: if boundaries {
                let elapsed = i128::from(tick - start) * i128::from(num);
                nearest_fraction(
                    i128::from(trim) * i128::from(den)
                        + if reverse { span - elapsed } else { elapsed },
                    i128::from(den),
                )?
            } else {
                source_at(tick - start).ok_or("music-grid-source-range-unavailable")?
            } - point.source_tick,
        });
    }
    result.sort_by_key(|p| p.tick);
    let mapping = json!({"clipId":c["id"],"startTick":start,"durationTick":duration,"trimStartTick":trim,
        "trimEndTick":integer(c,"trimEnd")?,"playbackRate":rate,"reverse":reverse,"sourceDurationTick":grid.source_duration_tick,
        "sourceAtClipStartTick":first,"sceneId":live.scene,"frameRate":fps,"gridRevision":grid.revision,"sourceSha256":grid.source_sha256,
        "clock":clock,"sceneIsMain":scene["isMain"],"sceneOffsetTick":0,"reviewReference":grid.review_reference,"meterSegments":grid.meter_segments});
    let hash = format!("{:x}", Sha256::digest(mapping.to_string().as_bytes()));
    Ok((result, hash, mapping))
}
