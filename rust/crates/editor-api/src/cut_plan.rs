//! Finite validation only. Creator authenticates decoded sources and applies through its author writer.
use bridge::export;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use time::FrameRate;
const MAX: i64 = 9_007_199_254_740_991;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Range {
    start_tick: i64,
    end_tick: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Track {
    track_id: String,
    mode: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Coverage {
    range: Range,
    tracks: Vec<Track>,
    scope: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grid {
    binding_id: String,
    expected_grid_revision: u64,
    expected_mapping_hash: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Boundary {
    key: String,
    tick: i64,
    point_id: Option<String>,
    off_grid_reason: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    kind: String,
    sha256: String,
    decoded_end_microseconds: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Clip {
    node_id: String,
    track_id: String,
    start_boundary: String,
    end_boundary: String,
    source_start_tick: i64,
    source: Source,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AudioEnd {
    source_sha256: String,
    sample_rate: i64,
    decoded_samples: i64,
    scene_start_tick: i64,
    source_start_tick: i64,
    author_end_tick: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tail {
    policy: String,
    node_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorClock {
    scene_origin_tick: i64,
    song_origin_tick: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    author_clock: AuthorClock,
    expected_native_revision: u64,
    grid: Grid,
    coverage: Coverage,
    boundaries: Vec<Boundary>,
    clips: Vec<Clip>,
    audio_end: AudioEnd,
    visual_tail: Tail,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    document: Value,
    request: Request,
}
fn text(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control)
}
fn tick(t: i64) -> bool {
    (0..=MAX).contains(&t)
}
fn nearest(n: i128, d: i128) -> Result<i64, String> {
    i64::try_from(n.div_euclid(d) + i128::from(n.rem_euclid(d) * 2 > d))
        .map_err(|_| "cut-plan-overflow".into())
}
fn audio_span(
    audio: &AudioEnd,
    grid: &Value,
    step: i64,
    offset: i64,
) -> Result<(i128, i128, i64), String> {
    if !(8000..=192000).contains(&audio.sample_rate)
        || !tick(audio.decoded_samples)
        || audio.decoded_samples == 0
        || !tick(audio.scene_start_tick)
        || !tick(audio.source_start_tick)
        || !tick(audio.author_end_tick)
        || audio.author_end_tick <= audio.scene_start_tick
    {
        return Err("cut-plan-audio-end-evidence-invalid".into());
    }
    let mapping = &grid["mapping"];
    if mapping["sourceSha256"] != audio.source_sha256
        || mapping["startTick"].as_i64() != audio.scene_start_tick.checked_add(offset)
        || mapping["trimStartTick"] != audio.source_start_tick
        || mapping["durationTick"] != audio.author_end_tick - audio.scene_start_tick
        || mapping["playbackRate"].as_f64() != Some(1.0)
        || mapping["reverse"] != false
    {
        return Err("cut-plan-author-song-mapping-conflict".into());
    }
    let d = i128::from(audio.sample_rate);
    let n = i128::from(audio.scene_start_tick) * d + i128::from(audio.decoded_samples) * 120_000
        - i128::from(audio.source_start_tick) * d;
    if n <= 0 || n > i128::from(MAX) {
        return Err("cut-plan-audio-end-overflow".into());
    }
    let visual_end =
        i64::try_from((n + d * i128::from(step) - 1) / (d * i128::from(step)) * i128::from(step))
            .map_err(|_| "cut-plan-overflow")?;
    Ok((n, d, visual_end))
}
fn validate(e: Envelope) -> Result<Value, String> {
    let r = e.request;
    let fps: FrameRate = serde_json::from_value(e.document["project"]["frameRate"].clone())
        .map_err(|_| "cut-plan-frame-rate-unavailable")?;
    let step = fps
        .ticks_per_frame()
        .filter(|s| *s > 0)
        .ok_or("cut-plan-frame-rate-unavailable")?;
    let range = &r.coverage.range;
    if !tick(r.author_clock.scene_origin_tick) || !tick(r.author_clock.song_origin_tick) {
        return Err("cut-plan-author-clock-invalid".into());
    }
    let offset = r.author_clock.scene_origin_tick - r.author_clock.song_origin_tick;
    if offset % step != 0
        || range
            .start_tick
            .checked_add(offset)
            .is_none_or(|t| !tick(t))
        || range.end_tick.checked_add(offset).is_none_or(|t| !tick(t))
    {
        return Err("cut-plan-author-scene-mapping-unavailable".into());
    }
    if !tick(range.start_tick)
        || !tick(range.end_tick)
        || range.start_tick >= range.end_tick
        || range.start_tick % step != 0
        || range.end_tick % step != 0
        || r.boundaries.len() < 2
        || r.boundaries.len() > 2000
        || r.clips.is_empty()
        || r.clips.len() > 2000
        || r.coverage.tracks.is_empty()
        || r.coverage.tracks.len() > 128
    {
        return Err("cut-plan-range-or-size-invalid".into());
    }
    let grid = crate::music_grid::query_value(
        e.document.clone(),
        json!({"kind":"read","bindingId":r.grid.binding_id,"expectedNativeRevision":r.expected_native_revision,"expectedGridRevision":r.grid.expected_grid_revision,"expectedMappingHash":r.grid.expected_mapping_hash,"limit":10000}),
    )?;
    if grid["total"].as_u64().is_none_or(|n| n > 10000) {
        return Err("cut-plan-grid-point-limit".into());
    }
    let points = grid["points"]
        .as_array()
        .ok_or("cut-plan-grid-unavailable")?;
    let (n, d, visual_end) = audio_span(&r.audio_end, &grid, step, offset)?;
    let mut boundaries = BTreeMap::new();
    let mut values = vec![];
    let mut issues = vec![];
    let mut previous = None;
    for (index, b) in r.boundaries.iter().enumerate() {
        if !text(&b.key) || !tick(b.tick) || boundaries.contains_key(&b.key) {
            return Err("cut-plan-boundary-invalid".into());
        }
        let scene_tick = b
            .tick
            .checked_add(offset)
            .filter(|t| tick(*t))
            .ok_or("cut-plan-author-scene-mapping-unavailable")?;
        let (frame, exact, residual) = if let Some(id) = &b.point_id {
            if b.off_grid_reason.is_some() {
                return Err("cut-plan-boundary-intent-ambiguous".into());
            }
            let p = points
                .iter()
                .find(|p| p["id"] == *id)
                .ok_or("cut-plan-grid-point-unavailable")?;
            if p["tick"].as_i64() != Some(scene_tick) {
                return Err("cut-plan-point-coordinate-conflict".into());
            }
            (
                p["frameTick"]
                    .as_i64()
                    .and_then(|t| t.checked_sub(offset))
                    .ok_or("cut-plan-grid-frame-unavailable")?,
                {
                    let denominator = p["exactTick"]["denominator"]
                        .as_i64()
                        .ok_or("cut-plan-grid-frame-unavailable")?;
                    let numerator = i128::from(
                        p["exactTick"]["numerator"]
                            .as_i64()
                            .ok_or("cut-plan-grid-frame-unavailable")?,
                    ) - i128::from(offset) * i128::from(denominator);
                    if numerator.abs() > i128::from(MAX) {
                        return Err("cut-plan-exact-coordinate-unavailable".into());
                    }
                    json!({"numerator":numerator,"denominator":denominator})
                },
                p["frameQuantizationResidual"].clone(),
            )
        } else {
            if b.off_grid_reason.as_ref().is_none_or(|s| !text(s)) {
                return Err("cut-plan-off-grid-reason-required".into());
            }
            if index == r.boundaries.len() - 1 && b.tick == r.audio_end.author_end_tick {
                (
                    visual_end,
                    json!({"numerator":n,"denominator":d}),
                    json!({"numerator":i128::from(visual_end)*d-n,"denominator":d}),
                )
            } else {
                let frame = nearest(i128::from(b.tick), i128::from(step))?
                    .checked_mul(step)
                    .ok_or("cut-plan-overflow")?;
                (
                    frame,
                    json!({"numerator":b.tick,"denominator":1}),
                    json!({"numerator":frame-b.tick,"denominator":1}),
                )
            }
        };
        if previous.is_some_and(|p| p >= frame) {
            issues
                .push(json!({"code":"boundary-collision-or-order","key":b.key,"frameTick":frame}));
        }
        if frame < range.start_tick || frame > range.end_tick {
            issues.push(json!({"code":"boundary-outside-coverage","key":b.key}));
        }
        previous = Some(frame);
        boundaries.insert(b.key.clone(), frame);
        let native_frame = frame
            .checked_add(offset)
            .filter(|t| tick(*t))
            .ok_or("cut-plan-author-scene-mapping-unavailable")?;
        values.push(json!({"key":b.key,"originalTick":b.tick,"sceneOriginalTick":scene_tick,"frameTick":frame,"nativeFrameTick":native_frame,"delta":frame-b.tick,"exactTick":exact,"frameQuantizationResidual":residual,"pointId":b.point_id,"offGridReason":b.off_grid_reason}));
    }
    if values
        .first()
        .is_none_or(|v| v["frameTick"] != range.start_tick)
        || values
            .last()
            .is_none_or(|v| v["frameTick"] != range.end_tick)
    {
        issues.push(json!({"code":"coverage-endpoints-mismatch"}));
    }
    let mut tracks = BTreeSet::new();
    for t in &r.coverage.tracks {
        if !text(&t.track_id)
            || !tracks.insert(&t.track_id)
            || !["contiguous", "sparse"].contains(&t.mode.as_str())
        {
            return Err("cut-plan-track-invalid".into());
        }
    }
    if !r.coverage.tracks.iter().any(|t| t.mode == "contiguous") {
        return Err("cut-plan-contiguous-track-required".into());
    }
    let mut ids = BTreeSet::new();
    let mut clips = vec![];
    let mut intervals: BTreeMap<&str, Vec<(i64, i64, &str)>> = BTreeMap::new();
    for c in &r.clips {
        if !text(&c.node_id)
            || !ids.insert(&c.node_id)
            || !tracks.contains(&c.track_id)
            || !tick(c.source_start_tick)
            || !["image", "video"].contains(&c.source.kind.as_str())
            || !crate::mv_audio::digest(&c.source.sha256)
        {
            return Err("cut-plan-clip-invalid".into());
        }
        let start = *boundaries
            .get(&c.start_boundary)
            .ok_or("cut-plan-boundary-reference-invalid")?;
        let end = *boundaries
            .get(&c.end_boundary)
            .ok_or("cut-plan-boundary-reference-invalid")?;
        if end - start < step {
            issues.push(json!({"code":"clip-shorter-than-one-frame","nodeId":c.node_id}));
        }
        if c.source.kind == "video" {
            if c.source.decoded_end_microseconds <= 0 || !tick(c.source.decoded_end_microseconds) {
                return Err("cut-plan-source-evidence-invalid".into());
            }
            let requested = i128::from(c.source_start_tick) + i128::from(end) - i128::from(start);
            if requested * 1_000_000 > i128::from(c.source.decoded_end_microseconds) * 120_000 {
                issues.push(json!({"code":"source-out-of-bounds","nodeId":c.node_id,"requestedEndTick":requested,"availableEndMicroseconds":c.source.decoded_end_microseconds}));
            }
        }
        intervals
            .entry(&c.track_id)
            .or_default()
            .push((start, end, &c.node_id));
        clips.push(json!({"nodeId":c.node_id,"trackId":c.track_id,"range":{"startTick":start,"endTick":end},"sourceStartTick":c.source_start_tick}));
    }
    for t in &r.coverage.tracks {
        let mut rows = intervals.remove(t.track_id.as_str()).unwrap_or_default();
        rows.sort_by_key(|v| (v.0, v.1));
        let mut cursor = range.start_tick;
        for (start, end, id) in rows {
            if start < cursor {
                issues.push(json!({"code":"track-overlap","trackId":t.track_id,"nodeId":id,"startTick":start,"previousEndTick":cursor}));
            }
            if t.mode == "contiguous" && start > cursor {
                issues.push(json!({"code":"track-gap","trackId":t.track_id,"startTick":cursor,"endTick":start}));
            }
            cursor = cursor.max(end);
        }
        if t.mode == "contiguous" && cursor != range.end_tick {
            issues.push(json!({"code":"track-gap","trackId":t.track_id,"startTick":cursor,"endTick":range.end_tick}));
        }
    }
    let audio = &r.audio_end;
    if (i128::from(audio.author_end_tick) * d - n).abs() * 2 > d {
        issues.push(json!({"code":"audio-end-truncated-or-padded"}));
    }
    if !["full-song", "partial"].contains(&r.coverage.scope.as_str()) {
        return Err("cut-plan-coverage-scope-invalid".into());
    }
    if r.coverage.scope == "full-song" && range.end_tick != visual_end
        || range.end_tick > visual_end
    {
        issues.push(json!({"code":"visual-end-does-not-cover-audio","requiredEndTick":visual_end}));
    }
    if !["real-source", "fixed-image"].contains(&r.visual_tail.policy.as_str()) {
        return Err("cut-plan-visual-tail-policy-unavailable".into());
    }
    if range.end_tick == visual_end
        && r.visual_tail.policy == "fixed-image"
        && r.clips
            .iter()
            .find(|c| Some(&c.node_id) == r.visual_tail.node_id.as_ref())
            .is_none_or(|c| {
                c.source.kind != "image" || boundaries.get(&c.end_boundary) != Some(&range.end_tick)
            })
    {
        issues.push(json!({"code":"fixed-image-tail-required"}));
    }
    Ok(
        json!({"status":if issues.is_empty(){"ready"}else{"blocked"},"nativeRevision":r.expected_native_revision,"gridRevision":grid["gridRevision"],"mappingHash":grid["mappingHash"],"mapping":grid["mapping"],"binding":grid["binding"],"requiredSources":grid["requiredSources"],"frameRate":fps,"ticksPerFrame":step,"boundaries":values,"clips":clips,"audioEnd":audio.author_end_tick,"audioSampleEnd":{"numerator":n,"denominator":d},"visualEndTick":visual_end,"visualTailPolicy":r.visual_tail.policy,"issues":issues}),
    )
}
#[export]
pub fn validate_cut_plan_json(input: String) -> String {
    let result = serde_json::from_str::<Envelope>(&input)
        .map_err(|_| "cut-plan-schema-invalid".to_owned())
        .and_then(validate);
    match result { Ok(value)=>value,Err(reason)=>json!({"status":if reason.contains("conflict"){"conflict"}else{"unavailable"},"reason":reason}) }.to_string()
}
