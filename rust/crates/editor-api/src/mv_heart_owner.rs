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

include!("mv_heart_owner_budget.rs");
include!("mv_heart_owner_protocol.rs");
include!("mv_heart_owner_output.rs");
include!("mv_heart_owner_sky.rs");
struct Entry {
    session: heart::Session,
    identity: Identity,
    images: Vec<Image>,
    reserved_bytes: u64,
    frame_extra: u64,
    uploaded: BTreeSet<u32>,
}
/// Separate from source JSON: construction and session lookup require this live object.
pub struct Owner {
    id: u32,
    next_session: u32,
    entries: BTreeMap<u32, Entry>,
    sky_entries: BTreeMap<u32, SkyEntry>,
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
            sky_entries: BTreeMap::new(),
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
            &serde_json::json!({"ownerId":self.id,"disposed":self.disposed,"sessions":self.entries.len()+self.sky_entries.len(),"reservedBytes":self.reserved_bytes,"globalOwners":state.owners,"globalSessions":state.sessions,"globalReservedBytes":state.bytes,"metric":"conservative Rust capability reservation including stated provider copies; not measured whole-renderer resident memory"}),
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
            || self.entries.len() + self.sky_entries.len() >= MAX_OWNER_SESSIONS
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
            match (
                &input.character,
                character_bytes(&input.encoded_layout, encoded_packet)?,
                character_bytes(&input.decoded_layout, decoded_packet)?,
            ) {
                (Some(binding), Some(bytes), Some(rgba)) => {
                    background(binding, bytes, rgba)?;
                }
                (None, None, None) => {}
                _ => return Err("Heart character binary admission incomplete".into()),
            }
            match (&input.background, bg_encoded, bg_rgba) {
                (Some(binding), Some(bytes), Some(rgba)) => {
                    background(binding, bytes, rgba)?;
                }
                (None, None, None) => {}
                _ => return Err("Heart background binary admission incomplete".into()),
            }
            let discovery = heart::Session::discover_with_metadata(
                input.binding.clone(),
                source_rgba,
                preparation_ceiling as usize,
                IMAGE_METADATA_RESERVATION as usize,
            )?;
            let image_metadata = (discovery.actual_parts() as u64)
                .checked_mul(IMAGE_METADATA_RESERVATION)
                .ok_or("Heart actual image metadata budget overflow")?;
            let final_ceiling = preparation_ceiling
                .checked_sub(image_metadata)
                .ok_or("Heart actual image metadata exceeds joint ceiling")?;
            let session = discovery.finish(source_rgba, final_ceiling as usize)?;
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
                character: input.character,
                images_manifest_sha256: hash(images_json.as_bytes()),
            };
            let entry = Entry {
                session,
                identity,
                images,
                reserved_bytes: input.ceiling_bytes,
                frame_extra: (encoded_len as u64)
                    .checked_add(decoded_len as u64)
                    .and_then(|v| v.checked_mul(2))
                    .and_then(|v| v.checked_add(METADATA_RESERVATION))
                    .and_then(|v| v.checked_add(image_metadata))
                    .ok_or("Heart retained copy budget overflow")?,
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
        if self.sky_entries.contains_key(&session) {
            return self.sky_manifest_json(session);
        }
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
        if self.sky_entries.contains_key(&session) {
            return self.sky_frame_json(session, input);
        }
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
            if let Some(character) = &entry.identity.character {
                resources.push(character.source.clone());
            }
            let character = entry
                .identity
                .character
                .as_ref()
                .map(|c| heart::BackgroundFact {
                    resource: &c.source,
                    width: c.decoded_width,
                    height: c.decoded_height,
                });
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
                Scene::HeartGather(settings) => entry.session.gather_frame(
                    &settings,
                    &sample,
                    character
                        .as_ref()
                        .ok_or("Gather requires admitted character")?,
                )?,
                Scene::SunBloom(settings) => entry.session.sun_frame(
                    &settings,
                    &sample,
                    character
                        .as_ref()
                        .ok_or("Sun requires admitted character")?,
                )?,
                Scene::SkyShatter(_) => return Err("Sky requires a retained Sky session".into()),
            };
            if plan
                .raster_budget_bytes
                .checked_add(entry.frame_extra)
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
        if let Some(entry) = self.sky_entries.remove(&session) {
            let mut state = global()?;
            state.bytes -= entry.reserved_bytes;
            state.sessions -= 1;
            self.reserved_bytes -= entry.reserved_bytes;
            return Ok(true);
        }
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
        state.sessions -= (self.entries.len() + self.sky_entries.len()) as u32;
        state.owners -= 1;
        self.entries.clear();
        self.sky_entries.clear();
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
