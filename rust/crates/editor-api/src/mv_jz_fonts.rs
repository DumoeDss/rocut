//! Admit the physical face and coverage; no system-font fallback in embedded JZ.
use crate::programmatic_resources::Resource;
use serde::Deserialize;
use std::collections::BTreeMap;
use ttf_parser::{Face, Tag, name_id};
#[derive(Deserialize)]
struct Descriptor {
    family: String,
    style: String,
    weight: u16,
    #[serde(default)]
    axes: BTreeMap<String, f64>,
}
pub(super) fn admit(
    r: &Resource,
    bytes: &[u8],
    reference: &serde_json::Value,
    texts: &[String],
) -> Result<(), String> {
    if r.kind != "font"
        || !matches!(
            (r.mime_type(), bytes.get(..4)),
            ("font/ttf", Some([0, 1, 0, 0])) | ("font/otf", Some(b"OTTO"))
        )
    {
        return Err("JIZURA requires actual SFNT font bytes".into());
    }
    let d: Descriptor =
        serde_json::from_value(serde_json::to_value(r).map_err(|e| e.to_string())?["font"].clone())
            .map_err(|e| e.to_string())?;
    let mut face = Face::parse(bytes, 0).map_err(|_| "JIZURA invalid SFNT")?;
    let digest = reference["contentDigest"]
        .as_str()
        .ok_or("JIZURA immutable font digest required")?;
    if digest.strip_prefix("sha256:").unwrap_or(digest) != r.sha256() {
        return Err("JIZURA saved font digest differs from physical binding".into());
    }
    if reference["family"].as_str() != Some(d.family.as_str())
        || reference["style"].as_str() != Some(d.style.as_str())
        || reference["weight"].as_u64() != Some(d.weight as u64)
        || face.is_italic() != (d.style == "italic")
        || !face.names().into_iter().any(|n| {
            matches!(n.name_id, name_id::FAMILY | name_id::TYPOGRAPHIC_FAMILY)
                && n.to_string().as_deref() == Some(d.family.as_str())
        })
    {
        return Err("JIZURA font face/reference identity mismatch".into());
    }
    let axes: Vec<_> = face.variation_axes().into_iter().collect();
    if axes.len() != d.axes.len() {
        return Err("JIZURA complete font axis declaration required".into());
    }
    for axis in axes {
        let tag = axis.tag.to_bytes();
        let tag = std::str::from_utf8(&tag).map_err(|_| "Invalid JIZURA axis")?;
        let v = *d.axes.get(tag).ok_or("Missing JIZURA axis")?;
        if !v.is_finite()
            || v < f64::from(axis.min_value)
            || v > f64::from(axis.max_value)
            || (axis.tag == Tag::from_bytes(b"wght") && v != f64::from(d.weight))
            || face.set_variation(axis.tag, v as f32).is_none()
        {
            return Err("JIZURA axis mismatch".into());
        }
    }
    if !d.axes.contains_key("wght") && face.weight().to_number() != d.weight {
        return Err("JIZURA font weight mismatch".into());
    }
    for text in texts {
        for c in text.chars().filter(|c| !c.is_whitespace()) {
            if face.glyph_index(c).is_none() {
                return Err(format!("JIZURA font lacks U+{:04X}", c as u32));
            }
        }
    }
    Ok(())
}
