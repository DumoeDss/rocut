//! Transient render-owner capability. Not an authored recipe/resource facts API.
//! The private native provider owns source encoded bytes, decoded RGBA/backing,
//! and upload/bitmap copies; reservations account for them but do not own them.
//! All capabilities and counters live only in this Rust/WASM instance.
use crate::{mv_recipe::heart, programmatic_resources::Resource};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};

pub const MAX_OWNER_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GLOBAL_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_OWNERS: u32 = 8;
pub const MAX_OWNER_SESSIONS: usize = 4;
pub const MAX_GLOBAL_SESSIONS: u32 = 16;
const MAX_INPUT_JSON: usize = 64 * 1024;
const MAX_OUTPUT_JSON: usize = 16 * 1024 * 1024;
const METADATA_RESERVATION: u64 = 64 * 1024;
// Full validated bindings repeated in image records plus temporary manifest
// clones/serialization and provider metadata copies. Reserved before preparation.
const IMAGE_METADATA_RESERVATION: u64 = 16 * 1024;
const DECODER: &str = "canvas2d-srgb-unpremultiplied-rgba8-v1";

struct Global {
    next_owner: u32,
    owners: u32,
    sessions: u32,
    bytes: u64,
}
static GLOBAL: Mutex<Global> = Mutex::new(Global {
    next_owner: 1,
    owners: 0,
    sessions: 0,
    bytes: 0,
});
fn global() -> Result<std::sync::MutexGuard<'static, Global>, String> {
    GLOBAL
        .lock()
        .map_err(|_| "Heart owner budget lock poisoned".into())
}
struct Reservation {
    bytes: u64,
    active: bool,
}
impl Reservation {
    fn new(bytes: u64) -> Result<Self, String> {
        let mut state = global()?;
        let total = state
            .bytes
            .checked_add(bytes)
            .ok_or("Heart global reservation overflow")?;
        if total > MAX_GLOBAL_BYTES || state.sessions >= MAX_GLOBAL_SESSIONS {
            return Err("Heart global session/reservation capability exhausted".into());
        }
        state.bytes = total;
        state.sessions += 1;
        Ok(Self {
            bytes,
            active: true,
        })
    }
    fn transfer(&mut self) {
        self.active = false;
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if self.active {
            if let Ok(mut state) = global() {
                state.bytes -= self.bytes;
                state.sessions -= 1;
            }
        }
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    if json.len() > MAX_INPUT_JSON {
        return Err("Heart owner metadata input exceeds 64 KiB".into());
    }
    serde_json::from_str(json).map_err(|e| format!("Heart owner metadata: {e}"))
}
fn json<T: Serialize>(value: &T) -> Result<String, String> {
    let output = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if output.len() > MAX_OUTPUT_JSON {
        return Err("Heart owner metadata output exceeds 16 MiB".into());
    }
    Ok(output)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Range {
    offset: usize,
    length: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Layout {
    source: Range,
    background: Option<Range>,
}
impl Layout {
    fn validate(&self, length: usize, background: bool) -> Result<(), String> {
        if self.source.offset != 0
            || self.source.length == 0
            || self.background.is_some() != background
        {
            return Err("Heart packet layout/source/background mismatch".into());
        }
        let end = if let Some(range) = &self.background {
            if range.offset != self.source.length || range.length == 0 {
                return Err("Heart packet gap/overlap/empty background".into());
            }
            range
                .offset
                .checked_add(range.length)
                .ok_or("Heart packet range overflow")?
        } else {
            self.source.length
        };
        if end != length {
            return Err("Heart packet trailing/missing bytes".into());
        }
        Ok(())
    }
    fn split<'a>(
        &self,
        bytes: &'a [u8],
        background: bool,
    ) -> Result<(&'a [u8], Option<&'a [u8]>), String> {
        if self.source.offset != 0
            || self.source.length == 0
            || self.background.is_some() != background
        {
            return Err("Heart packet layout/source/background mismatch".into());
        }
        let source = bytes
            .get(..self.source.length)
            .ok_or("Heart packet source range exceeds bytes")?;
        let end = if let Some(range) = &self.background {
            if range.offset != self.source.length || range.length == 0 {
                return Err("Heart packet gap/overlap/empty background".into());
            }
            range
                .offset
                .checked_add(range.length)
                .ok_or("Heart packet range overflow")?
        } else {
            self.source.length
        };
        if end != bytes.len() {
            return Err("Heart packet trailing/missing bytes".into());
        }
        Ok((
            source,
            self.background
                .as_ref()
                .map(|range| &bytes[range.offset..end]),
        ))
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundBinding {
    pub source: Resource,
    pub decoded_width: u32,
    pub decoded_height: u32,
    pub decoded_rgba_sha256: String,
    pub decoder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareInput {
    source: Resource,
    binding: heart::Binding,
    background: Option<BackgroundBinding>,
    ceiling_bytes: u64,
    encoded_layout: Layout,
    decoded_layout: Layout,
}
fn metadata(input: &PrepareInput, encoded_len: usize, decoded_len: usize) -> Result<u64, String> {
    if input.source != input.binding.source {
        return Err("Heart declared source differs from native binding".into());
    }
    input
        .encoded_layout
        .validate(encoded_len, input.background.is_some())?;
    input
        .decoded_layout
        .validate(decoded_len, input.background.is_some())?;
    if encoded_len > 32 * 1024 * 1024 || decoded_len > 128 * 1024 * 1024 {
        return Err("Heart binary packet exceeds hard limits".into());
    }
    let resources: Vec<_> = std::iter::once(input.source.clone())
        .chain(input.background.as_ref().map(|b| b.source.clone()))
        .collect();
    if let Some(issue) = crate::programmatic_resources::validate(&resources).first() {
        return Err(issue.message.clone());
    }
    let valid_sha = |sha: &str| {
        sha.len() == 64
            && sha
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    if input.source.kind != "image"
        || input.binding.decoder != DECODER
        || input.binding.algorithm != "heart-components-v1"
        || !valid_sha(&input.binding.decoded_rgba_sha256)
    {
        return Err("Heart source/native decoder/algorithm identity malformed".into());
    }
    if input.encoded_layout.source.length as u64 != input.source.byte_length()
        || input.decoded_layout.source.length as u64
            != crate::image_sequence::decoded_image_bytes(
                input.binding.decoded_width,
                input.binding.decoded_height,
            )?
    {
        return Err("Heart source packet dimensions/length mismatch".into());
    }
    let mut bg_charge = 0;
    if let Some(bg) = &input.background {
        let rgba = crate::image_sequence::decoded_image_bytes(bg.decoded_width, bg.decoded_height)?;
        if bg.source.kind != "image"
            || bg.source.id == input.source.id
            || bg.decoder != DECODER
            || !valid_sha(&bg.decoded_rgba_sha256)
            || input
                .encoded_layout
                .background
                .as_ref()
                .map(|r| r.length as u64)
                != Some(bg.source.byte_length())
            || input
                .decoded_layout
                .background
                .as_ref()
                .map(|r| r.length as u64)
                != Some(rgba)
        {
            return Err("Heart background native decoder/packet identity malformed".into());
        }
        bg_charge = rgba
            .checked_mul(2)
            .and_then(|n| n.checked_add(bg.source.byte_length()))
            .ok_or("Heart background budget overflow")?;
    }
    // Platform snapshots/readback/backing are charged by Heart admission and
    // bg_charge. The provider's immutable packet and inbound WASM copy are
    // distinct from those caller snapshots and must both remain reserved.
    bg_charge
        .checked_add(
            (encoded_len as u64)
                .checked_mul(2)
                .ok_or("Heart encoded packet budget overflow")?,
        )
        .and_then(|n| n.checked_add((decoded_len as u64).checked_mul(2)?))
        .and_then(|n| n.checked_add(METADATA_RESERVATION))
        .and_then(|n| {
            n.checked_add(
                (1 + input.decoded_layout.source.length as u64 / 4 / 50)
                    .checked_mul(IMAGE_METADATA_RESERVATION)?,
            )
        })
        .ok_or("Heart binary copy budget overflow".into())
}
fn encoded(resource: &Resource, bytes: &[u8], dimensions: [u32; 2]) -> Result<(), String> {
    if let Some(issue) =
        crate::programmatic_resources::validate(std::slice::from_ref(resource)).first()
    {
        return Err(issue.message.clone());
    }
    if resource.kind != "image"
        || resource.byte_length() != bytes.len() as u64
        || resource.sha256() != hash(bytes)
    {
        return Err("Heart encoded source descriptor/length/SHA mismatch".into());
    }
    let actual = crate::image_sequence::inspect_encoded_image(resource.mime_type(), bytes)?;
    if actual != (dimensions[0], dimensions[1]) {
        return Err("Heart encoded MIME/header dimensions differ from native binding".into());
    }
    Ok(())
}
fn background(
    binding: &BackgroundBinding,
    encoded_bytes: &[u8],
    rgba: &[u8],
) -> Result<u64, String> {
    encoded(
        &binding.source,
        encoded_bytes,
        [binding.decoded_width, binding.decoded_height],
    )?;
    let length =
        crate::image_sequence::decoded_image_bytes(binding.decoded_width, binding.decoded_height)?;
    if binding.decoder != DECODER
        || length != rgba.len() as u64
        || binding.decoded_rgba_sha256 != hash(rgba)
    {
        return Err("Heart background native decoder identity mismatch".into());
    }
    // Platform encoded snapshot + platform decoded readback and native backing.
    length
        .checked_mul(2)
        .and_then(|n| n.checked_add(encoded_bytes.len() as u64))
        .ok_or("Heart background budget overflow".into())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub owner_id: u32,
    pub session_id: u32,
    pub binding: heart::Binding,
    pub background: Option<BackgroundBinding>,
    pub images_manifest_sha256: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub index: u32,
    pub byte_length: u64,
    pub image: heart::PreparedImage,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub identity: Identity,
    pub images: Vec<Image>,
    pub reserved_bytes: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub identity: Identity,
    pub plan: heart::Plan,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    content = "settings",
    rename_all = "camelCase",
    deny_unknown_fields
)]
enum Scene {
    HeartShatter(heart::HeartShatter),
    HeartBurn(heart::HeartBurn),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameInput {
    scene: Scene,
    shot_start_ticks: u64,
    shot_end_ticks: u64,
    song_ticks: u64,
    beats: Vec<u64>,
    bpm: f64,
}
struct Entry {
    session: heart::Session,
    identity: Identity,
    images: Vec<Image>,
    reserved_bytes: u64,
    uploaded: BTreeSet<u32>,
}
/// Separate from source JSON: construction and session lookup require this live object.
pub struct Owner {
    id: u32,
    next_session: u32,
    entries: BTreeMap<u32, Entry>,
    reserved_bytes: u64,
    disposed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub max_owner_bytes: u64,
    pub max_global_bytes: u64,
    pub max_owners: u32,
    pub max_owner_sessions: usize,
    pub max_global_sessions: u32,
    pub binary_images: bool,
    pub scope: &'static str,
}
impl Owner {
    pub fn capability_json() -> Result<String, String> {
        json(&Capability {
            max_owner_bytes: MAX_OWNER_BYTES,
            max_global_bytes: MAX_GLOBAL_BYTES,
            max_owners: MAX_OWNERS,
            max_owner_sessions: MAX_OWNER_SESSIONS,
            max_global_sessions: MAX_GLOBAL_SESSIONS,
            binary_images: true,
            scope: "prototype transient Rust-owner reservations; provider external encoded/readback/native/upload copies included conservatively; not whole-renderer residency or arbitrary multi-node capacity",
        })
    }
    pub fn new() -> Result<Self, String> {
        let mut state = global()?;
        if state.owners >= MAX_OWNERS {
            return Err("Heart owner capability exhausted (8 live owners)".into());
        }
        let id = state.next_owner;
        state.next_owner = id.checked_add(1).ok_or("Heart owner identity exhausted")?;
        state.owners += 1;
        Ok(Self {
            id,
            next_session: 1,
            entries: BTreeMap::new(),
            reserved_bytes: 0,
            disposed: false,
        })
    }
    fn check(&self) -> Result<(), String> {
        if self.disposed {
            Err("Heart render owner disposed".into())
        } else {
            Ok(())
        }
    }
    pub fn diagnostic_json(&self) -> Result<String, String> {
        let state = global()?;
        json(
            &serde_json::json!({"ownerId":self.id,"disposed":self.disposed,"sessions":self.entries.len(),"reservedBytes":self.reserved_bytes,"globalOwners":state.owners,"globalSessions":state.sessions,"globalReservedBytes":state.bytes,"metric":"conservative Rust capability reservation including stated provider copies; not measured whole-renderer resident memory"}),
        )
    }
    /// Metadata admission precedes component/fracture/crop allocations. Binary
    /// input slices are borrowed, not copied into JSON or retained in the owner.
    pub fn prepare(
        &mut self,
        input: &str,
        encoded_packet: &[u8],
        decoded_packet: &[u8],
    ) -> Result<u32, String> {
        self.prepare_with(input, encoded_packet.len(), decoded_packet.len(), || {
            Ok((encoded_packet, decoded_packet))
        })
    }
    /// Length/metadata/aggregate reservation is checked before invoking the
    /// platform copy closure. WASM Uint8Array input references remain borrowed
    /// until this reservation; oversized input cannot allocate a Rust Vec first.
    pub fn prepare_with<E: AsRef<[u8]>, D: AsRef<[u8]>>(
        &mut self,
        input: &str,
        encoded_len: usize,
        decoded_len: usize,
        copy: impl FnOnce() -> Result<(E, D), String>,
    ) -> Result<u32, String> {
        self.check()?;
        let input: PrepareInput = parse(input)?;
        if input.ceiling_bytes == 0
            || input.ceiling_bytes > MAX_OWNER_BYTES
            || self.entries.len() >= MAX_OWNER_SESSIONS
        {
            return Err("Heart session ceiling/capability exceeded".into());
        }
        let extra = metadata(&input, encoded_len, decoded_len)?;
        let preparation_ceiling = input
            .ceiling_bytes
            .checked_sub(extra)
            .ok_or("Heart joint preparation ceiling exceeded")?;
        heart::Session::preparation_admission(&input.binding, preparation_ceiling as usize)?;
        let local = self
            .reserved_bytes
            .checked_add(input.ceiling_bytes)
            .ok_or("Heart owner reservation overflow")?;
        if local > MAX_OWNER_BYTES {
            return Err("Heart owner aggregate ceiling exceeded".into());
        }
        let session_id = self.next_session;
        self.next_session = session_id
            .checked_add(1)
            .ok_or("Heart session identity exhausted")?;
        let mut reservation = Reservation::new(input.ceiling_bytes)?;
        let result = (|| {
            let (encoded_packet, decoded_packet) = copy()?;
            let (encoded_packet, decoded_packet) =
                (encoded_packet.as_ref(), decoded_packet.as_ref());
            if encoded_packet.len() != encoded_len || decoded_packet.len() != decoded_len {
                return Err("Heart binary input changed while copying".into());
            }
            let (source_encoded, bg_encoded) = input
                .encoded_layout
                .split(encoded_packet, input.background.is_some())?;
            let (source_rgba, bg_rgba) = input
                .decoded_layout
                .split(decoded_packet, input.background.is_some())?;
            encoded(
                &input.source,
                source_encoded,
                [input.binding.decoded_width, input.binding.decoded_height],
            )?;
            input.binding.validate_source(source_rgba)?;
            match (&input.background, bg_encoded, bg_rgba) {
                (Some(binding), Some(bytes), Some(rgba)) => {
                    background(binding, bytes, rgba)?;
                }
                (None, None, None) => {}
                _ => return Err("Heart background binary admission incomplete".into()),
            }
            let session = heart::Session::prepare(
                input.binding.clone(),
                source_rgba,
                preparation_ceiling as usize,
            )?;
            let images: Vec<Image> = session
                .images()
                .iter()
                .enumerate()
                .map(|(index, (image, bytes))| Image {
                    index: index as u32,
                    byte_length: bytes.len() as u64,
                    image: (*image).clone(),
                })
                .collect();
            let images_json = json(&images)?;
            let identity = Identity {
                owner_id: self.id,
                session_id,
                binding: input.binding,
                background: input.background,
                images_manifest_sha256: hash(images_json.as_bytes()),
            };
            let entry = Entry {
                session,
                identity,
                images,
                reserved_bytes: input.ceiling_bytes,
                uploaded: BTreeSet::new(),
            };
            // Bound the first metadata publication before retaining the session.
            json(&Manifest {
                identity: entry.identity.clone(),
                images: entry.images.clone(),
                reserved_bytes: entry.reserved_bytes,
            })?;
            Ok(entry)
        })();
        match result {
            Ok(entry) => {
                self.entries.insert(session_id, entry);
                self.reserved_bytes = local;
                reservation.transfer();
                Ok(session_id)
            }
            Err(error) => Err(error),
        }
    }
    pub fn manifest_json(&mut self, session: u32) -> Result<String, String> {
        let result = (|| {
            self.check()?;
            let entry = self
                .entries
                .get(&session)
                .ok_or("Unknown/stale Heart session")?;
            json(&Manifest {
                identity: entry.identity.clone(),
                images: entry.images.clone(),
                reserved_bytes: entry.reserved_bytes,
            })
        })();
        if result.is_err() {
            self.cancel(session)?;
        }
        result
    }
    /// One upload copy at a time. The provider must release it after constructing
    /// its admitted bitmap; holding further copies is outside this capability.
    pub fn image_bytes(&mut self, session: u32, index: u32) -> Result<Vec<u8>, String> {
        self.with_image_bytes(session, index, |bytes| Ok(bytes.to_vec()))
    }
    pub fn with_image_bytes<T>(
        &mut self,
        session: u32,
        index: u32,
        copy: impl FnOnce(&[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        let result = (|| {
            self.check()?;
            let entry = self
                .entries
                .get_mut(&session)
                .ok_or("Unknown/stale Heart session")?;
            if entry.uploaded.contains(&index) {
                return Err("Heart image binary extraction capability already consumed".into());
            }
            let images = entry.session.images();
            let (image, bytes) = images
                .get(index as usize)
                .ok_or("Heart image index exceeds admitted manifest")?;
            let expected = entry
                .images
                .get(index as usize)
                .ok_or("Heart image manifest missing")?;
            image.validate_rgba(&expected.image, bytes)?;
            let result = copy(bytes)?;
            entry.uploaded.insert(index);
            Ok(result)
        })();
        if result.is_err() {
            self.cancel(session)?;
        }
        result
    }
    pub fn frame_json(&mut self, session: u32, input: &str) -> Result<String, String> {
        let result = (|| {
            self.check()?;
            let entry = self
                .entries
                .get(&session)
                .ok_or("Unknown/stale Heart session")?;
            let input: FrameInput = parse(input)?;
            let mut resources = vec![entry.identity.binding.source.clone()];
            if let Some(bg) = &entry.identity.background {
                resources.push(bg.source.clone());
            }
            let sample =
                heart::Sample {
                    shot_start_ticks: input.shot_start_ticks,
                    shot_end_ticks: input.shot_end_ticks,
                    song_ticks: input.song_ticks,
                    beats: &input.beats,
                    bpm: input.bpm,
                    resources: &resources,
                    background: entry.identity.background.as_ref().map(|bg| {
                        heart::BackgroundFact {
                            resource: &bg.source,
                            width: bg.decoded_width,
                            height: bg.decoded_height,
                        }
                    }),
                };
            let plan = match input.scene {
                Scene::HeartShatter(settings) => entry.session.frame(&settings, &sample)?,
                Scene::HeartBurn(settings) => entry.session.burn_frame(&settings, &sample)?,
            };
            if plan
                .raster_budget_bytes
                .checked_add(METADATA_RESERVATION)
                .ok_or("Heart frame budget overflow")?
                > entry.reserved_bytes
            {
                return Err("Heart frame exceeds retained owner/session reservation".into());
            }
            json(&Frame {
                identity: entry.identity.clone(),
                plan,
            })
        })();
        if result.is_err() {
            self.cancel(session)?;
        }
        result
    }
    pub fn cancel(&mut self, session: u32) -> Result<bool, String> {
        if let Some(entry) = self.entries.remove(&session) {
            let mut state = global()?;
            state.bytes -= entry.reserved_bytes;
            state.sessions -= 1;
            self.reserved_bytes -= entry.reserved_bytes;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub fn dispose(&mut self) -> Result<(), String> {
        if self.disposed {
            return Ok(());
        }
        let mut state = global()?;
        state.bytes -= self.reserved_bytes;
        state.sessions -= self.entries.len() as u32;
        state.owners -= 1;
        self.entries.clear();
        self.reserved_bytes = 0;
        self.disposed = true;
        Ok(())
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.dispose();
    }
}
#[cfg(test)]
#[path = "mv_heart_owner_tests.rs"]
mod tests;
