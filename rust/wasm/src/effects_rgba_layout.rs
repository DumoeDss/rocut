#[derive(Debug)]
pub(crate) struct RgbaUploadLayout {
    pub(crate) row_bytes: u32,
}

impl RgbaUploadLayout {
    pub(crate) fn new(width: u32, height: u32, byte_length: u64) -> Result<Self, &'static str> {
        if width == 0 || height == 0 {
            return Err("Diagnostic RGBA dimensions must be nonzero.");
        }
        let row_bytes = width
            .checked_mul(4)
            .ok_or("RGBA upload row size overflow.")?;
        let expected = u64::from(row_bytes)
            .checked_mul(u64::from(height))
            .ok_or("RGBA upload byte size overflow.")?;
        if byte_length != expected {
            return Err("Diagnostic RGBA byte length must equal exactly 4 * width * height.");
        }
        Ok(Self { row_bytes })
    }
}

// Transport conversion only: alpha and hidden RGB are never canonicalized.
pub(crate) fn encode_upload_channels(bytes: &mut [u8], bgra: bool) {
    if bgra {
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
}

#[cfg(test)]
#[path = "effects_rgba_layout_tests.rs"]
mod tests;
