//! Encoded image admission before browser/native decode, with no raster allocation.
//! This proves static container geometry, not compressed-pixel validity or a
//! content digest. The caller must still verify digest and decoded dimensions.
//! PNG: https://www.w3.org/TR/png-3/
//! WebP: https://developers.google.com/speed/webp/docs/riff_container
mod jpeg;
mod png;
mod webp;

use super::LIMITS;
use bridge::export;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    mime_type: String,
    width: u32,
    height: u32,
}

/// One binary bridge argument: u32LE JSON-header byte length, UTF-8 JSON
/// {mimeType,width,height}, then the complete encoded PNG/JPEG/WebP body.
/// No base64 or JSON byte-array expansion and no decoded raster allocation.
#[export]
pub fn validate_image_sequence_image_bytes(input: Vec<u8>) -> String {
    let result = (|| -> Result<serde_json::Value, String> {
        if input.len() < 4 || input.len() as u64 > LIMITS.max_resource_bytes + 1028 {
            return Err("Invalid image sequence image admission envelope size".into());
        }
        let header_len = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
        if header_len == 0 || header_len > 1024 || header_len + 4 > input.len() {
            return Err("Invalid image sequence image admission header length".into());
        }
        let header: Header = serde_json::from_slice(&input[4..4 + header_len])
            .map_err(|e| format!("Invalid image sequence image admission header: {e}"))?;
        let body = &input[4 + header_len..];
        if body.is_empty() || body.len() as u64 > LIMITS.max_resource_bytes {
            return Err("Image sequence image body exceeds the encoded byte budget".into());
        }
        decoded_bytes(header.width, header.height)?;
        let (width, height) = inspect_encoded_image(&header.mime_type, body)?;
        let bytes = decoded_bytes(width, height)?;
        if width != header.width || height != header.height {
            return Err("Encoded image dimensions do not match the image sequence manifest".into());
        }
        Ok(serde_json::json!({"width":width,"height":height,"decodedBytes":bytes}))
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}

pub(crate) fn inspect_encoded_image(mime: &str, body: &[u8]) -> Result<(u32, u32), String> {
    if body.is_empty() || body.len() as u64 > LIMITS.max_resource_bytes {
        return Err("Image body exceeds the encoded byte budget".into());
    }
    match mime {
        "image/png" => png::dimensions(body),
        "image/jpeg" => jpeg::dimensions(body),
        "image/webp" => webp::dimensions(body),
        _ => Err("Unsupported image sequence image MIME type".into()),
    }
}

pub(crate) fn decoded_bytes(width: u32, height: u32) -> Result<u64, String> {
    let bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|v| v.checked_mul(4))
        .ok_or("Encoded image dimensions overflow")?;
    if width == 0
        || height == 0
        || width > LIMITS.max_dimension
        || height > LIMITS.max_dimension
        || bytes > LIMITS.max_decoded_bytes
    {
        return Err("Encoded image geometry exceeds the image sequence decode budget".into());
    }
    Ok(bytes)
}
