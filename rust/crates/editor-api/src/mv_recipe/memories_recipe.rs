//! Authoring-to-owner request. Physical images, fonts and stages remain private.
use super::{
    memories,
    model::{Scene, Span},
};
use crate::{
    mv_audio::{Provenance, Stop},
    programmatic_resources::Resource,
};
use serde::Serialize;
pub const MAX_OWNER_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_OWNER_SESSIONS: usize = 4;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReservation {
    pub recipe_reservation_bytes: u64,
    pub session_ceiling_bytes: u64,
    pub max_live_sessions: usize,
    pub raster_byte_limit: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub native_facts_pending: bool,
    pub declared_encoded_bytes: u64,
    pub owner_max_bytes: u64,
    pub owner_max_sessions: usize,
    pub frame_metadata_max_bytes: usize,
    pub host: Option<HostReservation>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameInput {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: Vec<u64>,
    pub bpm: f64,
    pub downbeat_index: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub status: &'static str,
    pub args: memories::model::Args,
    pub resources: Vec<Resource>,
    pub frame: FrameInput,
    pub provenance: Provenance,
    pub downbeats: Vec<u64>,
    pub stops: Option<Vec<Stop>>,
    pub reservation: Reservation,
}
pub(super) fn author(scene: &Scene) -> Option<(&memories::model::Args, &Span, f64)> {
    match scene {
        Scene::Memories {
            settings,
            span,
            bpm,
            ..
        } => Some((settings, span, *bpm)),
        _ => None,
    }
}
fn selected(args: &memories::model::Args, resources: &[Resource]) -> Result<Vec<Resource>, String> {
    if let Some(issue) = crate::programmatic_resources::validate(resources).first() {
        return Err(issue.message.clone());
    }
    let selection = memories::model::select(args)?;
    let mut ids: std::collections::BTreeSet<&str> =
        args.photos.iter().map(|p| p.bg.as_str()).collect();
    if let Some(id) = selection.character.as_deref() {
        ids.insert(id);
    }
    let mut result = Vec::new();
    for (id, kind) in ids
        .into_iter()
        .map(|id| (id, "image"))
        .chain([(&*args.caption_font, "font"), (&*args.date_font, "font")])
    {
        let r = resources
            .iter()
            .find(|r| r.id == id && r.kind == kind)
            .ok_or("Memories requires explicit image and physical font descriptors")?;
        if !result.iter().any(|p: &Resource| p.id == r.id) {
            result.push(r.clone());
        }
    }
    for (id, weight) in [(&args.caption_font, 600u64), (&args.date_font, 400u64)] {
        let descriptor = result
            .iter()
            .find(|r| &r.id == id)
            .ok_or("Memories font missing")?;
        let descriptor = serde_json::to_value(descriptor).map_err(|e| e.to_string())?;
        if descriptor["font"]["weight"].as_u64() != Some(weight)
            || descriptor["font"]["style"].as_str() != Some("normal")
        {
            return Err(
                "Memories caption/date require explicit normal600/400 physical fonts".into(),
            );
        }
    }
    Ok(result)
}
pub(super) fn valid(scene: &Scene, resources: &[Resource], start: u64, step: u64) -> bool {
    let Some((a, span, bpm)) = author(scene) else {
        return false;
    };
    selected(a, resources).is_ok()
        && bpm.is_finite()
        && (1.0..=1000.0).contains(&bpm)
        && u64::from(span.start_frame)
            .checked_add(u64::from(span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(start))
            .is_some_and(|v| v <= 2_592_000_000)
}
pub(super) fn request(
    scene: &Scene,
    sample: &super::ember::Sample<'_>,
    resources: &[Resource],
) -> Result<Request, String> {
    let (args, _, bpm) = author(scene).ok_or("Not a Memories owner scene")?;
    let data = super::heart_recipe::runtime_ready(
        sample.analysis,
        sample.shot_start_ticks,
        sample.shot_end_ticks,
    )?;
    if sample.song_ticks < sample.shot_start_ticks || sample.song_ticks > sample.shot_end_ticks {
        return Err("Memories mapped song clock is outside shot".into());
    }
    let resources = selected(args, resources)?;
    let bytes = resources.iter().try_fold(0u64, |sum, r| {
        sum.checked_add(r.byte_length())
            .ok_or("Memories descriptor bytes overflow")
    })?;
    // The producer uses a beat-index phase (not an index into downbeats).
    let downbeat_index = data
        .downbeats
        .first()
        .map(|tick| data.beats.partition_point(|v| *v < *tick) as i32)
        .unwrap_or(0);
    let frame = FrameInput {
        song_ticks: sample.song_ticks,
        shot_start_ticks: sample.shot_start_ticks,
        shot_end_ticks: sample.shot_end_ticks,
        beats: data.beats.clone(),
        bpm,
        downbeat_index,
    };
    if serde_json::to_vec(&frame).map_err(|e| e.to_string())?.len() > 128 * 1024 {
        return Err("Memories owner frame metadata exceeds128KiB".into());
    }
    Ok(Request {
        status: "pendingNativeOwner",
        args: args.clone(),
        resources,
        frame,
        provenance: data.provenance.clone(),
        downbeats: data.downbeats.clone(),
        stops: data.stops.clone(),
        reservation: Reservation {
            native_facts_pending: true,
            declared_encoded_bytes: bytes,
            owner_max_bytes: MAX_OWNER_BYTES,
            owner_max_sessions: MAX_OWNER_SESSIONS,
            frame_metadata_max_bytes: 128 * 1024,
            host: None,
        },
    })
}
