//! Native JIZURA attachment owner: leases and frame lifetimes are not author data.
use crate::{
    mv_recipe::jz::{Font, MAX_BYTES, MAX_OWNER_SESSIONS, Request},
    programmatic_resources::{self, Resource},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};
#[path = "mv_jz_fonts.rs"]
mod fonts;
#[cfg(test)]
#[path = "mv_jz_owner_tests.rs"]
mod tests;
static GLOBAL: Mutex<(u64, usize)> = Mutex::new((0, 0));
struct Lease(u64);
impl Lease {
    fn new(bytes: u64) -> Result<Arc<Self>, String> {
        let mut g = GLOBAL
            .lock()
            .map_err(|_| "JIZURA reservation lock poisoned")?;
        let total =
            g.0.checked_add(bytes)
                .ok_or("JIZURA global budget overflow")?;
        if total > MAX_BYTES || g.1 >= MAX_OWNER_SESSIONS {
            return Err("JIZURA global native budget exceeded".into());
        }
        *g = (total, g.1 + 1);
        Ok(Arc::new(Self(bytes)))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut g) = GLOBAL.lock() {
            g.0 -= self.0;
            g.1 -= 1;
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Range {
    offset: usize,
    length: usize,
}
impl Range {
    fn bytes<'a>(&self, p: &'a [u8]) -> Result<&'a [u8], String> {
        p.get(
            self.offset
                ..self
                    .offset
                    .checked_add(self.length)
                    .ok_or("JIZURA packet overflow")?,
        )
        .ok_or_else(|| "JIZURA packet range mismatch".into())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FontInput {
    font: Font,
    encoded: Range,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Prepare {
    request: Request,
    sequence: Range,
    fonts: Vec<FontInput>,
}
struct Session {
    request: Request,
    json: String,
    duration: u64,
    fonts: BTreeMap<String, Vec<u8>>,
    _lease: Arc<Lease>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub serial: u32,
    pub sequence_ticks: u64,
}
pub struct Owner {
    sessions: BTreeMap<u32, Session>,
    next: u32,
    serial: u32,
    pending: Option<(u32, u32)>,
    disposed: bool,
}
fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn admit(r: &Resource, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != r.byte_length() || hash(bytes) != r.sha256() {
        return Err("JIZURA actual attachment length/SHA mismatch".into());
    }
    Ok(())
}
fn strings(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(a) => {
            for v in a {
                strings(v, out);
            }
        }
        serde_json::Value::Object(a) => {
            for v in a.values() {
                strings(v, out);
            }
        }
        _ => {}
    }
}
impl Owner {
    pub fn new() -> Self {
        Self {
            sessions: BTreeMap::new(),
            next: 0,
            serial: 0,
            pending: None,
            disposed: false,
        }
    }
    pub fn prepare_with<F>(
        &mut self,
        metadata: &str,
        packet_length: usize,
        read: F,
    ) -> Result<u32, String>
    where
        F: FnOnce() -> Result<Vec<u8>, String>,
    {
        if self.disposed
            || self.pending.is_some()
            || self.sessions.len() >= MAX_OWNER_SESSIONS
            || metadata.len() > 65536
            || packet_length > 64 * 1024 * 1024
        {
            return Err("JIZURA preparation ingress/lifecycle limit exceeded".into());
        }
        let input: Prepare = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
        let rs = std::iter::once(input.request.sequence.clone())
            .chain(input.request.fonts.iter().map(|f| f.resource.clone()))
            .collect::<Vec<_>>();
        let mut unique = Vec::new();
        for r in &rs {
            if !unique.contains(r) {
                unique.push(r.clone());
            }
        }
        if !programmatic_resources::validate(&unique).is_empty()
            || input.request.sequence.kind != "analysis"
            || input.request.sequence.mime_type() != "application/json"
            || input.request.sequence.byte_length() > 2 * 1024 * 1024
            || input.request.fonts.is_empty()
            || input.request.fonts.len() > 16
            || input.fonts.len() != input.request.fonts.len()
        {
            return Err("JIZURA preparation resources invalid".into());
        }
        let expected = input.request.sequence.byte_length() * 12
            + input
                .request
                .fonts
                .iter()
                .map(|f| f.resource.byte_length() * 8)
                .sum::<u64>()
            + 64 * 1024 * 1024
            + 3 * crate::mv_recipe::jz::FRAME_BYTES;
        if expected != input.request.resident_bytes || expected > MAX_BYTES {
            return Err("JIZURA exact native reservation mismatch".into());
        }
        let lease = Lease::new(expected)?;
        let host = input
            .request
            .host
            .as_ref()
            .ok_or("JIZURA Rust graph host reservation required")?;
        if host.max_live_sessions == 0
            || host.max_live_sessions > MAX_OWNER_SESSIONS
            || !self.sessions.is_empty()
            || host.session_ceiling_bytes < expected
            || host.session_ceiling_bytes > MAX_BYTES
            || host.recipe_reservation_bytes > MAX_BYTES
            || expected > MAX_BYTES - host.recipe_reservation_bytes
            || host.raster_byte_limit < crate::mv_recipe::jz::FRAME_BYTES
        {
            return Err("JIZURA graph host/session residency mismatch".into());
        }
        let mut end = input.sequence.length;
        if input.sequence.offset != 0 {
            return Err("JIZURA packet must be exact ordered resources".into());
        }
        for font in &input.fonts {
            if font.encoded.offset != end {
                return Err("JIZURA packet ranges overlap or have gaps".into());
            }
            end = end
                .checked_add(font.encoded.length)
                .ok_or("JIZURA packet length overflow")?;
        }
        if end != packet_length {
            return Err("JIZURA packet has unreserved trailing bytes".into());
        }
        // Reserve before the WASM wrapper copies actual binary ingress.
        let packet = read()?;
        if packet.len() != packet_length {
            return Err("JIZURA packet changed during admission".into());
        }
        let sequence = input.sequence.bytes(&packet)?;
        admit(&input.request.sequence, sequence)?;
        let parsed = motion_text::validate_sequence_attachment(sequence)?;
        if input.request.source_start_ticks >= input.request.source_end_ticks
            || input.request.source_end_ticks > parsed.duration as u64
            || input.request.sequence_ticks < input.request.source_start_ticks
            || input.request.sequence_ticks >= input.request.source_end_ticks
        {
            return Err("JIZURA complete shot/source domain outside sequence".into());
        }
        let value: serde_json::Value =
            serde_json::from_slice(sequence).map_err(|e| e.to_string())?;
        let plan = parsed
            .resolved_plan
            .as_ref()
            .ok_or("JIZURA resolved plan missing")?;
        let font_refs = value["fonts"]
            .as_array()
            .ok_or("JIZURA font references missing")?;
        let mut ids = BTreeSet::new();
        let mut admitted_fonts = BTreeMap::new();
        for (bound, incoming) in input.request.fonts.iter().zip(&input.fonts) {
            if !ids.insert(bound.font_id.as_str())
                || bound.font_id != incoming.font.font_id
                || bound.resource != incoming.font.resource
            {
                return Err("JIZURA duplicate/mismatched physical font binding".into());
            }
            let refs = font_refs
                .iter()
                .filter(|r| r["id"].as_str() == Some(bound.font_id.as_str()))
                .collect::<Vec<_>>();
            if refs.len() != 1 {
                return Err("JIZURA sequence font identity missing/duplicated".into());
            }
            let mut texts = plan
                .cuts
                .iter()
                .filter(|c| {
                    c.font_id.as_ref().or(parsed.defaults.font_id.as_ref()) == Some(&bound.font_id)
                })
                .map(|c| c.text.clone())
                .collect::<Vec<_>>();
            texts.push((32u8..127).map(char::from).collect());
            strings(&value["defaults"]["parameters"], &mut texts);
            for cut in value["resolvedPlan"]["cuts"]
                .as_array()
                .ok_or("JIZURA cut array missing")?
            {
                let id = cut["fontId"]
                    .as_str()
                    .or(parsed.defaults.font_id.as_deref());
                if id == Some(bound.font_id.as_str()) {
                    strings(&cut["parameters"], &mut texts);
                }
            }
            let bytes = incoming.encoded.bytes(&packet)?;
            admit(&bound.resource, bytes)?;
            fonts::admit(&bound.resource, bytes, refs[0], &texts)?;
            admitted_fonts.insert(bound.font_id.clone(), bytes.to_vec());
        }
        let default_font = parsed
            .defaults
            .font_id
            .as_ref()
            .ok_or("JIZURA embedding forbids fallback fonts")?;
        if !ids.contains(default_font.as_str())
            || plan.cuts.iter().any(|c| {
                c.font_id
                    .as_ref()
                    .is_some_and(|id| !ids.contains(id.as_str()))
            })
        {
            return Err("JIZURA physical font binding incomplete".into());
        }
        if input.request.sequence_ticks >= parsed.duration as u64 {
            return Err("JIZURA source clock outside sequence".into());
        }
        self.next = self
            .next
            .checked_add(1)
            .ok_or("JIZURA session identity exhausted")?;
        self.sessions.insert(
            self.next,
            Session {
                request: input.request,
                json: std::str::from_utf8(sequence)
                    .map_err(|e| e.to_string())?
                    .into(),
                duration: parsed.duration as u64,
                fonts: admitted_fonts,
                _lease: lease,
            },
        );
        Ok(self.next)
    }
    pub fn prepared_json(&self, session: u32) -> Result<String, String> {
        let s = self
            .sessions
            .get(&session)
            .ok_or("Unknown/stale JIZURA session")?;
        serde_json::to_string(&serde_json::json!({"sequenceJson":s.json,"sequence":s.request.sequence,"fonts":s.request.fonts,"residentBytes":s.request.resident_bytes,"durationTicks":s.duration})).map_err(|e|e.to_string())
    }
    pub fn frame(&mut self, session: u32, request: &str) -> Result<String, String> {
        if self.disposed || self.pending.is_some() || request.len() > 32768 {
            return Err("JIZURA frame lifecycle/metadata limit exceeded".into());
        }
        let r: Request = serde_json::from_str(request).map_err(|e| e.to_string())?;
        let s = self
            .sessions
            .get(&session)
            .ok_or("Unknown/stale JIZURA session")?;
        if r.sequence != s.request.sequence
            || r.fonts.len() != s.request.fonts.len()
            || r.fonts
                .iter()
                .zip(&s.request.fonts)
                .any(|(a, b)| a.font_id != b.font_id || a.resource != b.resource)
            || r.resident_bytes != s.request.resident_bytes
            || r.host != s.request.host
            || r.source_start_ticks != s.request.source_start_ticks
            || r.source_end_ticks != s.request.source_end_ticks
            || r.sequence_ticks < s.request.source_start_ticks
            || r.sequence_ticks >= s.request.source_end_ticks
            || r.sequence_ticks >= s.duration
        {
            return Err("JIZURA frame content/clock binding mismatch".into());
        }
        self.serial = self
            .serial
            .checked_add(1)
            .ok_or("JIZURA frame serial exhausted")?;
        self.pending = Some((session, self.serial));
        serde_json::to_string(&Frame {
            serial: self.serial,
            sequence_ticks: r.sequence_ticks,
        })
        .map_err(|e| e.to_string())
    }
    pub fn finish_frame(&mut self, session: u32, serial: u32) -> Result<(), String> {
        if self.pending != Some((session, serial)) {
            return Err("Unknown/stale JIZURA native frame".into());
        }
        self.pending = None;
        Ok(())
    }
    pub fn check_text(&self, session: u32, font_id: &str, text: &str) -> Result<(), String> {
        if !self.pending.is_some_and(|p| p.0 == session) || text.chars().count() > 4096 {
            return Err("JIZURA glyph check requires bounded live native frame".into());
        }
        let s = self
            .sessions
            .get(&session)
            .ok_or("Unknown/stale JIZURA session")?;
        let bytes = s
            .fonts
            .get(font_id)
            .ok_or("JIZURA glyph font identity mismatch")?;
        let face = ttf_parser::Face::parse(bytes, 0).map_err(|_| "JIZURA physical font invalid")?;
        for c in text.chars().filter(|c| !c.is_whitespace()) {
            if face.glyph_index(c).is_none() {
                return Err(format!(
                    "JIZURA actual rendered glyph missing U+{:04X}",
                    c as u32
                ));
            }
        }
        Ok(())
    }
    pub fn release(&mut self, session: u32) -> Result<(), String> {
        if self.pending.is_some_and(|p| p.0 == session) {
            return Err("JIZURA native frame still alive".into());
        }
        self.sessions
            .remove(&session)
            .ok_or("Unknown/stale JIZURA session")?;
        Ok(())
    }
    pub fn dispose(&mut self) {
        self.pending = None;
        self.sessions.clear();
        self.disposed = true;
    }
}
impl Default for Owner {
    fn default() -> Self {
        Self::new()
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.dispose();
    }
}
