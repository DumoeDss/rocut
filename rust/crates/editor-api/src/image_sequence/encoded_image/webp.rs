fn le32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap())
}
fn le24(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
}

fn vp8(data: &[u8]) -> Result<(u32, u32), String> {
    if data.len() < 10 || data[3..6] != [0x9d, 0x01, 0x2a] {
        return Err("Invalid WebP VP8 keyframe header".into());
    }
    let tag = le24(&data[..3]);
    let width = u16::from_le_bytes(data[6..8].try_into().unwrap());
    let height = u16::from_le_bytes(data[8..10].try_into().unwrap());
    if tag & 1 != 0
        || (tag >> 1) & 7 > 3
        || tag & 16 == 0
        || tag >> 5 == 0
        || (tag >> 5) as usize > data.len() - 10
        || width & 0xc000 != 0
        || height & 0xc000 != 0
    {
        return Err("Unsupported or truncated WebP VP8 frame".into());
    }
    Ok((u32::from(width), u32::from(height)))
}
fn vp8l(data: &[u8]) -> Result<(u32, u32), String> {
    if data.len() < 6 || data[0] != 0x2f {
        return Err("Invalid WebP VP8L header".into());
    }
    let bits = le32(&data[1..5]);
    if bits >> 29 != 0 {
        return Err("Unsupported WebP VP8L version".into());
    }
    Ok(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
}

pub(super) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 12
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
        || u64::from(le32(&bytes[4..8])) + 8 != bytes.len() as u64
    {
        return Err("Invalid WebP RIFF signature or exact size".into());
    }
    let mut offset = 12usize;
    let mut canvas = None;
    let mut bitstream = None;
    let mut flags = 0u8;
    let mut alpha = false;
    let mut icc = false;
    let mut exif = false;
    let mut xmp = false;
    while offset < bytes.len() {
        if bytes.len() - offset < 8 {
            return Err("Truncated WebP chunk header".into());
        }
        let kind = &bytes[offset..offset + 4];
        let length = le32(&bytes[offset + 4..offset + 8]) as usize;
        let payload_end = offset
            .checked_add(8)
            .and_then(|v| v.checked_add(length))
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated WebP chunk body")?;
        let end = payload_end
            .checked_add(length & 1)
            .filter(|end| *end <= bytes.len())
            .ok_or("Missing WebP RIFF padding")?;
        if length & 1 != 0 && bytes[payload_end] != 0 {
            return Err("Invalid WebP RIFF padding".into());
        }
        let data = &bytes[offset + 8..payload_end];
        match kind {
            b"VP8X" => {
                if offset != 12 || canvas.is_some() || length != 10 {
                    return Err("Duplicate or invalid WebP VP8X".into());
                }
                flags = data[0];
                if flags & 0xc1 != 0 || data[1..4] != [0, 0, 0] {
                    return Err("Invalid WebP VP8X reserved bits".into());
                }
                if flags & 2 != 0 {
                    return Err("Animated WebP is not an image sequence frame".into());
                }
                canvas = Some((le24(&data[4..7]) + 1, le24(&data[7..10]) + 1));
            }
            b"ANIM" | b"ANMF" => return Err("Animated WebP is not an image sequence frame".into()),
            b"VP8 " | b"VP8L" => {
                if bitstream.is_some() {
                    return Err("Duplicate WebP image bitstream".into());
                }
                if kind == b"VP8L" && alpha {
                    return Err("WebP ALPH cannot accompany VP8L".into());
                }
                let actual = if kind == b"VP8 " {
                    vp8(data)?
                } else {
                    vp8l(data)?
                };
                if canvas.is_some_and(|declared| declared != actual) {
                    return Err("WebP canvas and bitstream dimensions disagree".into());
                }
                bitstream = Some(actual);
            }
            b"ALPH" => {
                if canvas.is_none()
                    || flags & 16 == 0
                    || alpha
                    || bitstream.is_some()
                    || data.is_empty()
                    || data[0] & 0xc0 != 0
                    || data[0] & 3 > 1
                    || (data[0] >> 4) & 3 > 1
                {
                    return Err("Invalid WebP alpha chunk".into());
                }
                let (w, h) = canvas.unwrap();
                if data[0] & 3 == 0 && data.len() as u64 != 1 + u64::from(w) * u64::from(h) {
                    return Err("Truncated WebP uncompressed alpha plane".into());
                }
                alpha = true;
            }
            b"ICCP" => {
                if canvas.is_none()
                    || flags & 32 == 0
                    || icc
                    || alpha
                    || bitstream.is_some()
                    || data.is_empty()
                {
                    return Err("Invalid WebP ICC chunk".into());
                }
                icc = true;
            }
            b"EXIF" => {
                if canvas.is_none() || flags & 8 == 0 || exif || data.is_empty() {
                    return Err("Invalid WebP Exif chunk".into());
                }
                exif = true;
            }
            b"XMP " => {
                if canvas.is_none() || flags & 4 == 0 || xmp || data.is_empty() {
                    return Err("Invalid WebP XMP chunk".into());
                }
                xmp = true;
            }
            _ => {}
        }
        offset = end;
    }
    if (flags & 32 != 0) != icc || (flags & 8 != 0) != exif || (flags & 4 != 0) != xmp {
        return Err("WebP metadata flags disagree with chunks".into());
    }
    bitstream.ok_or("WebP is missing a static image bitstream".into())
}
