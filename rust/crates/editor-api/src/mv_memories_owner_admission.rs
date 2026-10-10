use super::{fonts, memories, protocol::*};
use std::collections::BTreeSet;
pub(super) fn metadata(i: &Input, encoded: usize, decoded: usize) -> Result<u64, String> {
    if let Some(issue) = crate::programmatic_resources::validate(&i.resources).first() {
        return Err(issue.message.clone());
    }
    if i.images.len() > 17
        || i.fonts.len() != 2
        || encoded > 64 * 1024 * 1024
        || decoded > 128 * 1024 * 1024
    {
        return Err("Memories binary admission limits exceeded".into());
    }
    let mut e = 0usize;
    let mut d = 0usize;
    let mut seen = BTreeSet::new();
    for n in &i.images {
        let bytes = crate::image_sequence::decoded_image_bytes(n.width, n.height)?;
        if !seen.insert(n.resource.id.clone())
            || n.resource.kind != "image"
            || n.decoder != DECODER
            || n.encoded.offset != e
            || n.decoded.offset != d
            || n.encoded.length as u64 != n.resource.byte_length()
            || n.decoded.length as u64 != bytes
        {
            return Err("Memories source binary layout mismatch".into());
        }
        e = e
            .checked_add(n.encoded.length)
            .ok_or("Memories packet overflow")?;
        d = d
            .checked_add(n.decoded.length)
            .ok_or("Memories packet overflow")?;
    }
    for f in &i.fonts {
        if !seen.insert(f.resource.id.clone())
            || f.encoded.offset != e
            || f.encoded.length as u64 != f.resource.byte_length()
        {
            return Err("Memories font binary layout mismatch".into());
        }
        e = e
            .checked_add(f.encoded.length)
            .ok_or("Memories font overflow")?;
    }
    if e != encoded || d != decoded {
        return Err("Memories binary packets incomplete".into());
    }
    // Frozen leaf already charges one encoded and two decoded/native copies.
    // Add packet snapshots + WASM ingress + source upload + font native backing.
    (encoded as u64)
        .checked_mul(3)
        .and_then(|v| v.checked_add(decoded as u64 * 3))
        .and_then(|v| v.checked_add(4 * 1024 * 1024))
        .ok_or_else(|| "Memories transport budget overflow".into())
}
pub(super) fn facts(
    i: &Input,
    encoded: &[u8],
    rgba: &[u8],
) -> Result<memories::NativeFacts, String> {
    let requests = memories::admission::measurement_requests(&i.args)?;
    let mut images = Vec::new();
    for n in &i.images {
        let bytes = n.encoded.bytes(encoded)?;
        if hash(bytes) != n.resource.sha256()
            || crate::image_sequence::inspect_encoded_image(n.resource.mime_type(), bytes)?
                != (n.width, n.height)
            || hash(n.decoded.bytes(rgba)?) != n.rgba_sha256
        {
            return Err("Memories actual source bytes/dimensions/RGBA binding mismatch".into());
        }
        images.push(memories::ImageFact {
            resource: n.resource.clone(),
            width: n.width,
            height: n.height,
        });
    }
    let mut measured = Vec::new();
    for request in requests {
        let f = i
            .fonts
            .iter()
            .find(|f| f.resource.id == request.font)
            .ok_or("Memories native font role missing")?;
        if f.font_size != request.font_size
            || f.weight != request.weight
            || f.widths.len() != request.texts.len()
            || request.texts.iter().any(|t| !f.widths.contains_key(t))
        {
            return Err("Memories native measurement request mismatch".into());
        }
        fonts::admit(f, f.encoded.bytes(encoded)?, &request.texts)?;
        measured.push(memories::FontFact {
            resource: f.resource.clone(),
            size: f.font_size,
            weight: f.weight,
            widths: f.widths.clone(),
        });
    }
    let date = measured.pop().ok_or("Memories date fact missing")?;
    let caption = measured.pop().ok_or("Memories caption fact missing")?;
    Ok(memories::NativeFacts {
        images,
        caption,
        date,
    })
}
