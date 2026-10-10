//! Explicit content-addressed native lyric subtree; no project-global lookup.
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontBinding {
    pub font_id: String,
    pub resource_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    pub sequence: String,
    pub sequence_origin_ticks: u64,
    pub fonts: Vec<FontBinding>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Font {
    pub font_id: String,
    pub resource: Resource,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub sequence: Resource,
    pub sequence_ticks: u64,
    pub fonts: Vec<Font>,
    pub resident_bytes: u64,
    pub source_start_ticks: u64,
    pub source_end_ticks: u64,
    #[serde(default)]
    pub host: Option<HostReservation>,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostReservation {
    pub recipe_reservation_bytes: u64,
    pub session_ceiling_bytes: u64,
    pub max_live_sessions: usize,
    pub raster_byte_limit: u64,
}

pub(crate) const MAX_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const FRAME_BYTES: u64 = 1920 * 1080 * 4;
pub const MAX_OWNER_SESSIONS: usize = 4;
pub(crate) fn resolve(a: &Args, rs: &[Resource]) -> Result<(Resource, Vec<Font>), String> {
    if a.sequence_origin_ticks > 21600 * 120000 || a.fonts.is_empty() || a.fonts.len() > 16 {
        return Err("JIZURA author origin/font bounds invalid".into());
    }
    let sequence = rs
        .iter()
        .find(|r| {
            r.id == a.sequence
                && r.kind == "analysis"
                && r.mime_type() == "application/json"
                && r.byte_length() <= 2 * 1024 * 1024
        })
        .ok_or("JIZURA requires declared sequence JSON attachment")?
        .clone();
    let mut ids = BTreeSet::new();
    let mut fonts = Vec::new();
    for f in &a.fonts {
        if f.font_id.is_empty() || f.font_id.len() > 128 || !ids.insert(&f.font_id) {
            return Err("JIZURA font IDs must be unique".into());
        }
        let resource = rs
            .iter()
            .find(|r| r.id == f.resource_id && r.kind == "font")
            .ok_or("JIZURA physical font binding missing")?
            .clone();
        fonts.push(Font {
            font_id: f.font_id.clone(),
            resource,
        });
    }
    Ok((sequence, fonts))
}
pub(super) fn valid(a: &Args, rs: &[Resource]) -> bool {
    resident_bytes(a, rs).is_ok()
}
pub(super) fn resources(a: &Args, rs: &[Resource]) -> Result<Vec<Resource>, String> {
    let (sequence, fonts) = resolve(a, rs)?;
    let mut out = vec![sequence];
    for f in fonts {
        if !out.iter().any(|r| r == &f.resource) {
            out.push(f.resource);
        }
    }
    Ok(out)
}
pub(super) fn resident_bytes(a: &Args, rs: &[Resource]) -> Result<u64, String> {
    let (sequence, fonts) = resolve(a, rs)?;
    let mut bytes = sequence
        .byte_length()
        .checked_mul(12)
        .ok_or("JIZURA sequence budget overflow")?;
    for f in fonts {
        bytes = bytes
            .checked_add(
                f.resource
                    .byte_length()
                    .checked_mul(8)
                    .ok_or("JIZURA font budget overflow")?,
            )
            .ok_or("JIZURA residency overflow")?;
    }
    bytes = bytes
        .checked_add(64 * 1024 * 1024 + 3 * FRAME_BYTES)
        .ok_or("JIZURA frame budget overflow")?;
    if bytes > MAX_BYTES {
        return Err("JIZURA native session exceeds residency limit".into());
    }
    Ok(bytes)
}
pub(super) fn request(
    a: &Args,
    song_ticks: u64,
    domain: [u64; 2],
    rs: &[Resource],
) -> Result<Request, String> {
    let (sequence, fonts) = resolve(a, rs)?;
    let source_start_ticks = domain[0]
        .checked_sub(a.sequence_origin_ticks)
        .ok_or("JIZURA source precedes sequence origin")?;
    let source_end_ticks = domain[1]
        .checked_sub(a.sequence_origin_ticks)
        .ok_or("JIZURA source end precedes sequence origin")?;
    if source_start_ticks >= source_end_ticks {
        return Err("JIZURA source domain invalid".into());
    }
    Ok(Request {
        sequence,
        fonts,
        sequence_ticks: song_ticks
            .checked_sub(a.sequence_origin_ticks)
            .ok_or("JIZURA mapped song time precedes sequence origin")?,
        resident_bytes: resident_bytes(a, rs)?,
        source_start_ticks,
        source_end_ticks,
        host: None,
    })
}
pub(super) fn expanded_work(_a: &Args) -> u32 {
    0
}
pub(super) fn plan_bytes_bound(_a: &Args) -> u64 {
    32 * 1024
}
pub(super) fn catalog_entry() -> serde_json::Value {
    serde_json::json!({
        "requires":["verified-resolved-motion-text-sequence-attachment","physical-SFNT-fonts","fixed-native-motion-text-renderer"],
        "parameters":{"sequence":"analysis/application/json resource ID","sequenceOriginTicks":"0..2592000000 song ticks","fonts":"1..16 explicit fontId/resourceId bindings"},
        "clock":"mapped song ticks minus sequenceOriginTicks; no implicit project lookup or clamp",
        "composition":"full-frame native scene output into one recipe role; supports A/B/ref/panels",
        "limits":{"sequenceBytes":2097152,"cuts":4096,"cutCharacters":1024,"totalCharacters":131072,"sessions":4,"globalBytes":MAX_BYTES},
        "budget":"12x sequence bytes +8x physical font bytes +64MiB renderer scratch +3 full-frame RGBA packets"
    })
}
