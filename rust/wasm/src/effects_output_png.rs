//! Bounded lossless RGBA8 PNG output. Uses the repository's stored-DEFLATE PNG
//! representation; no Canvas, premultiplication, JS codec, or new dependency.
pub(crate) const MAX_OUTPUT_PEAK: u64 = 64 * 1024 * 1024;
// Independent full-frame output + resident GPU policy, not a process RSS cap.
pub(crate) const MAX_FRAME_OUTPUT_PEAK: u64 = 1024 * 1024 * 1024;
pub(crate) struct OutputBudget {
    pub(crate) rgba_bytes: usize,
    pub(crate) png_bytes: usize,
    pub(crate) peak_bytes: u64,
    limit_bytes: u64,
}
impl OutputBudget {
    pub(crate) fn with_resident_bytes(mut self, bytes: u64) -> Result<Self, &'static str> {
        self.peak_bytes = self
            .peak_bytes
            .checked_add(bytes)
            .ok_or("Native frame output resident memory overflow.")?;
        if self.peak_bytes > self.limit_bytes {
            return Err(
                "Native frame PNG exceeds the 1GiB output and compositor residency budget.",
            );
        }
        Ok(self)
    }
    pub(crate) fn new(width: u32, height: u32, padded_bytes: u64) -> Result<Self, &'static str> {
        Self::with_limit(width, height, padded_bytes, MAX_OUTPUT_PEAK)
    }
    pub(crate) fn for_frame(
        width: u32,
        height: u32,
        padded_bytes: u64,
    ) -> Result<Self, &'static str> {
        Self::with_limit(width, height, padded_bytes, MAX_FRAME_OUTPUT_PEAK)
    }
    fn with_limit(
        width: u32,
        height: u32,
        padded_bytes: u64,
        limit_bytes: u64,
    ) -> Result<Self, &'static str> {
        if width == 0 || height == 0 {
            return Err("Native output dimensions must be nonzero.");
        }
        let rgba = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|n| n.checked_mul(4))
            .ok_or("Native output dimensions overflow.")?;
        let filtered = rgba
            .checked_add(u64::from(height))
            .ok_or("PNG scanline size overflow.")?;
        let blocks = filtered
            .checked_add(65534)
            .ok_or("PNG block size overflow.")?
            / 65535;
        let png = filtered
            .checked_add(blocks.checked_mul(5).ok_or("PNG block size overflow.")?)
            .and_then(|n| n.checked_add(76))
            .ok_or("PNG output size overflow.")?;
        // Conservative joint charge: caller source/display canvas backing, import
        // CPU/JS pixels and GPU input/output/scratch; mapped/staging copies;
        // native PNG plus JS boundary and consumer Blob copies. The encoder below
        // streams rows directly to one PNG allocation (no filtered/zlib vectors).
        let peak = rgba
            .checked_mul(8)
            .and_then(|n| n.checked_add(padded_bytes.checked_mul(2)?))
            .and_then(|n| n.checked_add(png.checked_mul(3)?))
            .ok_or("Native output peak size overflow.")?;
        if peak > limit_bytes {
            return Err(if limit_bytes == MAX_OUTPUT_PEAK {
                "Native Blaze output exceeds the64MiB joint peak budget."
            } else {
                "Native frame PNG exceeds the 1GiB output budget."
            });
        }
        Ok(Self {
            rgba_bytes: usize::try_from(rgba).map_err(|_| "RGBA size overflow")?,
            png_bytes: usize::try_from(png).map_err(|_| "PNG size overflow")?,
            peak_bytes: peak,
            limit_bytes,
        })
    }
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 == 1 { 0xedb88320 } else { 0 };
        }
    }
    !crc
}
fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(bytes);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}
pub(crate) fn encode(
    width: u32,
    height: u32,
    rgba: &[u8],
    budget: &OutputBudget,
) -> Result<Vec<u8>, &'static str> {
    if rgba.len() != budget.rgba_bytes
        || u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|n| n.checked_mul(4))
            != Some(rgba.len() as u64)
    {
        return Err("Native PNG pixel length mismatch.");
    }
    let mut out = Vec::new();
    out.try_reserve_exact(budget.png_bytes)
        .map_err(|_| "Cannot allocate native PNG")?;
    out.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut ihdr = [0u8; 13];
    ihdr[..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"sRGB", &[0]);
    let row = width as usize * 4;
    let filtered = rgba.len() + height as usize;
    let blocks = filtered.div_ceil(65535);
    let zlib_len = filtered + blocks * 5 + 6;
    out.extend_from_slice(&(zlib_len as u32).to_be_bytes());
    let crc_start = out.len();
    out.extend_from_slice(b"IDAT");
    out.extend_from_slice(&[0x78, 0x01]);
    let (mut a, mut b) = (1u32, 0u32);
    let mut offset = 0usize;
    while offset < filtered {
        let len = (filtered - offset).min(65535);
        out.push(u8::from(offset + len == filtered));
        out.extend_from_slice(&(len as u16).to_le_bytes());
        out.extend_from_slice(&(!(len as u16)).to_le_bytes());
        for index in offset..offset + len {
            let line = index / (row + 1);
            let column = index % (row + 1);
            let byte = if column == 0 {
                0
            } else {
                rgba[line * row + column - 1]
            };
            out.push(byte);
            a = (a + u32::from(byte)) % 65521;
            b = (b + a) % 65521;
        }
        offset += len;
    }
    out.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let crc = crc32(&out[crc_start..]);
    out.extend_from_slice(&crc.to_be_bytes());
    chunk(&mut out, b"IEND", &[]);
    if out.len() != budget.png_bytes {
        return Err("Native PNG allocation contract mismatch.");
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_frame_policy_admits_normal_sizes_and_bounds_residency() {
        for (width, height) in [(1280, 720), (1920, 1080), (3840, 2160)] {
            let rgba = u64::from(width) * u64::from(height) * 4;
            let budget = OutputBudget::for_frame(width, height, rgba).unwrap();
            assert!(budget.with_resident_bytes(rgba * 6).is_ok());
            assert!(
                OutputBudget::for_frame(width, height, rgba)
                    .unwrap()
                    .with_resident_bytes(MAX_FRAME_OUTPUT_PEAK)
                    .is_err()
            );
        }
        assert!(OutputBudget::new(1920, 1080, 8294400).is_err());
    }
    #[test]
    fn rgba_hidden_rgb_alpha_and_srgb_are_unchanged() {
        let pixels = [134, 0, 32, 41, 50, 150, 250, 0];
        let budget = OutputBudget::new(2, 1, 256).unwrap();
        let png = encode(2, 1, &pixels, &budget).unwrap();
        assert_eq!(png.len(), budget.png_bytes);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let mut offset = 8;
        while offset < png.len() {
            let len = u32::from_be_bytes(png[offset..offset + 4].try_into().unwrap()) as usize;
            let kind = &png[offset + 4..offset + 8];
            assert_eq!(
                crc32(&png[offset + 4..offset + 8 + len]),
                u32::from_be_bytes(png[offset + 8 + len..offset + 12 + len].try_into().unwrap())
            );
            if kind == b"IDAT" {
                assert_eq!(
                    &png[offset + 8 + 7..offset + 8 + 7 + 9],
                    &[0, 134, 0, 32, 41, 50, 150, 250, 0]
                );
            }
            offset += len + 12;
        }
    }
    #[test]
    fn joint_budget_not_only_staging_and_preflight_length() {
        let small = OutputBudget::new(96, 256, 98304).unwrap();
        assert!(small.peak_bytes < MAX_OUTPUT_PEAK);
        assert!(OutputBudget::new(1920, 1080, 8294400).is_err());
        assert!(OutputBudget::new(0, 1, 256).is_err());
        assert!(OutputBudget::new(u32::MAX, u32::MAX, u64::MAX).is_err());
        assert!(encode(96, 256, &[0; 4], &small).is_err());
    }
    #[test]
    fn multiple_deflate_blocks_preserve_every_row_and_adler_checksum() {
        let (width, height) = (93u32, 255u32);
        let pixels: Vec<u8> = (0..width * height * 4).map(|i| (i % 251) as u8).collect();
        let budget = OutputBudget::new(width, height, 512 * u64::from(height)).unwrap();
        let png = encode(width, height, &pixels, &budget).unwrap();
        let mut offset = 8;
        let mut found = false;
        while offset < png.len() {
            let len = u32::from_be_bytes(png[offset..offset + 4].try_into().unwrap()) as usize;
            if &png[offset + 4..offset + 8] == b"IDAT" {
                found = true;
                let body = &png[offset + 8..offset + 8 + len];
                assert_eq!(&body[..2], &[0x78, 1]);
                let mut index = 2;
                let mut rows = Vec::new();
                loop {
                    let final_block = body[index];
                    assert!(final_block <= 1);
                    let length = u16::from_le_bytes(body[index + 1..index + 3].try_into().unwrap());
                    assert_eq!(
                        !length,
                        u16::from_le_bytes(body[index + 3..index + 5].try_into().unwrap())
                    );
                    index += 5;
                    rows.extend_from_slice(&body[index..index + length as usize]);
                    index += length as usize;
                    if final_block == 1 {
                        break;
                    }
                }
                assert_eq!(index + 4, body.len());
                let (mut a, mut b) = (1u32, 0u32);
                for &byte in &rows {
                    a = (a + u32::from(byte)) % 65521;
                    b = (b + a) % 65521;
                }
                assert_eq!(
                    (b << 16) | a,
                    u32::from_be_bytes(body[index..].try_into().unwrap())
                );
                let mut decoded = Vec::new();
                for row in rows.chunks_exact(width as usize * 4 + 1) {
                    assert_eq!(row[0], 0);
                    decoded.extend_from_slice(&row[1..]);
                }
                assert_eq!(decoded, pixels);
            }
            offset += len + 12;
        }
        assert!(found);
    }
}
