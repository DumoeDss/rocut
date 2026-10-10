//! Byte admission and cmap coverage, before accepting any native font metrics.
use super::protocol::{hash, Font};
use serde::Deserialize;
use std::collections::BTreeMap;
use ttf_parser::{name_id, Face, Tag};
#[derive(Deserialize)]
struct Descriptor {
    family: String,
    style: String,
    weight: u16,
    #[serde(default)]
    axes: BTreeMap<String, f64>,
}
pub(super) fn admit(font: &Font, bytes: &[u8], texts: &[String]) -> Result<(), String> {
    let r = &font.resource;
    if r.kind != "font"
        || bytes.len() as u64 != r.byte_length()
        || hash(bytes) != r.sha256()
        || !matches!(
            (r.mime_type(), bytes.get(..4)),
            ("font/ttf", Some([0, 1, 0, 0])) | ("font/otf", Some(b"OTTO"))
        )
    {
        return Err("Memories actual SFNT bytes/MIME/SHA mismatch".into());
    }
    let d: Descriptor =
        serde_json::from_value(serde_json::to_value(r).map_err(|e| e.to_string())?["font"].clone())
            .map_err(|e| e.to_string())?;
    let mut face = Face::parse(bytes, 0).map_err(|_| "Memories invalid SFNT")?;
    if d.style != "normal"
        || u32::from(d.weight) != font.weight
        || face.is_italic()
        || !face.names().into_iter().any(|n| {
            matches!(n.name_id, name_id::FAMILY | name_id::TYPOGRAPHIC_FAMILY)
                && n.to_string().as_deref() == Some(d.family.as_str())
        })
    {
        return Err("Memories actual SFNT family/style/weight mismatch".into());
    }
    let axes: Vec<_> = face.variation_axes().into_iter().collect();
    if axes.is_empty() {
        if !d.axes.is_empty() || face.weight().to_number() != d.weight {
            return Err("Memories static SFNT weight mismatch".into());
        }
    } else {
        if axes.len() != d.axes.len() {
            return Err("Memories SFNT axis declaration incomplete".into());
        }
        for axis in axes {
            let tag_bytes = axis.tag.to_bytes();
            let tag = std::str::from_utf8(&tag_bytes).map_err(|_| "Memories invalid SFNT axis")?;
            let v = *d.axes.get(tag).ok_or("Memories missing SFNT axis")?;
            if !v.is_finite()
                || v < f64::from(axis.min_value)
                || v > f64::from(axis.max_value)
                || (axis.tag == Tag::from_bytes(b"wght") && v != f64::from(d.weight))
                || face.set_variation(axis.tag, v as f32).is_none()
            {
                return Err("Memories actual SFNT axis mismatch".into());
            }
        }
        if !d.axes.contains_key("wght") && face.weight().to_number() != d.weight {
            return Err("Memories variable SFNT weight mismatch".into());
        }
    }
    for text in texts {
        for ch in text.chars() {
            if face.glyph_index(ch).is_none() {
                return Err(format!("Memories physical font lacks U+{:04X}", ch as u32));
            }
        }
    }
    Ok(())
}
