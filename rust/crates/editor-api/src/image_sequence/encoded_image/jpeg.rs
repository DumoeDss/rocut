fn be16(bytes: &[u8]) -> u16 {
    u16::from_be_bytes(bytes.try_into().unwrap())
}

/// Stop at the next real marker. FF00 is escaped entropy data; restart markers
/// remain inside the scan, and marker fill FF bytes do not become segment data.
fn scan_end(bytes: &[u8], mut offset: usize) -> Result<usize, String> {
    let mut data = false;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            data = true;
            continue;
        }
        let start = offset;
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset).ok_or("Truncated JPEG entropy marker")?;
        if marker == 0 {
            data = true;
            offset += 1;
        } else if (0xd0..=0xd7).contains(&marker) {
            offset += 1;
        } else if data {
            return Ok(start);
        } else {
            return Err("JPEG scan has no entropy data".into());
        }
    }
    Err("Truncated JPEG entropy data".into())
}

pub(super) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.get(..2) != Some(&[0xff, 0xd8]) {
        return Err("Invalid JPEG SOI".into());
    }
    let mut offset = 2usize;
    let mut geometry = None;
    let mut components = Vec::<u8>::new();
    let mut frame_kind = 0;
    let mut scans = 0u32;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return Err("Invalid JPEG marker boundary".into());
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset).ok_or("Truncated JPEG marker")?;
        offset += 1;
        if marker == 0xd9 {
            if offset != bytes.len() || scans == 0 {
                return Err("Invalid JPEG EOI or trailing bytes".into());
            }
            return geometry.ok_or("JPEG has no SOF dimensions".into());
        }
        if matches!(marker, 0xdc | 0xde | 0xdf) {
            return Err("Hierarchical or deferred-height JPEG is unsupported".into());
        }
        if !matches!(
            marker,
            0xc0 | 0xc1 | 0xc2 | 0xc4 | 0xda | 0xdb | 0xdd | 0xe0..=0xef | 0xfe
        ) {
            return Err("Unsupported JPEG frame or marker".into());
        }
        let length_bytes = bytes
            .get(offset..offset + 2)
            .ok_or("Truncated JPEG segment length")?;
        let length = usize::from(be16(length_bytes));
        if length < 2 {
            return Err("Invalid JPEG segment length".into());
        }
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated JPEG segment")?;
        let data = &bytes[offset + 2..end];
        match marker {
            0xc0..=0xc2 => {
                if geometry.is_some() || data.len() < 6 || data[0] != 8 {
                    return Err("Duplicate or unsupported JPEG SOF".into());
                }
                let count = usize::from(data[5]);
                if !(1..=4).contains(&count) || data.len() != 6 + 3 * count {
                    return Err("Invalid JPEG SOF component count".into());
                }
                for component in data[6..].chunks_exact(3) {
                    let h = component[1] >> 4;
                    let v = component[1] & 15;
                    if components.contains(&component[0])
                        || !(1..=4).contains(&h)
                        || !(1..=4).contains(&v)
                        || component[2] > 3
                    {
                        return Err("Invalid JPEG SOF component descriptor".into());
                    }
                    components.push(component[0]);
                }
                geometry = Some((u32::from(be16(&data[3..5])), u32::from(be16(&data[1..3]))));
                frame_kind = marker;
            }
            0xda => {
                if geometry.is_none() || data.is_empty() {
                    return Err("JPEG scan precedes SOF".into());
                }
                let count = usize::from(data[0]);
                if count == 0 || count > components.len() || data.len() != 1 + 2 * count + 3 {
                    return Err("Invalid JPEG scan header".into());
                }
                let mut scan_components = Vec::new();
                for component in data[1..1 + 2 * count].chunks_exact(2) {
                    if !components.contains(&component[0])
                        || scan_components.contains(&component[0])
                        || component[1] >> 4 > 3
                        || component[1] & 15 > 3
                    {
                        return Err("Invalid JPEG scan component".into());
                    }
                    scan_components.push(component[0]);
                }
                let tail = &data[1 + 2 * count..];
                if tail[0] > tail[1]
                    || tail[1] > 63
                    || tail[2] >> 4 > 13
                    || tail[2] & 15 > 13
                    || (frame_kind != 0xc2 && tail != [0, 63, 0])
                {
                    return Err("Invalid JPEG scan spectral selection".into());
                }
                scans += 1;
                offset = scan_end(bytes, end)?;
                continue;
            }
            0xdd if data.len() != 2 => return Err("Invalid JPEG restart interval".into()),
            _ => {}
        }
        offset = end;
    }
    Err("JPEG is missing EOI".into())
}
