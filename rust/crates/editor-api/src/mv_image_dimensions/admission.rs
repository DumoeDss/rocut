use crate::image_sequence::{LIMITS, decoded_image_bytes, inspect_encoded_image};
use bridge::export;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    mime_type: String,
}

/// [u32LE JSON length][UTF-8 {mimeType}][complete static image body]. This
/// preallocation admission is not a decoded fact: the browser still decodes and
/// reports the actual orientation-aware ImageBitmap dimensions independently.
#[export]
pub fn inspect_programmatic_image_bytes(input: Vec<u8>) -> String {
    let result = (|| -> Result<serde_json::Value, String> {
        if input.len() < 4 || input.len() as u64 > LIMITS.max_resource_bytes + 1028 {
            return Err("Invalid programmatic image admission envelope size".into());
        }
        let length = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
        if length == 0 || length > 1024 || length + 4 > input.len() {
            return Err("Invalid programmatic image admission header length".into());
        }
        let header: Header = serde_json::from_slice(&input[4..4 + length])
            .map_err(|e| format!("Invalid programmatic image admission header: {e}"))?;
        let (width, height) = inspect_encoded_image(&header.mime_type, &input[4 + length..])?;
        let bytes = decoded_image_bytes(width, height)?;
        Ok(
            serde_json::json!({"width":width,"height":height,"decodedBytes":bytes,
            "limits":{"maxDimension":LIMITS.max_dimension,"maxDecodedBytes":LIMITS.max_decoded_bytes}}),
        )
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
