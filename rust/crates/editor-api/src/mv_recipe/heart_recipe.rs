//! Public authoring and explicit pending-owner requests. No native pixels or sessions
//! can be deserialized from a Recipe; only the native owner can produce draw plans.
use super::{
    heart,
    model::{Scene, Span},
    validate::range,
};
use crate::{
    mv_audio::{Data, Provenance, Stop},
    programmatic_resources::Resource,
};
use serde::Serialize;
#[cfg(test)]
#[path = "heart_recipe_tests.rs"]
mod tests;
#[path = "heart_recipe_validation.rs"]
mod validation;
#[path = "heart_recipe_host.rs"]
mod host;
pub(super) use host::{admit, Context as HostContext};
pub(super) use validation::valid;

#[derive(Serialize)]
#[serde(tag = "kind", content = "settings", rename_all = "camelCase")]
pub enum OwnerScene {
    HeartShatter(heart::HeartShatter),
    HeartBurn(heart::HeartBurn),
    HeartGather(heart::HeartGather),
    SunBloom(heart::SunBloom),
    SkyShatter(heart::SkyShatter),
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameInput {
    pub scene: OwnerScene,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub beats: Vec<u64>,
    pub bpm: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReport {
    pub native_facts_pending: bool,
    pub declared_encoded_bytes: u64,
    pub owner_max_bytes: u64,
    pub owner_max_sessions: usize,
    pub frame_metadata_max_bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<host::Reservation>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub status: &'static str,
    pub source: Resource,
    pub background: Option<Resource>,
    pub character: Option<Resource>,
    pub frame: FrameInput,
    pub provenance: Provenance,
    pub downbeats: Vec<u64>,
    pub stops: Option<Vec<Stop>>,
    pub reservation: ReservationReport,
}
pub(super) struct Author<'a> {
    pub source: &'a str,
    pub background: Option<&'a str>,
    pub character: Option<&'a str>,
    pub span: &'a Span,
    pub bpm: f64,
}
pub(super) fn author(scene: &Scene) -> Option<Author<'_>> {
    let (source, background, character, span, bpm) = match scene {
        Scene::HeartShatter {
            settings,
            span,
            bpm,
            ..
        } => (&settings.heart, settings.bg.as_deref(), None, span, *bpm),
        Scene::HeartShatterBurn {
            settings,
            span,
            bpm,
            ..
        } => (&settings.heart, settings.bg.as_deref(), None, span, *bpm),
        Scene::HeartGather {
            settings,
            span,
            bpm,
            ..
        } => (
            &settings.heart,
            settings.bg.as_deref(),
            Some(settings.char.as_str()),
            span,
            *bpm,
        ),
        Scene::SunBloom {
            settings,
            span,
            bpm,
            ..
        } => (
            &settings.heart,
            None,
            Some(settings.char.as_str()),
            span,
            *bpm,
        ),
        Scene::SkyShatter {
            settings,
            span,
            bpm,
            ..
        } => (&settings.bg, None, Some(settings.char.as_str()), span, *bpm),
        _ => return None,
    };
    Some(Author {
        source,
        background,
        character,
        span,
        bpm,
    })
}
pub(super) fn runtime_ready(
    analysis: Option<&Data>,
    start: u64,
    end: u64,
) -> Result<&Data, String> {
    let data = analysis.ok_or("Heart requires complete reviewed whole-song analysis")?;
    data.validate()?;
    if data.beats.is_empty()
        || data.beats.len() > 21600
        || start >= end
        || end > 2_592_000_000
        || end > (data.duration * 120000.0).round() as u64
    {
        return Err("Heart shot must fit bounded real whole-song beat evidence".into());
    }
    Ok(data)
}
macro_rules! copy_args {
    ($name:ident, $args:expr, $($field:ident),+) => {{
        let a = $args;
        heart::$name { $($field: a.$field.clone()),+ }
    }};
}
fn owner_scene(scene: &Scene) -> Result<OwnerScene, String> {
    Ok(match scene {
        Scene::HeartShatter { settings, .. } => OwnerScene::HeartShatter(settings.clone()),
        Scene::HeartShatterBurn { settings, .. } => OwnerScene::HeartBurn(settings.clone()),
        Scene::HeartGather { settings, .. } => OwnerScene::HeartGather(copy_args!(
            HeartGather,
            settings,
            heart,
            char,
            bg,
            firefly,
            n,
            char_h,
            char_x,
            char_y,
            target
        )),
        Scene::SunBloom { settings, .. } => OwnerScene::SunBloom(copy_args!(
            SunBloom, settings, heart, char, fuse_at, fuse_beat, sun_x, sun_y, sun_r, char_h,
            char_x, char_y
        )),
        Scene::SkyShatter { settings, .. } => OwnerScene::SkyShatter(copy_args!(
            SkyShatter,
            settings,
            bg,
            char,
            night,
            seed,
            impact,
            release_beat,
            bands,
            char_x,
            char_h
        )),
        _ => return Err("Not a Heart owner scene".into()),
    })
}
pub(super) fn request(
    scene: &Scene,
    sample: &super::ember::Sample<'_>,
    resources: &[Resource],
) -> Result<Request, String> {
    let a = author(scene).ok_or("Not a Heart owner scene")?;
    let data = runtime_ready(
        sample.analysis,
        sample.shot_start_ticks,
        sample.shot_end_ticks,
    )?;
    let resource = |id: &str| {
        resources
            .iter()
            .find(|r| r.id == id && r.kind == "image")
            .cloned()
            .ok_or("Heart requires an explicit declared native image".to_owned())
    };
    let source = resource(a.source)?;
    let background = a.background.map(resource).transpose()?;
    let character = a.character.map(resource).transpose()?;
    let encoded = std::iter::once(&source)
        .chain(background.iter())
        .chain(character.iter())
        .try_fold(0u64, |sum, r| {
            sum.checked_add(r.byte_length())
                .ok_or("Heart declared bytes overflow")
        })?;
    if sample.song_ticks < sample.shot_start_ticks || sample.song_ticks > sample.shot_end_ticks {
        return Err("Heart mapped source clock is outside its shot".into());
    }
    let request = Request {
        status: "pendingNativeOwner",
        source,
        background,
        character,
        frame: FrameInput {
            scene: owner_scene(scene)?,
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            beats: data.beats.clone(),
            bpm: a.bpm,
        },
        provenance: data.provenance.clone(),
        downbeats: data.downbeats.clone(),
        stops: data.stops.clone(),
        reservation: ReservationReport {
            native_facts_pending: true,
            declared_encoded_bytes: encoded,
            owner_max_bytes: crate::mv_heart_owner::MAX_OWNER_BYTES,
            owner_max_sessions: crate::mv_heart_owner::MAX_OWNER_SESSIONS,
            frame_metadata_max_bytes: 64 * 1024,
            host: None,
        },
    };
    if serde_json::to_vec(&request.frame)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024
    {
        return Err("Heart complete owner frame metadata exceeds64KiB capability".into());
    }
    Ok(request)
}
