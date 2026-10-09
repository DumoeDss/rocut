//! Content-bound Heart raster identities. These are transient session facts,
//! never ordinary authored resources or filesystem/URL image references.
use crate::programmatic_resources::{self, Resource};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const ALGORITHM: &str = "heart-components-v1";
pub const DECODER: &str = "canvas2d-srgb-unpremultiplied-rgba8-v1";

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub source: Resource,
    pub decoded_width: u32,
    pub decoded_height: u32,
    pub decoded_rgba_sha256: String,
    pub decoder: String,
    pub algorithm: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Part {
    Body,
    Chip { label: u32 },
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedImage {
    pub binding: Binding,
    pub part: Part,
    pub width: u32,
    pub height: u32,
    pub rgba_sha256: String,
}

fn digest(rgba: &[u8]) -> String {
    format!("{:x}", Sha256::digest(rgba))
}
fn pixel_length(width: u32, height: u32) -> Result<usize, String> {
    let bytes = crate::image_sequence::decoded_image_bytes(width, height)?;
    usize::try_from(bytes).map_err(|_| "Heart pixel byte length overflow".into())
}
impl Binding {
    pub fn validate_source(&self, rgba: &[u8]) -> Result<(), String> {
        if let Some(issue) =
            programmatic_resources::validate(std::slice::from_ref(&self.source)).first()
        {
            return Err(issue.message.clone());
        }
        if self.source.kind != "image" || self.algorithm != ALGORITHM || self.decoder != DECODER {
            return Err("Invalid Heart preparation binding".into());
        }
        if rgba.len() != pixel_length(self.decoded_width, self.decoded_height)?
            || self.decoded_rgba_sha256 != digest(rgba)
        {
            return Err("Heart decoded source identity mismatch".into());
        }
        Ok(())
    }
    /// Call only after source validation and original Rust component preparation.
    pub fn image(
        &self,
        part: Part,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<PreparedImage, String> {
        if rgba.len() != pixel_length(width, height)? {
            return Err("Heart derived image dimensions mismatch".into());
        }
        Ok(PreparedImage {
            binding: self.clone(),
            part,
            width,
            height,
            rgba_sha256: digest(rgba),
        })
    }
}
impl PreparedImage {
    pub fn key(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| e.to_string())
    }
    /// Session admission compares the entire expected Rust-derived identity, then hashes bytes.
    pub fn validate_rgba(&self, expected: &Self, rgba: &[u8]) -> Result<(), String> {
        if self != expected
            || rgba.len() != pixel_length(self.width, self.height)?
            || digest(rgba) != self.rgba_sha256
        {
            return Err("Heart prepared image identity mismatch".into());
        }
        Ok(())
    }
}
