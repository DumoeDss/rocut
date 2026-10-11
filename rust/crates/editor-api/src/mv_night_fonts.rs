//! Physical byte sources and logical font instances are distinct capabilities.
//! Only the complete PHYSICAL manifest goes through the generic 64 MiB policy.
//! Derived aliases are internal frozen-scene inputs, never authored resources.
use super::protocol::{FontInstance, Settings};
use crate::programmatic_resources::{self, Resource};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use ttf_parser::{Face, Tag, name_id};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    family: String,
    style: String,
    weight: u16,
    #[serde(default)]
    axes: BTreeMap<String, f64>,
}
fn descriptor(resource: &Resource) -> Result<Descriptor, String> {
    let value = serde_json::to_value(resource).map_err(|e| e.to_string())?;
    serde_json::from_value(
        value
            .get("font")
            .cloned()
            .ok_or("Night font source descriptor missing")?,
    )
    .map_err(|e| e.to_string())
}
pub(super) fn role_ids(binding: &Settings) -> Result<Vec<&str>, String> {
    let ids = match binding {
        Settings::WetFloor { settings: a } => {
            a.validate()?;
            vec![
                a.fonts.mincho800.as_str(),
                &a.fonts.noto800,
                &a.fonts.dot400,
                &a.fonts.noto400,
            ]
        }
        Settings::Train { settings: a } => {
            a.validate()?;
            vec![
                a.fonts.mincho800.as_str(),
                &a.fonts.noto800,
                &a.fonts.mincho700,
                &a.fonts.noto700,
                &a.fonts.dot400,
                &a.fonts.noto400,
            ]
        }
    };
    if ids.iter().copied().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err("Night font role instance IDs must remain distinct".into());
    }
    Ok(ids)
}
pub(super) struct Aliases {
    pub resources: Vec<Resource>,
    pub instance_bytes: u64,
}
/// Bounded metadata checks occur before platform packet allocation/copy. Full
/// SFNT and role/glyph admission still MUST follow against the actual bytes.
pub(super) fn metadata(
    resources: &[Resource],
    instances: &[FontInstance],
    expected_ids: &[&str],
) -> Result<Aliases, String> {
    if instances.len() != expected_ids.len() || instances.len() > 6 {
        return Err("Night font instance count differs from exact scene roles".into());
    }
    let physical_ids: BTreeSet<_> = resources.iter().map(|r| r.id.as_str()).collect();
    let expected: BTreeSet<_> = expected_ids.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut faces = BTreeSet::new();
    let mut sources = BTreeSet::new();
    for resource in resources.iter().filter(|r| r.kind == "font") {
        if !sources.insert(resource.sha256()) {
            return Err("Night identical physical font bytes must be transmitted once".into());
        }
    }
    let mut aliases = Vec::new();
    let mut total = 0u64;
    for instance in instances {
        if !expected.contains(instance.id.as_str())
            || !seen.insert(instance.id.as_str())
            || physical_ids.contains(instance.id.as_str())
        {
            return Err("Night missing/duplicate/conflicting font instance identity".into());
        }
        let source = resources
            .iter()
            .find(|r| r.id == instance.resource_id)
            .ok_or("Night font instance physical source missing")?;
        if source.kind != "font" {
            return Err("Night font instance source must be a physical font".into());
        }
        let inherited = descriptor(source)?;
        if instance.axes.len() > 1
            || instance.axes.iter().any(|(tag, value)| {
                tag != "wght" || !value.is_finite() || *value != f64::from(instance.weight)
            })
        {
            return Err("Night font instance unsupported/inconsistent axis".into());
        }
        if !faces.insert((
            inherited.family.to_lowercase(),
            inherited.style,
            instance.weight,
        )) {
            return Err("Night duplicate logical font family/style/weight instance".into());
        }
        // Closed derivation: all identity/content/family/style/MIME fields are
        // inherited from the byte-admitted physical source, not caller aliases.
        let mut value = serde_json::to_value(source).map_err(|e| e.to_string())?;
        let object = value
            .as_object_mut()
            .ok_or("Night font source object lost")?;
        object.insert("id".into(), serde_json::json!(instance.id));
        let font = object
            .get_mut("font")
            .and_then(|v| v.as_object_mut())
            .ok_or("Night font descriptor lost")?;
        font.insert("weight".into(), serde_json::json!(instance.weight));
        font.insert(
            "axes".into(),
            serde_json::to_value(&instance.axes).map_err(|e| e.to_string())?,
        );
        let alias: Resource = serde_json::from_value(value).map_err(|e| e.to_string())?;
        // This checks ONE derived alias's syntax, not the aggregate physical
        // resource budget. The complete physical manifest was validated first.
        if let Some(issue) = programmatic_resources::validate(std::slice::from_ref(&alias)).first()
        {
            return Err(issue.message.clone());
        }
        total = total
            .checked_add(source.byte_length())
            .ok_or("Night font instance bytes overflow")?;
        aliases.push(alias);
    }
    if total > 96 * 1024 * 1024 {
        return Err("Night logical font instance aggregate exceeds96MiB".into());
    }
    Ok(Aliases {
        resources: aliases,
        instance_bytes: total,
    })
}
/// Check the physical descriptor too; a valid logical instance cannot conceal
/// a false authored static source weight or unsupported source variation.
pub(super) fn validate_sources(
    resources: &[Resource],
    bodies: &BTreeMap<String, &[u8]>,
) -> Result<(), String> {
    for resource in resources.iter().filter(|r| r.kind == "font") {
        let bytes = *bodies
            .get(&resource.id)
            .ok_or("Night actual physical font bytes missing")?;
        if bytes.len() as u64 != resource.byte_length()
            || format!("{:x}", Sha256::digest(bytes)) != resource.sha256()
        {
            return Err("Night physical font SHA/length mismatch".into());
        }
        if !matches!(
            (resource.mime_type(), bytes.get(..4)),
            ("font/ttf", Some([0, 1, 0, 0]))
                | ("font/ttf", Some([b't', b'r', b'u', b'e']))
                | ("font/otf", Some([b'O', b'T', b'T', b'O']))
        ) {
            return Err("Night physical SFNT MIME/signature mismatch".into());
        }
        let d = descriptor(resource)?;
        let mut face = Face::parse(bytes, 0).map_err(|_| "Night invalid physical SFNT")?;
        if d.style != "normal"
            || face.is_italic()
            || !face.names().into_iter().any(|n| {
                (n.name_id == name_id::FAMILY || n.name_id == name_id::TYPOGRAPHIC_FAMILY)
                    && n.to_string().as_deref() == Some(d.family.as_str())
            })
        {
            return Err("Night physical SFNT family/style mismatch".into());
        }
        let axes: Vec<_> = face.variation_axes().into_iter().collect();
        if axes.is_empty() {
            if !d.axes.is_empty() || face.weight().to_number() != d.weight {
                return Err("Night physical static SFNT weight/axes mismatch".into());
            }
        } else if d.family != "Noto Serif JP"
            || axes.len() != 1
            || axes[0].tag != Tag::from_bytes(b"wght")
            || d.axes.len() != 1
            || d.axes.get("wght") != Some(&f64::from(d.weight))
            || f32::from(d.weight) < axes[0].min_value
            || f32::from(d.weight) > axes[0].max_value
            || face
                .set_variation(Tag::from_bytes(b"wght"), f32::from(d.weight))
                .is_none()
        {
            return Err("Night physical variable SFNT weight/axis mismatch".into());
        }
    }
    Ok(())
}
pub(super) fn instance_bodies<'a>(
    instances: &[FontInstance],
    physical: &BTreeMap<String, &'a [u8]>,
) -> Result<BTreeMap<String, &'a [u8]>, String> {
    instances
        .iter()
        .map(|i| {
            Ok((
                i.id.clone(),
                *physical
                    .get(&i.resource_id)
                    .ok_or("Night font instance body source lost")?,
            ))
        })
        .collect()
}
#[cfg(test)]
#[path = "mv_night_font_tests.rs"]
mod tests;
