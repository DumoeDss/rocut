//! Private transient native owner. Never a recipe deserialization capability.
use crate::mv_recipe::memories;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};
#[path = "mv_memories_owner_admission.rs"]
mod admission;
#[path = "mv_memories_owner_fonts.rs"]
mod fonts;
#[path = "mv_memories_owner_protocol.rs"]
mod protocol;
#[path = "mv_memories_owner_source.rs"]
mod source;
#[path = "mv_memories_owner_stage.rs"]
mod stage;
use protocol::*;
pub use stage::{Output, Stage};
const LIMIT: u64 = 256 * 1024 * 1024;
static NEXT: AtomicU32 = AtomicU32::new(1);
static GLOBAL: Mutex<u64> = Mutex::new(0);
struct Lease {
    bytes: u64,
}
impl Lease {
    fn new(bytes: u64) -> Result<Arc<Self>, String> {
        let mut g = GLOBAL
            .lock()
            .map_err(|_| "Memories reservation lock poisoned")?;
        let n = g
            .checked_add(bytes)
            .ok_or("Memories reservation overflow")?;
        if n > LIMIT {
            return Err("Memories global native lease budget exceeded".into());
        }
        *g = n;
        Ok(Arc::new(Self { bytes }))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut g) = GLOBAL.lock() {
            *g -= self.bytes;
        }
    }
}
struct Entry {
    session: memories::Session,
    resources: Vec<crate::programmatic_resources::Resource>,
    identity: Identity,
    lease: Arc<Lease>,
    extra: u64,
    uploaded: BTreeSet<String>,
    frame_serial: u32,
    pending_frame: Option<u32>,
}
pub struct Owner {
    id: u32,
    next: u32,
    entries: BTreeMap<u32, Entry>,
    disposed: bool,
}
pub struct Preparation {
    owner: u32,
    lease: Arc<Lease>,
}
impl Owner {
    pub fn reserve(&self, bytes: u64) -> Result<Preparation, String> {
        if self.disposed || bytes == 0 || bytes > LIMIT {
            return Err("Memories native preparation ceiling invalid".into());
        }
        Ok(Preparation {
            owner: self.id,
            lease: Lease::new(bytes)?,
        })
    }
    pub fn new() -> Result<Self, String> {
        let id = NEXT
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
            .map_err(|_| "Memories owner identity exhausted")?;
        Ok(Self {
            id,
            next: 1,
            entries: BTreeMap::new(),
            disposed: false,
        })
    }
    fn entry(&mut self, id: u32) -> Result<&mut Entry, String> {
        if self.disposed {
            return Err("Memories owner disposed".into());
        }
        self.entries
            .get_mut(&id)
            .ok_or_else(|| "Unknown/stale Memories session".into())
    }
    pub fn capability_json() -> Result<String, String> {
        json(
            &serde_json::json!({"maxOwnerBytes":LIMIT,"maxGlobalBytes":LIMIT,"maxOwnerSessions":4,"binaryImages":true,"opaqueStages":true}),
        )
    }
    pub fn diagnostic_json(&self) -> Result<String, String> {
        json(
            &serde_json::json!({"ownerId":self.id,"disposed":self.disposed,"sessions":self.entries.len(),"reservedBytes":self.entries.values().map(|e|e.lease.bytes).sum::<u64>(),"globalReservedBytes":*GLOBAL.lock().map_err(|_|"Memories reservation lock poisoned")?}),
        )
    }
    pub fn measurement_requests_json(args: &str) -> Result<String, String> {
        let args: memories::model::Args = parse(args)?;
        json(&memories::admission::measurement_requests(&args)?)
    }
    /// Reserve before the WASM boundary creates its ingress copies.
    pub fn prepare_with<E: AsRef<[u8]>, D: AsRef<[u8]>>(
        &mut self,
        input: &str,
        encoded_len: usize,
        decoded_len: usize,
        copy: impl FnOnce() -> Result<(E, D), String>,
    ) -> Result<u32, String> {
        let i: Input = parse(input)?;
        let ticket = self.reserve(i.ceiling_bytes)?;
        self.prepare_reserved_with(ticket, input, encoded_len, decoded_len, copy)
    }
    pub fn prepare_reserved_with<E: AsRef<[u8]>, D: AsRef<[u8]>>(
        &mut self,
        ticket: Preparation,
        input: &str,
        encoded_len: usize,
        decoded_len: usize,
        copy: impl FnOnce() -> Result<(E, D), String>,
    ) -> Result<u32, String> {
        if self.disposed || self.entries.len() >= 4 {
            return Err("Memories owner session capability unavailable".into());
        }
        let i: Input = parse(input)?;
        if ticket.owner != self.id || ticket.lease.bytes != i.ceiling_bytes {
            return Err("Memories preparation lease belongs to another owner/ceiling".into());
        }
        if i.ceiling_bytes == 0
            || i.ceiling_bytes > LIMIT
            || self.entries.values().map(|e| e.lease.bytes).sum::<u64>() + i.ceiling_bytes > LIMIT
        {
            return Err("Memories owner aggregate ceiling exceeded".into());
        }
        let extra = admission::metadata(&i, encoded_len, decoded_len)?;
        let ceiling = i
            .ceiling_bytes
            .checked_sub(extra)
            .ok_or("Memories joint native transport ceiling exceeded")?;
        let lease = ticket.lease;
        let (encoded, rgba) = copy()?;
        if encoded.as_ref().len() != encoded_len || rgba.as_ref().len() != decoded_len {
            return Err("Memories input packets changed while copying".into());
        }
        let facts = admission::facts(&i, encoded.as_ref(), rgba.as_ref())?;
        let session =
            memories::Session::prepare(i.args, i.resources.clone(), facts, ceiling as usize)?;
        let id = self.next;
        self.next = id
            .checked_add(1)
            .ok_or("Memories session identity exhausted")?;
        self.entries.insert(
            id,
            Entry {
                session,
                resources: i.resources,
                identity: Identity {
                    owner_id: self.id,
                    session_id: id,
                },
                lease,
                extra,
                uploaded: BTreeSet::new(),
                frame_serial: 0,
                pending_frame: None,
            },
        );
        Ok(id)
    }
    pub fn prepare(&mut self, input: &str, encoded: &[u8], rgba: &[u8]) -> Result<u32, String> {
        self.prepare_with(input, encoded.len(), rgba.len(), || Ok((encoded, rgba)))
    }
    pub fn prepared_json(&mut self, id: u32) -> Result<String, String> {
        let e = self.entry(id)?;
        let rasters: Vec<_> = e.session.prepared()?.into_iter().map(|(r, _)| r).collect();
        json(
            &serde_json::json!({"identity":e.identity,"rasters":rasters,"reservedBytes":e.lease.bytes}),
        )
    }
    pub fn prepared_bytes<T>(
        &mut self,
        id: u32,
        index: usize,
        copy: impl FnOnce(&[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        let e = self.entry(id)?;
        let prepared = e.session.prepared()?;
        let (r, bytes) = prepared
            .get(index)
            .ok_or("Memories prepared index missing")?;
        if !e.uploaded.insert(r.part.clone()) {
            return Err("Memories prepared upload already consumed".into());
        }
        if hash(bytes) != r.rgba_sha256 {
            return Err("Memories retained payload digest mismatch".into());
        }
        copy(bytes)
    }
    pub fn frame(&mut self, id: u32, input: &str) -> Result<Output, String> {
        let i: FrameInput = parse(input)?;
        let e = self.entry(id)?;
        if e.pending_frame.is_some() || e.uploaded.len() != e.session.prepared()?.len() {
            return Err("Memories frame upload/publication pending".into());
        }
        let frame = e.session.frame(&memories::Sample {
            song_ticks: i.song_ticks,
            shot_start_ticks: i.shot_start_ticks,
            shot_end_ticks: i.shot_end_ticks,
            beats: &i.beats,
            bpm: i.bpm,
            downbeat_index: i.downbeat_index,
            resources: &e.resources,
        })?;
        if frame
            .plan
            .raster_budget_bytes
            .checked_add(e.extra)
            .ok_or("Memories frame joint overflow")?
            > e.lease.bytes
        {
            return Err("Memories frame joint native budget exceeded".into());
        }
        e.frame_serial = e
            .frame_serial
            .checked_add(1)
            .ok_or("Memories publication identity exhausted")?;
        e.pending_frame = Some(e.frame_serial);
        Output::new(
            e.identity,
            e.frame_serial,
            frame.plan,
            frame.payloads,
            e.lease.clone(),
        )
    }
    pub fn finish_frame(&mut self, id: u32, output: Output) -> Result<(), String> {
        let e = self.entry(id)?;
        if output.identity.owner_id != e.identity.owner_id
            || output.identity.session_id != id
            || e.pending_frame != Some(output.serial)
            || output.remaining() != 0
        {
            return Err("Memories frame publication capability mismatch".into());
        }
        e.pending_frame = None;
        Ok(())
    }
    pub fn cancel(&mut self, id: u32) -> bool {
        self.entries.remove(&id).is_some()
    }
    pub fn dispose(&mut self) {
        self.entries.clear();
        self.disposed = true;
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.dispose();
    }
}
#[cfg(test)]
#[path = "mv_memories_owner_tests.rs"]
mod tests;
