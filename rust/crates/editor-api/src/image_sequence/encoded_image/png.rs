const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const CRC_TABLE: [u32; 256] = crc_table();

const fn crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut index = 0;
    while index < 256 {
        let mut crc = index as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb88320
            } else {
                crc >> 1
            };
            bit += 1;
        }
        table[index] = crc;
        index += 1;
    }
    table
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc = (crc >> 8) ^ CRC_TABLE[((crc ^ u32::from(*byte)) & 255) as usize];
    }
    !crc
}
fn be32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes(bytes.try_into().unwrap())
}

pub(super) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.get(..8) != Some(SIGNATURE.as_slice()) {
        return Err("Invalid PNG signature".into());
    }
    let mut offset = 8usize;
    let mut geometry = None;
    let mut color = 0;
    let mut palette = false;
    let mut image_data = false;
    let mut image_data_ended = false;
    while offset < bytes.len() {
        if bytes.len() - offset < 12 {
            return Err("Truncated PNG chunk header".into());
        }
        let length = be32(&bytes[offset..offset + 4]) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|v| v.checked_add(length))
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated PNG chunk body")?;
        let kind = &bytes[offset + 4..offset + 8];
        if !kind.iter().all(u8::is_ascii_alphabetic) || !kind[2].is_ascii_uppercase() {
            return Err("Invalid PNG chunk type".into());
        }
        let data = &bytes[offset + 8..end - 4];
        if crc32(&bytes[offset + 4..end - 4]) != be32(&bytes[end - 4..end]) {
            return Err("PNG chunk CRC mismatch".into());
        }
        if offset == 8 && kind != b"IHDR" {
            return Err("PNG must start with IHDR".into());
        }
        if image_data && kind != b"IDAT" {
            image_data_ended = true;
        }
        match kind {
            b"IHDR" => {
                if geometry.is_some() || length != 13 {
                    return Err("Duplicate or invalid PNG IHDR".into());
                }
                color = data[9];
                let valid_depth = match color {
                    0 => matches!(data[8], 1 | 2 | 4 | 8 | 16),
                    2 | 4 | 6 => matches!(data[8], 8 | 16),
                    3 => matches!(data[8], 1 | 2 | 4 | 8),
                    _ => false,
                };
                if !valid_depth || data[10] != 0 || data[11] != 0 || data[12] > 1 {
                    return Err("Invalid PNG IHDR encoding".into());
                }
                geometry = Some((be32(&data[..4]), be32(&data[4..8])));
            }
            b"PLTE" => {
                if palette
                    || image_data
                    || matches!(color, 0 | 4)
                    || length == 0
                    || length > 768
                    || length % 3 != 0
                {
                    return Err("Invalid PNG palette".into());
                }
                palette = true;
            }
            b"IDAT" => {
                if image_data_ended || (color == 3 && !palette) {
                    return Err("Invalid PNG image-data ordering".into());
                }
                image_data = true;
            }
            b"IEND" => {
                if length != 0 || !image_data || end != bytes.len() {
                    return Err("Invalid or incomplete PNG IEND".into());
                }
                return geometry.ok_or("PNG has no IHDR".into());
            }
            b"acTL" | b"fcTL" | b"fdAT" => {
                return Err("Animated PNG is not an image sequence frame".into());
            }
            _ if kind[0].is_ascii_uppercase() => {
                return Err("Unsupported critical PNG chunk".into());
            }
            _ => {}
        }
        offset = end;
    }
    Err("PNG is missing a complete IEND".into())
}
