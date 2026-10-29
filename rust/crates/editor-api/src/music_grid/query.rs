use super::{model::*, projection::*};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    pub kind: String,
    pub binding_id: String,
    #[serde(default = "scene_clock")]
    pub clock: String,
    pub anchor_source: Option<AnchorSource>,
    pub expected_native_revision: Option<u64>,
    pub expected_grid_revision: Option<u64>,
    pub expected_mapping_hash: Option<String>,
    #[serde(default = "beat")]
    pub point_kind: String,
    pub range: Option<Range>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "limit")]
    pub limit: usize,
    #[serde(default)]
    pub samples: Vec<Sample>,
    #[serde(default = "nearest")]
    pub direction: String,
    pub max_distance_ticks: Option<i64>,
    #[serde(default)]
    pub frame_quantize: bool,
}
fn scene_clock() -> String {
    "scene-timeline-ticks".into()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorSource {
    source_sha256: String,
    resource_sha256: String,
    resource_revision: u64,
    review_reference: String,
    anchors: Vec<Anchor>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Anchor {
    key: String,
    source_tick: i64,
}
fn beat() -> String {
    "beat".into()
}
fn nearest() -> String {
    "nearest".into()
}
fn limit() -> usize {
    1000
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Range {
    pub start_tick: i64,
    pub end_tick: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    pub key: String,
    pub tick: i64,
}
pub fn query(doc: Document, request: Query) -> Result<Value, String> {
    doc.revision(request.expected_native_revision)?;
    if !["read", "list", "snap", "validate", "project-anchors"].contains(&request.kind.as_str())
        || !["beat", "downbeat"].contains(&request.point_kind.as_str())
        || !["nearest", "before", "after"].contains(&request.direction.as_str())
        || request.limit == 0
        || request.limit > 10_000
        || request.samples.len() > 10_000
        || request
            .max_distance_ticks
            .is_some_and(|v| !(0..=MAX_TICK).contains(&v))
        || request.range.as_ref().is_some_and(|r| {
            r.start_tick < 0 || r.end_tick <= r.start_tick || r.end_tick > MAX_TICK
        })
    {
        return Err("music-grid-query-invalid".into());
    }
    if ["snap", "validate"].contains(&request.kind.as_str()) && request.max_distance_ticks.is_none()
    {
        return Err("music-grid-explicit-tolerance-required".into());
    }
    let mut keys = BTreeSet::new();
    if request
        .samples
        .iter()
        .any(|s| !text(&s.key) || !keys.insert(&s.key) || !(0..=MAX_TICK).contains(&s.tick))
    {
        return Err("music-grid-samples-invalid".into());
    }
    let state = doc.state()?;
    let binding = state
        .bindings
        .iter()
        .find(|b| b.id == request.binding_id)
        .ok_or("music-grid-binding-unavailable")?;
    let grid = state
        .grids
        .iter()
        .find(|g| g.id == binding.grid_id)
        .ok_or("music-grid-unavailable")?;
    if request
        .expected_grid_revision
        .is_some_and(|r| r != grid.revision)
    {
        return Err("music-grid-revision-conflict".into());
    }
    let (points, hash, mapping) = project_clock(&doc, grid, binding, &request.clock)?;
    if request
        .expected_mapping_hash
        .as_ref()
        .is_some_and(|expected| *expected != hash)
    {
        return Err("music-grid-mapping-conflict".into());
    }
    let filtered: Vec<_> = points
        .iter()
        .filter(|p| {
            (request.point_kind == "beat" || p.downbeat == Some(true))
                && request
                    .range
                    .as_ref()
                    .is_none_or(|r| p.tick >= r.start_tick && p.tick < r.end_tick)
        })
        .collect();
    let mut response = json!({"status":"ready","clock":request.clock,"clockCapabilities":{"sceneLocal":true,"projectMainScene":true,"nestedSequence":false,"directorManifest":false},"ticksPerSecond":120000,"sceneId":binding.scene_id,
        "binding":binding,"gridRevision":grid.revision,"nativeRevision":doc.revision,"mappingHash":hash,"mapping":mapping,"mode":grid.mode,
        "sourceAssetId":grid.asset_id,"sourceSha256":grid.source_sha256,"requiredSources":[{"assetId":grid.asset_id,"sourceSha256":grid.source_sha256}],"reviewReference":grid.review_reference,"meterSegments":grid.meter_segments,"downbeatsKnown":grid.points.iter().any(|p| p.downbeat.is_some())});
    if request.kind == "project-anchors" {
        let source = request
            .anchor_source
            .ok_or("music-grid-anchor-source-required")?;
        if source.source_sha256 != grid.source_sha256 {
            return Err("music-grid-anchor-source-conflict".into());
        }
        if !crate::mv_audio::digest(&source.resource_sha256)
            || source.resource_revision == 0
            || source.resource_revision > MAX_TICK as u64
            || !text(&source.review_reference)
            || source.anchors.len() > 10000
        {
            return Err("music-grid-anchor-resource-invalid".into());
        }
        let mut keys = BTreeSet::new();
        if !source.anchors.iter().all(|a| {
            text(&a.key)
                && keys.insert(&a.key)
                && (0..=grid.source_duration_tick).contains(&a.source_tick)
        }) {
            return Err("music-grid-anchor-points-invalid".into());
        }
        let mut anchor_grid = grid.clone();
        anchor_grid.points = source
            .anchors
            .iter()
            .map(|a| Point {
                id: a.key.clone(),
                source_tick: a.source_tick,
                downbeat: None,
            })
            .collect();
        let (projected, _, _) = project_anchor_clock(&doc, &anchor_grid, binding, &request.clock)?;
        response["anchorResource"] = json!({"sourceSha256":source.source_sha256,"resourceSha256":source.resource_sha256,"resourceRevision":source.resource_revision,"reviewReference":source.review_reference});
        response["results"]=json!(source.anchors.iter().map(|a| {
            let point=projected.iter().find(|p|p.id==a.key).filter(|p|request.range.as_ref().is_none_or(|r|p.tick>=r.start_tick&&p.tick<r.end_tick));
            match point { Some(p)=>{let mut value=serde_json::to_value(p).unwrap(); value["key"]=json!(a.key);value["status"]=json!("projected");value},None=>json!({"key":a.key,"sourceTick":a.source_tick,"status":"unavailable","reason":"outside-playable-window"}) }
        }).collect::<Vec<_>>());
        return Ok(response);
    }
    if request.anchor_source.is_some() {
        return Err("music-grid-anchor-source-unexpected".into());
    }
    if request.kind == "read" {
        response["grid"] = serde_json::to_value(grid).map_err(|_| "music-grid-serialization")?;
    }
    if request.kind == "read" || request.kind == "list" {
        response["total"] = json!(filtered.len());
        response["points"] = json!(filtered
            .iter()
            .skip(request.offset)
            .take(request.limit)
            .collect::<Vec<_>>());
        response["nextOffset"] = if request.offset.saturating_add(request.limit) < filtered.len() {
            json!(request.offset + request.limit)
        } else {
            Value::Null
        };
    } else {
        let mut results = vec![];
        for sample in &request.samples {
            let distance = |p: &&&ProjectedPoint| {
                i128::from(p.exact_tick.numerator)
                    - i128::from(sample.tick) * i128::from(p.exact_tick.denominator)
            };
            let candidate = filtered
                .iter()
                .filter(|p| match request.direction.as_str() {
                    "before" => distance(p) <= 0,
                    "after" => distance(p) >= 0,
                    _ => true,
                })
                .min_by_key(|p| (distance(p).abs(), p.tick));
            let value = candidate.and_then(|p| {
                let selected = if request.frame_quantize { p.frame_tick } else { p.tick };
                let delta = selected - sample.tick;
                (delta.abs() <= request.max_distance_ticks.unwrap() && distance(&p).abs() <= i128::from(request.max_distance_ticks.unwrap()) * i128::from(p.exact_tick.denominator)).then(|| json!({"key":sample.key,"originalTick":sample.tick,"status":"matched","pointId":p.id,
                    "candidateTick":p.tick,"snappedTick":selected,"delta":delta,"frameQuantizationDelta":p.frame_quantization_delta,"frameQuantizationResidual":p.frame_quantization_residual,"exactTick":p.exact_tick,"valid":true}))
            }).unwrap_or_else(|| json!({"key":sample.key,"originalTick":sample.tick,"status":"unmatched","valid":false,"reason":if filtered.is_empty() {"no-reviewed-points"} else {"no-point-within-tolerance"}}));
            results.push(value);
        }
        response["results"] = json!(results);
    }
    Ok(response)
}
