use super::Animation;

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> Option<&'a [u8]> {
    let end = cursor.checked_add(length)?;
    let result = bytes.get(*cursor..end)?;
    *cursor = end;
    Some(result)
}
fn byte(bytes: &[u8], cursor: &mut usize) -> Option<u8> {
    Some(take(bytes, cursor, 1)?[0])
}
fn word(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}
fn palette(bytes: &[u8], cursor: &mut usize, packed: u8) -> Option<u16> {
    if packed & 0x80 == 0 {
        return Some(0);
    }
    let colors = 1_u16 << ((packed & 7) + 1);
    take(bytes, cursor, usize::from(colors) * 3)?;
    Some(colors)
}
fn sub_blocks(bytes: &[u8], cursor: &mut usize) -> Option<()> {
    loop {
        let length = byte(bytes, cursor)?;
        if length == 0 {
            return Some(());
        }
        take(bytes, cursor, usize::from(length))?;
    }
}

/// Complete encoded container inspection; compressed pixels are not decoded.
pub(super) fn inspect(bytes: &[u8]) -> Option<(Animation, bool)> {
    let mut cursor = 0;
    if !matches!(take(bytes, &mut cursor, 6)?, b"GIF87a" | b"GIF89a") {
        return None;
    }
    let screen = take(bytes, &mut cursor, 7)?;
    let width = word(screen);
    let height = word(&screen[2..]);
    if width == 0 || height == 0 {
        return None;
    }
    let global_colors = palette(bytes, &mut cursor, screen[4])?;
    let mut pending: Option<(u16, Option<u8>)> = None;
    let mut frame_count = 0_u64;
    let mut duration_cs = 0_u64;
    let mut loop_count = None;
    let mut alpha = false;
    loop {
        match byte(bytes, &mut cursor)? {
            0x3b => {
                if cursor != bytes.len() || frame_count == 0 || pending.is_some() {
                    return None;
                }
                return Some((
                    Animation {
                        frame_count,
                        loop_count,
                        duration_ticks: Some(duration_cs.checked_mul(1200)?),
                    },
                    alpha,
                ));
            }
            0x2c => {
                let image = take(bytes, &mut cursor, 9)?;
                let w = word(&image[4..]);
                let h = word(&image[6..]);
                if w == 0
                    || h == 0
                    || u32::from(word(image)) + u32::from(w) > u32::from(width)
                    || u32::from(word(&image[2..])) + u32::from(h) > u32::from(height)
                    || image[8] & 0x18 != 0
                {
                    return None;
                }
                let local_colors = palette(bytes, &mut cursor, image[8])?;
                let colors = if local_colors > 0 {
                    local_colors
                } else {
                    global_colors
                };
                if colors == 0 {
                    return None;
                }
                let (delay, transparent) = pending.take().unwrap_or((0, None));
                if transparent.is_some_and(|index| u16::from(index) >= colors) {
                    return None;
                }
                alpha |= transparent.is_some();
                if !(2..=8).contains(&byte(bytes, &mut cursor)?) {
                    return None;
                }
                // At least one image-data sub-block must precede its terminator.
                let length = byte(bytes, &mut cursor)?;
                if length == 0 {
                    return None;
                }
                take(bytes, &mut cursor, usize::from(length))?;
                sub_blocks(bytes, &mut cursor)?;
                frame_count += 1;
                if frame_count > 100_000 {
                    return None;
                }
                duration_cs = duration_cs.checked_add(u64::from(delay))?;
            }
            0x21 => match byte(bytes, &mut cursor)? {
                0xf9 => {
                    if pending.is_some() || byte(bytes, &mut cursor)? != 4 {
                        return None;
                    }
                    let control = take(bytes, &mut cursor, 4)?;
                    if control[0] & 0xe0 != 0
                        || (control[0] >> 2) & 7 > 3
                        || byte(bytes, &mut cursor)? != 0
                    {
                        return None;
                    }
                    pending = Some((
                        word(&control[1..]),
                        (control[0] & 1 != 0).then_some(control[3]),
                    ));
                }
                0xff => {
                    if byte(bytes, &mut cursor)? != 11 {
                        return None;
                    }
                    let app = take(bytes, &mut cursor, 11)?;
                    if matches!(app, b"NETSCAPE2.0" | b"ANIMEXTS1.0") {
                        if loop_count.is_some() || byte(bytes, &mut cursor)? != 3 {
                            return None;
                        }
                        let data = take(bytes, &mut cursor, 3)?;
                        if data[0] != 1 || byte(bytes, &mut cursor)? != 0 {
                            return None;
                        }
                        loop_count = Some(u64::from(word(&data[1..])));
                    } else {
                        sub_blocks(bytes, &mut cursor)?;
                    }
                }
                0xfe => sub_blocks(bytes, &mut cursor)?,
                // Plain-text graphics and unknown extensions cannot be silently
                // omitted from a complete animation timing/count claim.
                _ => return None,
            },
            _ => return None,
        }
    }
}
