//! Portable external image sequences. Rust owns bounded declarations and exact
//! frame selection; IO hosts own byte/hash validation, storage and decoding.
mod encoded_image;
mod frame;
mod model;
mod validate;
use bridge::export;
pub use encoded_image::validate_image_sequence_image_bytes;
pub(crate) use encoded_image::{decoded_bytes as decoded_image_bytes, inspect_encoded_image};
pub use frame::Context;
pub use model::{
    FrameLimits, LIMITS, MAX_SAFE, MIME, Manifest, ManifestInput, Rate, SequenceImage, frame_limits,
};

#[export]
pub fn validate_image_sequence_manifest_json(input: String) -> String {
    let result = (|| -> Result<serde_json::Value, String> {
        if input.len() as u64 > LIMITS.max_manifest_bytes {
            return Err("Image sequence manifest exceeds byte budget".into());
        }
        let manifest: Manifest = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        let dependencies = manifest.validate()?;
        let bytes = dependencies
            .iter()
            .try_fold(input.len() as u64, |total, r| {
                total
                    .checked_add(r.byte_length())
                    .ok_or("Image sequence closure size overflow")
            })?;
        if bytes > LIMITS.max_closure_bytes {
            return Err("Image sequence closure exceeds byte budget".into());
        }
        Ok(serde_json::json!({"manifest":manifest,"dependencies":dependencies,"limits":LIMITS}))
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
