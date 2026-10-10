//! Node-bound public author seam; actual SFNT, aliases, images, reflection and
//! original Train P4 post remain owned by the existing opaque native owner.
use super::{train, wet_floor};
use crate::{
    mv_audio::Data,
    mv_night_owner::{FontInstance, Owner},
    programmatic_resources::{self, Resource},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
#[derive(Deserialize)]
#[serde(tag = "scene", rename_all = "camelCase", deny_unknown_fields)]
enum Binding {
    WetFloor { settings: wet_floor::Settings },
    Train { settings: train::Settings },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Author {
    binding: Value,
    font_instances: Vec<FontInstance>,
    #[serde(default)]
    lut_atlas: Option<Value>,
}
#[derive(Deserialize)]
#[serde(try_from = "Author")]
pub struct Night {
    binding: Value,
    settings: Binding,
    font_instances: Vec<FontInstance>,
    lut_atlas: Option<Value>,
}
impl TryFrom<Author> for Night {
    type Error = String;
    fn try_from(author: Author) -> Result<Self, String> {
        let settings = serde_json::from_value(author.binding.clone()).map_err(|e| e.to_string())?;
        let result = Self {
            binding: author.binding,
            settings,
            font_instances: author.font_instances,
            lut_atlas: author.lut_atlas,
        };
        result.roles()?;
        Ok(result)
    }
}
/// Serializable request is discovery metadata, never an admission token. Only
/// Context::inspect can turn byte-proven owner results into node-bound state.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationRequest {
    pub host: Option<HostReservation>,
    pub node_id: String,
    pub occurrence_id: u32,
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub physical_resources: Vec<Resource>,
    pub font_instances: Vec<FontInstance>,
    pub physical_encoded_bytes: usize,
    pub requires_native_decode: bool,
    pub requires_reflection: bool,
    pub requires_original_p4_post: bool,
    pub metadata: String,
    pub lut_atlas: Option<Value>,
    pub lut_resources: Vec<Resource>,
}
/// Assigned only by the Rust complete-graph ledger after occurrence expansion.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReservation {
    pub recipe_reservation_bytes: u64,
    pub retained_bitmap_bytes: u64,
    pub preparation_peak_bytes: u64,
    pub raster_byte_limit: u64,
}
/// Minted by the evaluator's traversal, never deserialized from author JSON.
#[derive(Default)]
pub(in crate::mv_recipe) struct Traversal {
    next: u32,
}
impl Traversal {
    pub(in crate::mv_recipe) fn issue(
        &mut self,
        mut request: PreparationRequest,
        song_ticks: u64,
        shot_start_ticks: u64,
        shot_end_ticks: u64,
    ) -> Result<PreparationRequest, String> {
        if shot_start_ticks >= shot_end_ticks
            || shot_end_ticks > 2_592_000_000
            || song_ticks > 2_592_000_000
        {
            return Err("Night invalid mapped integer sample".into());
        }
        self.next = self
            .next
            .checked_add(1)
            .ok_or("Night occurrence overflow")?;
        // Native OwnerLease still enforces max8 owners/global4GiB; this does
        // not increase either admission cap.
        request.occurrence_id = self.next;
        request.song_ticks = song_ticks;
        request.shot_start_ticks = shot_start_ticks;
        request.shot_end_ticks = shot_end_ticks;
        Ok(request)
    }
}
impl Night {
    fn roles(&self) -> Result<Vec<&str>, String> {
        let roles = match &self.settings {
            Binding::WetFloor { settings: a } => {
                a.validate()?;
                vec![
                    a.fonts.mincho800.as_str(),
                    &a.fonts.noto800,
                    &a.fonts.dot400,
                    &a.fonts.noto400,
                ]
            }
            Binding::Train { settings: a } => {
                a.validate()?;
                vec![
                    a.fonts.mincho800.as_str(),
                    &a.fonts.noto800,
                    &a.fonts.mincho700,
                    &a.fonts.noto700,
                    &a.fonts.dot400,
                    &a.fonts.noto400,
                ]
            }
        };
        let expected: BTreeSet<_> = roles.iter().copied().collect();
        let actual: BTreeSet<_> = self.font_instances.iter().map(|i| i.id.as_str()).collect();
        if expected.len() != roles.len()
            || self.font_instances.len() != roles.len()
            || actual != expected
        {
            return Err(
                "Night public role/instance identities must match exactly and remain distinct"
                    .into(),
            );
        }
        Ok(roles)
    }
    pub(super) fn validate(
        &self,
        width: u32,
        height: u32,
        resources: &[Resource],
    ) -> Result<(), String> {
        if width != 1920 || height != 1080 {
            return Err("Night public scene requires exact1920x1080".into());
        }
        self.roles()?;
        match (&self.settings, &self.lut_atlas) {
            (Binding::WetFloor { .. }, None) => {}
            (Binding::Train { .. }, Some(value)) => {
                let atlas: crate::mv_lut_atlas::Settings =
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                if atlas.palette_resource.is_empty()
                    || atlas.images.is_empty()
                    || atlas.images.len() > 10
                {
                    return Err("Night Train requires bounded original P4 atlas sources".into());
                }
                let ids: BTreeSet<_> = atlas
                    .images
                    .iter()
                    .map(|i| i.resource_id.as_str())
                    .collect();
                let paths: BTreeSet<_> = atlas.images.iter().map(|i| i.path.as_str()).collect();
                if ids.len() != atlas.images.len()
                    || paths.len() != atlas.images.len()
                    || atlas
                        .images
                        .iter()
                        .any(|i| i.path.is_empty() || i.resource_id.is_empty())
                {
                    return Err("Night original P4 atlas bindings must remain distinct".into());
                }
            }
            _ => return Err("Night Train requires original P4 atlas; WetFloor forbids it".into()),
        }
        if let Some(issue) = programmatic_resources::validate(resources).first() {
            return Err(issue.message.clone());
        }
        let physical: BTreeSet<_> = resources.iter().map(|r| r.id.as_str()).collect();
        if self
            .font_instances
            .iter()
            .any(|i| physical.contains(i.id.as_str()))
        {
            return Err("Night instance shadows complete physical manifest".into());
        }
        Ok(())
    }
    pub(super) fn request(
        &self,
        node_id: &str,
        width: u32,
        height: u32,
        resources: &[Resource],
        analysis: Option<&Data>,
    ) -> Result<PreparationRequest, String> {
        self.validate(width, height, resources)?;
        if node_id.is_empty()
            || node_id.len() > 64
            || !node_id
                .bytes()
                .all(|n| n.is_ascii_alphanumeric() || n == b'-' || n == b'_')
        {
            return Err("Night invalid public node identity".into());
        }
        let (mut images, reflection, post) = match &self.settings {
            Binding::WetFloor { settings: a } => (vec![a.bg.as_str()], a.mode == "fall", false),
            Binding::Train { settings: a } => {
                let mut images = vec![a.bg.as_str()];
                images.extend(a.characters());
                (images, false, true)
            }
        };
        let mut required: BTreeSet<_> = images.drain(..).collect();
        for i in &self.font_instances {
            required.insert(i.resource_id.as_str());
        }
        let physical: Vec<_> = resources
            .iter()
            .filter(|r| required.contains(r.id.as_str()))
            .cloned()
            .collect();
        if physical.len() != required.len() {
            return Err("Night missing complete physical sources for bound roles/images".into());
        }
        let mut bytes = 0usize;
        let mut layout = Vec::new();
        for r in &physical {
            let length =
                usize::try_from(r.byte_length()).map_err(|_| "Night physical length overflow")?;
            layout.push(json!({"resourceId":r.id,"offset":bytes,"length":length}));
            bytes = bytes
                .checked_add(length)
                .ok_or("Night physical packet overflow")?;
        }
        let metadata=json!({"binding":self.binding,"resources":physical,"fontInstances":self.font_instances,"byteLayout":layout,"decodedImages":[],"beats":self.beats(analysis)?}).to_string();
        // Existing owner performs exact closed metadata/alias/resource budget
        // admission here. No packet is allocated and no source is copied.
        Owner::new()?.preflight(&metadata, bytes)?;
        let mut lut_resources = Vec::new();
        if let Some(value) = &self.lut_atlas {
            let atlas: crate::mv_lut_atlas::Settings =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            for (id, kind) in std::iter::once((atlas.palette_resource.as_str(), "analysis")).chain(
                atlas
                    .images
                    .iter()
                    .map(|i| (i.resource_id.as_str(), "image")),
            ) {
                let resource = resources
                    .iter()
                    .find(|r| r.id == id && r.kind == kind)
                    .ok_or("Night missing original P4 atlas physical source")?;
                if kind == "analysis" && resource.mime_type() != "application/json" {
                    return Err("Night original palette must be JSON".into());
                }
                lut_resources.push(resource.clone());
            }
        }
        Ok(PreparationRequest {
            host: None,
            node_id: node_id.into(),
            occurrence_id: 0,
            song_ticks: 0,
            shot_start_ticks: 0,
            shot_end_ticks: 0,
            physical_resources: physical,
            font_instances: self.font_instances.clone(),
            physical_encoded_bytes: bytes,
            requires_native_decode: true,
            requires_reflection: reflection,
            requires_original_p4_post: post,
            metadata,
            lut_atlas: self.lut_atlas.clone(),
            lut_resources,
        })
    }
}
#[path = "night_recipe_clock.rs"]
mod clock;
#[path = "night_recipe_context.rs"]
mod context;
pub(super) use context::Context;
#[cfg(test)]
#[path = "night_recipe_tests.rs"]
mod tests;
