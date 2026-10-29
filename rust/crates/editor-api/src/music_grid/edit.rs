use super::{model::*, projection::*};
use crate::mv_audio::Data;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRequest {
    pub expected_native_revision: u64,
    pub idempotency_key: String,
    pub operation: Operation,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Operation {
    CreateManualBpm {
        #[serde(rename = "clipId")]
        clip_id: String,
        segments: Value,
        #[serde(rename = "reviewReference")]
        review_reference: String,
    },
    ReplaceStructure {
        #[serde(rename = "gridId")]
        grid_id: String,
        #[serde(rename = "expectedGridRevision")]
        expected_grid_revision: u64,
        #[serde(rename = "meterSegments")]
        meter_segments: Vec<MeterSegment>,
        #[serde(rename = "reviewReference")]
        review_reference: String,
    },
    CreateMeasured {
        #[serde(rename = "clipId")]
        clip_id: String,
        analysis: Data,
        #[serde(rename = "reviewReference")]
        review_reference: String,
    },
    CreateManual {
        #[serde(rename = "clipId")]
        clip_id: String,
        points: Vec<Point>,
        #[serde(rename = "reviewReference")]
        review_reference: String,
    },
    ReplacePoints {
        #[serde(rename = "gridId")]
        grid_id: String,
        #[serde(rename = "expectedGridRevision")]
        expected_grid_revision: u64,
        points: Vec<Point>,
        #[serde(rename = "reviewReference")]
        review_reference: String,
    },
    Bind {
        #[serde(rename = "gridId")]
        grid_id: String,
        #[serde(rename = "expectedGridRevision")]
        expected_grid_revision: u64,
        #[serde(rename = "clipId")]
        clip_id: String,
    },
    Remove {
        #[serde(rename = "gridId")]
        grid_id: String,
        #[serde(rename = "expectedGridRevision")]
        expected_grid_revision: u64,
    },
}
fn binding(doc: &Document, grid: &Grid, clip_id: &str, id: String) -> Result<Binding, String> {
    let live = live_clip(doc, clip_id)?;
    if live.asset["id"] != grid.asset_id
        || live.asset["sourceSha256"] != grid.source_sha256
        || integer(live.asset, "duration")? != grid.source_duration_tick
    {
        return Err("music-grid-source-binding-conflict".into());
    }
    Ok(Binding {
        id,
        grid_id: grid.id.clone(),
        clip_id: clip_id.into(),
        asset_id: grid.asset_id.clone(),
        scene_id: live.scene,
    })
}
pub fn edit(doc: Document, request: EditRequest) -> Result<Value, String> {
    doc.revision(Some(request.expected_native_revision))?;
    if !text(&request.idempotency_key) {
        return Err("music-grid-idempotency-required".into());
    }
    let mut state = doc.state()?;
    let before = state.clone();
    let digest = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}:{}:{}",
                doc.project["id"], doc.revision, request.idempotency_key
            )
            .as_bytes()
        )
    );
    let grid_id = format!("grid-{}", &digest[..24]);
    let binding_id = format!("binding-{}", &digest[..24]);
    let created = match request.operation {
        Operation::CreateManualBpm {
            clip_id,
            segments,
            review_reference,
        } => {
            let live = live_clip(&doc, &clip_id)?;
            let duration = integer(live.asset, "duration")?;
            let (points, meter_segments) = super::tempo::generate(&segments, duration)?;
            let grid = Grid {
                id: grid_id.clone(),
                revision: 1,
                mode: "manual".into(),
                asset_id: live.asset["id"]
                    .as_str()
                    .ok_or("music-grid-source-unavailable")?
                    .into(),
                source_sha256: live.asset["sourceSha256"]
                    .as_str()
                    .ok_or("music-grid-source-pin-required")?
                    .into(),
                source_duration_tick: duration,
                review_reference,
                analysis_provenance: None,
                points,
                meter_segments,
                manual_bpm_provenance: Some(segments),
            };
            state
                .bindings
                .push(binding(&doc, &grid, &clip_id, binding_id.clone())?);
            state.grids.push(grid);
            Some((grid_id, binding_id))
        }
        Operation::ReplaceStructure {
            grid_id,
            expected_grid_revision,
            meter_segments,
            review_reference,
        } => {
            let grid = state
                .grids
                .iter_mut()
                .find(|g| g.id == grid_id)
                .ok_or("music-grid-unavailable")?;
            if grid.revision != expected_grid_revision {
                return Err("music-grid-revision-conflict".into());
            }
            grid.meter_segments = meter_segments;
            grid.manual_bpm_provenance = None;
            grid.review_reference = review_reference;
            grid.revision += 1;
            None
        }
        Operation::CreateMeasured {
            clip_id,
            analysis,
            review_reference,
        } => {
            analysis.validate()?;
            if analysis
                .downbeats
                .iter()
                .any(|tick| !analysis.beats.contains(tick))
            {
                return Err("music-grid-downbeat-must-reference-beat".into());
            }
            if analysis.provenance.review.status != "accepted" {
                return Err("music-grid-analysis-review-required".into());
            }
            let live = live_clip(&doc, &clip_id)?;
            let duration = integer(live.asset, "duration")?;
            if live.asset["sourceSha256"] != analysis.provenance.input_sha256
                || (analysis.duration * 120000.0).round() as i64 != duration
            {
                return Err("music-grid-analysis-source-conflict".into());
            }
            let points = analysis
                .beats
                .iter()
                .enumerate()
                .map(|(index, tick)| Point {
                    id: format!("beat-{index}"),
                    source_tick: *tick as i64,
                    downbeat: if analysis.downbeats.is_empty() {
                        None
                    } else {
                        Some(analysis.downbeats.contains(tick))
                    },
                })
                .collect();
            let grid = Grid {
                id: grid_id.clone(),
                revision: 1,
                mode: "measured".into(),
                asset_id: live.asset["id"]
                    .as_str()
                    .ok_or("music-grid-source-unavailable")?
                    .into(),
                source_sha256: analysis.provenance.input_sha256.clone(),
                source_duration_tick: duration,
                review_reference,
                analysis_provenance: Some(
                    serde_json::to_value(analysis.provenance)
                        .map_err(|_| "music-grid-provenance-invalid")?,
                ),
                points,
                meter_segments: vec![],
                manual_bpm_provenance: None,
            };
            state
                .bindings
                .push(binding(&doc, &grid, &clip_id, binding_id.clone())?);
            state.grids.push(grid);
            Some((grid_id, binding_id))
        }
        Operation::CreateManual {
            clip_id,
            points,
            review_reference,
        } => {
            let live = live_clip(&doc, &clip_id)?;
            let grid = Grid {
                id: grid_id.clone(),
                revision: 1,
                mode: "manual".into(),
                asset_id: live.asset["id"]
                    .as_str()
                    .ok_or("music-grid-source-unavailable")?
                    .into(),
                source_sha256: live.asset["sourceSha256"]
                    .as_str()
                    .ok_or("music-grid-source-pin-required")?
                    .into(),
                source_duration_tick: integer(live.asset, "duration")?,
                review_reference,
                analysis_provenance: None,
                points,
                meter_segments: vec![],
                manual_bpm_provenance: None,
            };
            state
                .bindings
                .push(binding(&doc, &grid, &clip_id, binding_id.clone())?);
            state.grids.push(grid);
            Some((grid_id, binding_id))
        }
        Operation::ReplacePoints {
            grid_id,
            expected_grid_revision,
            points,
            review_reference,
        } => {
            let grid = state
                .grids
                .iter_mut()
                .find(|g| g.id == grid_id)
                .ok_or("music-grid-unavailable")?;
            if grid.revision != expected_grid_revision {
                return Err("music-grid-revision-conflict".into());
            }
            grid.points = points;
            grid.manual_bpm_provenance = None;
            grid.mode = "manual".into();
            grid.revision += 1;
            grid.review_reference = review_reference;
            None
        }
        Operation::Bind {
            grid_id,
            expected_grid_revision,
            clip_id,
        } => {
            let grid = state
                .grids
                .iter()
                .find(|g| g.id == grid_id)
                .ok_or("music-grid-unavailable")?;
            if grid.revision != expected_grid_revision {
                return Err("music-grid-revision-conflict".into());
            }
            if state
                .bindings
                .iter()
                .any(|b| b.grid_id == grid_id && b.clip_id == clip_id)
            {
                return Err("music-grid-binding-already-exists".into());
            }
            state
                .bindings
                .push(binding(&doc, grid, &clip_id, binding_id.clone())?);
            Some((grid_id, binding_id))
        }
        Operation::Remove {
            grid_id,
            expected_grid_revision,
        } => {
            if !state
                .grids
                .iter()
                .any(|g| g.id == grid_id && g.revision == expected_grid_revision)
            {
                return Err("music-grid-revision-conflict".into());
            }
            state.bindings.retain(|b| b.grid_id != grid_id);
            state.grids.retain(|g| g.id != grid_id);
            None
        }
    };
    state.validate()?;
    let required_sources: Vec<_> = state
        .grids
        .iter()
        .filter(|g| {
            before
                .grids
                .iter()
                .find(|old| old.id == g.id)
                .is_none_or(|old| old.revision != g.revision)
                || created.as_ref().is_some_and(|(id, _)| *id == g.id)
        })
        .map(|g| json!({"assetId":g.asset_id,"sourceSha256":g.source_sha256}))
        .collect();
    Ok(
        json!({"status":"admitted","created":created.map(|(g,b)| json!({"gridId":g,"bindingId":b})),
        "requiredSources":required_sources,"batch":{"expectedRevision":doc.revision,"idempotencyKey":request.idempotency_key,
        "operations":[{"kind":"update-project","projectId":doc.project["id"],"patch":{"musicGridState":state}}]}}),
    )
}
