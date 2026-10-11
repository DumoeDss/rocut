//! Independent Night owner. Encoded bytes are borrowed after reservation and
//! never retained. Opaque native font/mask admissions cannot be supplied in JSON.
#[path = "mv_night_budget.rs"]
mod budget;
#[path = "mv_night_fonts.rs"]
mod fonts;
#[path = "mv_night_protocol.rs"]
mod protocol;
#[path = "mv_night_transport.rs"]
mod transport;
use crate::{
    image_sequence::inspect_encoded_image,
    mv_lut_atlas_bridge::{AtlasSessions, BoundRow},
    mv_recipe::{train, wet_floor},
    programmatic_resources::{self, Resource},
};
use budget::{OwnerLease, Reservation};
pub use protocol::{DecodedImage, FontInstance, Frame, Prepared};
use protocol::{Prepare, Sample, Settings};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub use transport::{
    MAX_GLOBAL_BYTES, MAX_METADATA_CHARS, MAX_OWNER_BYTES, lengths as validate_transport_lengths,
    reflection as validate_reflection_length, session_id as validate_session_id,
};
enum Admission {
    WetFloor {
        settings: wet_floor::Settings,
        image: wet_floor::Image,
        fonts: wet_floor::Admission,
        mask: Option<wet_floor::ReflectionMask>,
    },
    Train {
        settings: train::Settings,
        images: Vec<train::Image>,
        fonts: train::Admission,
    },
}
struct Session {
    admission: Admission,
    beats: Vec<f64>,
    reservation: Reservation,
    decoded_bound: bool,
}
/// At most one live frame per owner. A caller must release it after native
/// canvas/GL surfaces are destroyed, not merely after receiving its JSON plan.
pub struct Owner {
    sessions: BTreeMap<u32, Session>,
    next_session: u32,
    next_frame: u32,
    frame: Option<(u32, u32, Reservation)>,
    atlas: AtlasSessions,
    atlas_id: Option<u32>,
    atlas_reservation: Option<Reservation>,
    lease: OwnerLease,
}
impl Owner {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            sessions: BTreeMap::new(),
            next_session: 0,
            next_frame: 0,
            frame: None,
            atlas: AtlasSessions::default(),
            atlas_id: None,
            atlas_reservation: None,
            lease: OwnerLease::new()?,
        })
    }
    fn resident(&self) -> u64 {
        self.sessions.values().map(|s| s.reservation.0).sum::<u64>()
            + self.atlas_reservation.as_ref().map_or(0, |r| r.0)
            + self.frame.as_ref().map_or(0, |(_, _, r)| r.0)
    }
    fn reserve(&self, bytes: u64) -> Result<Reservation, String> {
        transport::sum(self.resident(), bytes, transport::MAX_OWNER_BYTES)?;
        Reservation::new(bytes)
    }
    pub fn diagnostic(&self) -> Value {
        let _ = &self.lease;
        json!({"sessions":self.sessions.len(),"reservedBytes":self.resident(),
            "frameActive":self.frame.is_some(),"maxOwnerBytes":transport::MAX_OWNER_BYTES,
            "maxGlobalBytes":transport::MAX_GLOBAL_BYTES,
            "metric":"conservative stated source/native/font/provider/frame copy reservation; not measured whole-renderer residency"})
    }
    pub fn prepare(&mut self, metadata: &str, bytes: &[u8]) -> Result<Prepared, String> {
        self.prepare_with(metadata, bytes.len(), || Ok(bytes))
    }
    pub fn preflight(&self, metadata: &str, length: usize) -> Result<(), String> {
        validate_transport_lengths(metadata.chars().count(), length)?;
        if self.frame.is_some() || self.sessions.len() >= transport::MAX_SESSIONS {
            return Err("Night source preflight lifecycle exhausted".into());
        }
        let input: Prepare = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
        let (_, aliases) = metadata_scope(&input)?;
        if !input.decoded_images.is_empty() {
            return Err("Night source preflight scope mismatch".into());
        }
        let mut end = 0;
        let mut ids = BTreeSet::new();
        for part in &input.byte_layout {
            end = transport::range(part.offset, part.length, length, end)?;
            if !ids.insert(part.resource_id.as_str())
                || find(&input.resources, &part.resource_id)?.byte_length() != part.length as u64
            {
                return Err("Night source preflight layout mismatch".into());
            }
        }
        if end != length {
            return Err("Night source preflight unclaimed bytes".into());
        }
        transport::sum(
            self.resident(),
            length as u64 * 3
                + metadata.len() as u64 * 32
                + transport::font_reservation(aliases.instance_bytes, input.font_instances.len())?,
            transport::MAX_OWNER_BYTES,
        )?;
        Ok(())
    }
    /// Encoded image admission BEFORE native decode. This returns only dimensions
    /// inspected from byte-proven containers, never claims a native decode occurred.
    pub fn inspect_with<B: AsRef<[u8]>>(
        &mut self,
        metadata: &str,
        length: usize,
        copy: impl FnOnce() -> Result<B, String>,
    ) -> Result<Prepared, String> {
        validate_transport_lengths(metadata.chars().count(), length)?;
        self.preflight(metadata, length)?;
        if self.frame.is_some() || self.sessions.len() >= transport::MAX_SESSIONS {
            return Err("Night decode preparation lifecycle exhausted".into());
        }
        let input: Prepare = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
        let (_, aliases) = metadata_scope(&input)?;
        if !input.decoded_images.is_empty()
            || input.resources.len() > 39
            || input.byte_layout.len() != input.resources.len()
        {
            return Err("Night encoded inspection requires empty actual decode facts".into());
        }
        let mut end = 0;
        let mut ids = BTreeSet::new();
        for part in &input.byte_layout {
            end = transport::range(part.offset, part.length, length, end)?;
            let resource = find(&input.resources, &part.resource_id)?;
            if !ids.insert(part.resource_id.as_str())
                || resource.byte_length() != part.length as u64
            {
                return Err("Night encoded layout mismatch".into());
            }
        }
        if end != length {
            return Err("Night unclaimed encoded inspection bytes".into());
        }
        let _temporary = self.reserve(
            length as u64 * 3
                + metadata.len() as u64 * 32
                + transport::font_reservation(aliases.instance_bytes, input.font_instances.len())?,
        )?;
        let owned = copy()?;
        let binary = owned.as_ref();
        if binary.len() != length {
            return Err("Night inspection bytes changed during copy".into());
        }
        let mut decoded = Vec::new();
        for part in &input.byte_layout {
            let resource = find(&input.resources, &part.resource_id)?;
            let body = &binary[part.offset..part.offset + part.length];
            if format!("{:x}", Sha256::digest(body)) != resource.sha256() {
                return Err("Night actual inspection SHA mismatch".into());
            }
            if resource.kind == "image" {
                let (width, height) = inspect_encoded_image(resource.mime_type(), body)?;
                decoded.push(protocol::ImageFact {
                    resource_id: resource.id.clone(),
                    width,
                    height,
                });
            }
        }
        let mut value: Value = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
        value
            .as_object_mut()
            .ok_or("Night metadata object required")?
            .insert(
                "decodedImages".into(),
                serde_json::to_value(decoded).map_err(|e| e.to_string())?,
            );
        let prepared = self.prepare_with(&value.to_string(), length, || Ok(binary))?;
        self.sessions
            .get_mut(&prepared.session_id)
            .ok_or("Night inspection session lost")?
            .decoded_bound = false;
        Ok(prepared)
    }
    /// The platform must measure the actual createImageBitmap results and bind
    /// the complete set before reflection analysis or any producer can run.
    pub fn bind_decoded(&mut self, id: u32, json: &str) -> Result<(), String> {
        if json.len() > 64 * 1024 || self.frame.is_some() {
            return Err("Night native decode binding lifecycle/length exceeded".into());
        }
        let supplied: Vec<protocol::ImageFact> =
            serde_json::from_str(json).map_err(|e| e.to_string())?;
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or("Night stale decode session")?;
        if session.decoded_bound {
            return Err("Night native decoded facts already bound".into());
        }
        let expected = decoded_requests(&session.admission);
        let mut seen = BTreeSet::new();
        if supplied.len() != expected.len()
            || supplied.iter().any(|f| {
                !seen.insert(f.resource_id.as_str())
                    || !expected.iter().any(|e| {
                        e.resource_id == f.resource_id && e.width == f.width && e.height == f.height
                    })
            })
        {
            return Err("Night actual native decoder disagrees with byte-proven geometry".into());
        }
        session.decoded_bound = true;
        Ok(())
    }
    /// Resource metadata/reservations are verified before the platform allocates
    /// or copies any binary packet. Dropping a failed attempt rolls back budgets.
    pub fn prepare_with<B: AsRef<[u8]>>(
        &mut self,
        metadata: &str,
        length: usize,
        copy: impl FnOnce() -> Result<B, String>,
    ) -> Result<Prepared, String> {
        validate_transport_lengths(metadata.chars().count(), length)?;
        if self.sessions.len() >= transport::MAX_SESSIONS || self.frame.is_some() {
            return Err("Night session/frame lifecycle exhausted".into());
        }
        let input: Prepare = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
        let (scene, aliases) = metadata_scope(&input)?;
        if input.beats.len() > 8192
            || input
                .beats
                .iter()
                .any(|v| !v.is_finite() || *v < 0.0 || *v > 1e9)
            || input.beats.windows(2).any(|w| w[0] >= w[1])
        {
            return Err("Night closed resource/beat scope mismatch".into());
        }
        let images: BTreeSet<_> = input
            .resources
            .iter()
            .filter(|r| r.kind == "image")
            .map(|r| r.id.as_str())
            .collect();
        if input.decoded_images.len() != images.len() {
            return Err("Night missing native decoded image facts".into());
        }
        let mut facts = BTreeMap::new();
        let mut reserved = (length as u64)
            .checked_mul(3)
            .ok_or("Night source reservation overflow")?;
        for fact in &input.decoded_images {
            if !images.contains(fact.resource_id.as_str())
                || fact.width == 0
                || fact.height == 0
                || fact.width > 8192
                || fact.height > 8192
                || facts
                    .insert(fact.resource_id.as_str(), [fact.width, fact.height])
                    .is_some()
            {
                return Err("Night duplicate/invalid actual decoded image fact".into());
            }
            reserved = transport::sum(
                reserved,
                u64::from(fact.width) * u64::from(fact.height) * 4 * 3,
                transport::MAX_OWNER_BYTES,
            )?;
        }
        // One physical packet, but each logical face/parser/native instance
        // receives its own conservative reservation, even for identical bytes.
        reserved = transport::sum(
            reserved,
            transport::font_reservation(aliases.instance_bytes, input.font_instances.len())?,
            transport::MAX_OWNER_BYTES,
        )?;
        reserved = transport::sum(
            reserved,
            metadata.len() as u64 * 32 + transport::REFLECTION_BYTES as u64 * 4,
            transport::MAX_OWNER_BYTES,
        )?;
        let mut end = 0;
        let mut layout_ids = BTreeSet::new();
        for part in &input.byte_layout {
            end = transport::range(part.offset, part.length, length, end)?;
            let resource = input
                .resources
                .iter()
                .find(|r| r.id == part.resource_id)
                .ok_or("Night undeclared binary resource")?;
            if !layout_ids.insert(part.resource_id.as_str())
                || resource.byte_length() != part.length as u64
            {
                return Err("Night binary resource length/duplicate mismatch".into());
            }
        }
        if end != length {
            return Err("Night unclaimed trailing bytes".into());
        }
        let reservation = self.reserve(reserved)?;
        let id = self
            .next_session
            .checked_add(1)
            .ok_or("Night session identity exhausted")?;
        let owned = copy()?;
        let binary = owned.as_ref();
        if binary.len() != length {
            return Err("Night binary changed during copy".into());
        }
        let mut bodies = BTreeMap::new();
        for part in &input.byte_layout {
            let bytes = &binary[part.offset..part.offset + part.length];
            let resource = input
                .resources
                .iter()
                .find(|r| r.id == part.resource_id)
                .ok_or("Night binary declaration lost")?;
            if format!("{:x}", Sha256::digest(bytes)) != resource.sha256() {
                return Err("Night actual encoded/font resource SHA mismatch".into());
            }
            if resource.kind == "image" {
                let size = inspect_encoded_image(resource.mime_type(), bytes)?;
                if facts.get(resource.id.as_str()) != Some(&[size.0, size.1]) {
                    return Err("Night native decoded geometry differs from encoded bytes".into());
                }
            }
            bodies.insert(part.resource_id.clone(), bytes);
        }
        fonts::validate_sources(&input.resources, &bodies)?;
        let instance_bodies = fonts::instance_bodies(&input.font_instances, &bodies)?;
        let (admission, reflection_required, post_required) = match input.binding {
            Settings::WetFloor { settings } => {
                let fonts = settings.admit_fonts(&aliases.resources, &instance_bodies)?;
                let resource = find(&input.resources, &settings.bg)?.clone();
                let [width, height] = *facts
                    .get(resource.id.as_str())
                    .ok_or("Night background decoded fact missing")?;
                let reflection_required = settings.mode == "fall";
                (
                    Admission::WetFloor {
                        settings,
                        fonts,
                        image: wet_floor::Image {
                            resource,
                            width,
                            height,
                        },
                        mask: None,
                    },
                    reflection_required,
                    false,
                )
            }
            Settings::Train { settings } => {
                let fonts = settings.admit_fonts(&aliases.resources, &instance_bodies)?;
                let images = input
                    .resources
                    .iter()
                    .filter(|r| r.kind == "image")
                    .map(|resource| {
                        let [width, height] = facts[resource.id.as_str()];
                        train::Image {
                            resource: resource.clone(),
                            width,
                            height,
                        }
                    })
                    .collect();
                (
                    Admission::Train {
                        settings,
                        fonts,
                        images,
                    },
                    false,
                    true,
                )
            }
        };
        // Manual beat correctness is checked by the frozen producer per frame.
        let decode_requests = decoded_requests(&admission);
        self.sessions.insert(
            id,
            Session {
                admission,
                beats: input.beats,
                reservation,
                decoded_bound: true,
            },
        );
        self.next_session = id;
        Ok(Prepared {
            session_id: id,
            scene,
            reflection_required,
            post_required,
            reserved_bytes: reserved,
            decode_requests,
            font_resources: aliases.resources,
            font_bindings: input.font_instances,
            font_instance_bytes: aliases.instance_bytes,
            physical_encoded_bytes: length,
        })
    }
    pub fn check_reflection(&self, id: u32, length: usize) -> Result<(), String> {
        validate_reflection_length(length)?;
        if !self.session(id)?.decoded_bound {
            return Err("Night actual decoded image facts not bound".into());
        }
        match &self.session(id)?.admission {
            Admission::WetFloor { settings, .. }
                if settings.mode == "fall" && self.frame.is_none() =>
            {
                Ok(())
            }
            _ => Err("Night reflection binding needs idle wetFloor fall session".into()),
        }
    }
    pub fn bind_reflection(&mut self, id: u32, rgba: &[u8]) -> Result<Value, String> {
        self.check_reflection(id, rgba.len())?;
        let session = self.sessions.get_mut(&id).ok_or("Night stale session")?;
        if let Admission::WetFloor { image, mask, .. } = &mut session.admission {
            *mask = Some(wet_floor::prepare_reflection_mask(image, rgba)?);
            return Ok(
                json!({"sessionId":id,"byteLength":rgba.len(),"sourceId":image.resource.id,
                "sourceSha256":image.resource.sha256(),"sampledSha256":format!("{:x}",Sha256::digest(rgba))}),
            );
        }
        Err("Night reflection admission lost".into())
    }
    pub fn prepare_lut_with<B: AsRef<[u8]>>(
        &mut self,
        metadata: &str,
        length: usize,
        copy: impl FnOnce() -> Result<B, String>,
    ) -> Result<crate::mv_lut_atlas_bridge::Prepared, String> {
        if self.atlas_id.is_some() || self.frame.is_some() {
            return Err("Night LUT already bound/frame active".into());
        }
        crate::mv_lut_atlas_bridge::validate_transport_lengths(metadata.chars().count(), length)?;
        let reservation = self.reserve(length as u64 * 3 + 64 * 1024 * 1024)?;
        let bytes = copy()?;
        if bytes.as_ref().len() != length {
            return Err("Night LUT bytes changed during copy".into());
        }
        let mut prepared = self.atlas.prepare(metadata, bytes.as_ref())?;
        if let Err(error) = self.atlas.sample(prepared.session_id, "P4") {
            self.atlas.dispose(prepared.session_id);
            return Err(error);
        }
        self.atlas_id = Some(prepared.session_id);
        prepared
            .samples
            .insert("P4".into(), self.atlas.sample(prepared.session_id, "P4")?);
        self.atlas_reservation = Some(reservation);
        Ok(prepared)
    }
    pub fn check_lut_row(&self, length: usize) -> Result<(), String> {
        crate::mv_lut_atlas_bridge::validate_row_lengths(length)?;
        if self.frame.is_some() {
            return Err("Night LUT bind while frame active".into());
        }
        self.atlas.sample(
            self.atlas_id.ok_or("Night original LUT not prepared")?,
            "P4",
        )?;
        Ok(())
    }
    pub fn bind_lut_row(&mut self, rgba: &[u8]) -> Result<BoundRow, String> {
        self.check_lut_row(rgba.len())?;
        self.atlas
            .bind_row(self.atlas_id.ok_or("Night LUT missing")?, "P4", rgba)
    }
    fn session(&self, id: u32) -> Result<&Session, String> {
        self.sessions
            .get(&id)
            .ok_or_else(|| "Night stale/unknown session".into())
    }
    pub fn evaluate(&mut self, id: u32, sample: &str) -> Result<Frame, String> {
        if sample.len() > 4096 || self.frame.is_some() {
            return Err("Night sample/frame lifecycle bound exceeded".into());
        }
        let s: Sample = serde_json::from_str(sample).map_err(|e| e.to_string())?;
        let session = self.session(id)?;
        if !session.decoded_bound {
            return Err("Night actual decoded image facts not bound".into());
        }
        let frame_id = self
            .next_frame
            .checked_add(1)
            .ok_or("Night frame identity exhausted")?;
        let reservation = self.reserve(transport::FRAME_RESERVATION)?;
        let (scene, post, lut) = match &session.admission {
            Admission::WetFloor {
                settings,
                image,
                fonts,
                mask,
            } => {
                let sample = wet_floor::Sample {
                    song_ticks: s.song_ticks,
                    shot_start_ticks: s.shot_start_ticks,
                    shot_end_ticks: s.shot_end_ticks,
                    beats: &session.beats,
                };
                (
                    serde_json::to_value(wet_floor::produce(
                        settings,
                        &sample,
                        image,
                        fonts,
                        mask.as_ref(),
                    )?)
                    .map_err(|e| e.to_string())?,
                    None,
                    None,
                )
            }
            Admission::Train {
                settings,
                images,
                fonts,
            } => {
                let atlas_id = self
                    .atlas_id
                    .ok_or("Train requires original named P4 LUT atlas")?;
                let pixels = self.atlas.row_pixels(atlas_id, "P4")?;
                let sample = train::Sample {
                    song_ticks: s.song_ticks,
                    shot_start_ticks: s.shot_start_ticks,
                    shot_end_ticks: s.shot_end_ticks,
                    beats: &session.beats,
                };
                let plan = train::produce(settings, &sample, images, fonts)?;
                if !plan.post.required || plan.post.lut_a != "P4" {
                    return Err("Train original mandatory P4 post intent mismatch".into());
                }
                let mut parameters = serde_json::to_value(&plan.post).map_err(|e| e.to_string())?;
                parameters
                    .as_object_mut()
                    .ok_or("Train invalid native post intent")?
                    .remove("required");
                let resolved = self
                    .atlas
                    .resolve_parameters(atlas_id, &parameters.to_string())?;
                let post = crate::build_reference_post_plan(
                    1920,
                    1080,
                    s.song_ticks
                        .try_into()
                        .map_err(|_| "Night post ticks overflow")?,
                    120000,
                    &resolved,
                )?;
                if !post.required || !post.lut_atlas_required {
                    return Err("Train original GL post not required".into());
                }
                let lut = BoundRow {
                    session_id: atlas_id,
                    alias: "P4".into(),
                    sample: self.atlas.sample(atlas_id, "P4")?,
                    byte_length: pixels.pixels().len(),
                    sampled_sha256: pixels.sampled_sha256().into(),
                };
                (
                    serde_json::to_value(plan).map_err(|e| e.to_string())?,
                    Some(post),
                    Some(lut),
                )
            }
        };
        let mut frame = Frame {
            session_id: id,
            frame_id,
            scene,
            post_required: post.is_some(),
            post,
            lut,
            reserved_bytes: reservation.0,
            scope: "native admitted transcript: WetFloor scene/reflection only (timeline GL post excluded); Train scene plus mandatory original P4 GL post; not executed-pixel/movie/export acceptance",
        };
        bounded_serialization(&frame)?;
        self.next_frame = frame_id;
        self.frame = Some((frame_id, id, reservation));
        // Keep returned object distinct from the reservation lease.
        frame.reserved_bytes = transport::FRAME_RESERVATION;
        Ok(frame)
    }
    pub fn release_frame(&mut self, frame_id: u32) -> Result<(), String> {
        if self.frame.as_ref().map(|(id, _, _)| *id) != Some(frame_id) {
            return Err("Night stale/unknown frame lease".into());
        }
        self.frame = None;
        Ok(())
    }
    pub fn dispose(&mut self, id: u32) -> Result<(), String> {
        if self
            .frame
            .as_ref()
            .is_some_and(|(_, session, _)| *session == id)
        {
            return Err(
                "Night destroy native frame surfaces/release lease before session disposal".into(),
            );
        }
        self.sessions
            .remove(&id)
            .ok_or("Night stale/unknown session")?;
        Ok(())
    }
    pub fn clear(&mut self) -> Result<(), String> {
        if self.frame.is_some() {
            return Err("Night destroy native frame surfaces/release lease before clear".into());
        }
        self.sessions.clear();
        self.atlas.clear();
        self.atlas_id = None;
        self.atlas_reservation = None;
        Ok(())
    }
}
fn decoded_requests(admission: &Admission) -> Vec<DecodedImage> {
    match admission {
        Admission::WetFloor { image, .. } => vec![DecodedImage {
            resource_id: image.resource.id.clone(),
            width: image.width,
            height: image.height,
        }],
        Admission::Train { images, .. } => images
            .iter()
            .map(|i| DecodedImage {
                resource_id: i.resource.id.clone(),
                width: i.width,
                height: i.height,
            })
            .collect(),
    }
}
fn find<'a>(resources: &'a [Resource], id: &str) -> Result<&'a Resource, String> {
    resources
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Night required resource missing".into())
}
fn metadata_scope(input: &Prepare) -> Result<(&'static str, fonts::Aliases), String> {
    if input.resources.len() > 39 || input.byte_layout.len() != input.resources.len() {
        return Err("Night physical resource count/layout mismatch".into());
    }
    // This COMPLETE physical list still obeys the shared 64 MiB aggregate.
    if let Some(issue) = programmatic_resources::validate(&input.resources).first() {
        return Err(issue.message.clone());
    }
    let (scene, ids) = match &input.binding {
        Settings::WetFloor { settings: a } => {
            a.validate()?;
            ("wetFloor", vec![a.bg.as_str()])
        }
        Settings::Train { settings: a } => {
            a.validate()?;
            let mut ids = vec![a.bg.as_str()];
            ids.extend(a.characters());
            ("train", ids)
        }
    };
    for id in &ids {
        if find(&input.resources, id)?.kind != "image" {
            return Err("Night required image ID/source kind mismatch".into());
        }
    }
    let aliases = fonts::metadata(
        &input.resources,
        &input.font_instances,
        &fonts::role_ids(&input.binding)?,
    )?;
    let expected: BTreeSet<_> = ids
        .into_iter()
        .chain(input.font_instances.iter().map(|i| i.resource_id.as_str()))
        .collect();
    if expected.len() != input.resources.len()
        || input
            .resources
            .iter()
            .any(|r| !expected.contains(r.id.as_str()))
    {
        return Err("Night physical manifest contains missing/extra/unrelated sources".into());
    }
    Ok((scene, aliases))
}
/// Bounded writer stops serialization without creating an oversized output Vec.
fn bounded_serialization(frame: &Frame) -> Result<(), String> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(buf.len())
                .filter(|n| *n <= transport::MAX_FRAME_JSON_BYTES)
                .ok_or_else(|| std::io::Error::other("Night frame JSON budget exceeded"))?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Counter(0), frame).map_err(|e| e.to_string())
}
#[cfg(test)]
#[path = "mv_night_owner_tests.rs"]
mod tests;
