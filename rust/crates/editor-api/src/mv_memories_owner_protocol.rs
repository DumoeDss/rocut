//! Owner-private metadata; pixels and physical fonts never enter JSON.
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Input {
    pub args: super::memories::model::Args,
    pub resources: Vec<Resource>,
    pub images: Vec<Image>,
    pub fonts: Vec<Font>,
    pub ceiling_bytes: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Image {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
    pub rgba_sha256: String,
    pub encoded: Range,
    pub decoded: Range,
    pub decoder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Font {
    pub resource: Resource,
    pub encoded: Range,
    pub font_size: f64,
    pub weight: u32,
    pub widths: BTreeMap<String, f64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Range {
    pub offset: usize,
    pub length: usize,
}
impl Range {
    pub fn bytes<'a>(&self, packet: &'a [u8]) -> Result<&'a [u8], String> {
        packet
            .get(
                self.offset
                    ..self
                        .offset
                        .checked_add(self.length)
                        .ok_or("Memories range overflow")?,
            )
            .ok_or_else(|| "Memories packet range mismatch".into())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FrameInput {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: Vec<u64>,
    pub bpm: f64,
    pub downbeat_index: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadbackBinding {
    pub plan_sha256: String,
    pub rgba_sha256: String,
    pub width: u32,
    pub height: u32,
    pub decoder: String,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub owner_id: u32,
    pub session_id: u32,
}
pub(super) fn parse<T: serde::de::DeserializeOwned>(input: &str) -> Result<T, String> {
    if input.len() > 128 * 1024 {
        return Err("Memories owner input exceeds limit".into());
    }
    serde_json::from_str(input).map_err(|e| e.to_string())
}
pub(super) fn json<T: Serialize>(value: &T) -> Result<String, String> {
    let out = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if out.len() > 16 * 1024 * 1024 {
        return Err("Memories owner output exceeds limit".into());
    }
    Ok(out)
}
pub(super) fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) const DECODER: &str = "canvas2d-srgb-unpremultiplied-rgba8-v1";
