//! Rust is the sole authority for bytes, SFNT identity, axes and fallback routing.
use super::model::{LATIN, Tunnel};
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use ttf_parser::{Face, Tag, name_id};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fonts {
    pub mincho800: String,
    pub dot400: String,
    pub heavy900: String,
    pub noto400: String,
    pub noto800: String,
    pub noto900: String,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stack {
    pub role: String,
    pub resources: [Resource; 2],
    pub aliases: [String; 2],
    /// A scalar maps to the first declared face whose real cmap contains it.
    pub routes: BTreeMap<String, String>,
}
/// Not deserializable: a caller cannot manufacture authenticated admission.
pub struct Admission {
    pub(super) stacks: BTreeMap<String, Stack>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
            .ok_or("tunnel missing font descriptor")?,
    )
    .map_err(|e| e.to_string())
}
fn face<'a>(
    resource: &Resource,
    bytes: &'a [u8],
    family: &str,
    weight: u16,
) -> Result<Face<'a>, String> {
    if resource.kind != "font"
        || bytes.len() > 16 * 1024 * 1024
        || bytes.len() as u64 != resource.byte_length()
        || format!("{:x}", Sha256::digest(bytes)) != resource.sha256()
    {
        return Err("tunnel font bytes do not match declared resource identity".into());
    }
    let d = descriptor(resource)?;
    if d.family != family || d.style != "normal" || d.weight != weight {
        return Err("tunnel fixed font role descriptor mismatch".into());
    }
    let mut face = Face::parse(bytes, 0).map_err(|_| "tunnel invalid SFNT font")?;
    if face.is_italic()
        || !face.names().into_iter().any(|n| {
            (n.name_id == name_id::FAMILY || n.name_id == name_id::TYPOGRAPHIC_FAMILY)
                && n.to_string().as_deref() == Some(family)
        })
    {
        return Err("tunnel actual SFNT family/style mismatch".into());
    }
    let axes: Vec<_> = face.variation_axes().into_iter().collect();
    if axes.is_empty() {
        if !d.axes.is_empty() || face.weight().to_number() != weight {
            return Err("tunnel static SFNT weight/axes mismatch".into());
        }
    } else {
        // These fixed roles admit only the real Noto weight axis; no silent defaults.
        if family != "Noto Serif JP"
            || axes.len() != 1
            || axes[0].tag != Tag::from_bytes(b"wght")
            || d.axes.len() != 1
            || d.axes.get("wght") != Some(&f64::from(weight))
            || f32::from(weight) < axes[0].min_value
            || f32::from(weight) > axes[0].max_value
            || face
                .set_variation(Tag::from_bytes(b"wght"), f32::from(weight))
                .is_none()
        {
            return Err("tunnel variable SFNT axes mismatch".into());
        }
    }
    Ok(face)
}
impl Tunnel {
    /// Owned resource snapshots are supplied by the host; SHA is computed here.
    pub(in crate::mv_recipe) fn admit_fonts<T: AsRef<[u8]>>(
        &self,
        resources: &[Resource],
        bytes: &BTreeMap<String, T>,
    ) -> Result<Admission, String> {
        self.validate()?;
        let mut ids = BTreeSet::new();
        let roles = [
            (
                "mincho800",
                &self.fonts.mincho800,
                &self.fonts.noto800,
                "Shippori Mincho B1",
                800,
            ),
            (
                "dot400",
                &self.fonts.dot400,
                &self.fonts.noto400,
                "DotGothic16",
                400,
            ),
            (
                "heavy900",
                &self.fonts.heavy900,
                &self.fonts.noto900,
                "Zen Old Mincho",
                900,
            ),
        ];
        for (_, primary, fallback, _, _) in roles {
            if !ids.insert(primary) || !ids.insert(fallback) {
                return Err("tunnel font role IDs must be distinct".into());
            }
        }
        let mut total = 0usize;
        for id in &ids {
            total = total
                .checked_add(
                    bytes
                        .get(*id)
                        .ok_or("tunnel missing font bytes")?
                        .as_ref()
                        .len(),
                )
                .ok_or("tunnel font byte overflow")?;
        }
        if total > 64 * 1024 * 1024 {
            return Err("tunnel aggregate font bytes exceed budget".into());
        }
        let mut stacks = BTreeMap::new();
        for (role, primary, fallback, family, weight) in roles {
            let lookup = |id: &String| -> Result<&Resource, String> {
                let mut found = resources.iter().filter(|r| &r.id == id);
                let r = found.next().ok_or("tunnel undeclared font resource")?;
                if found.next().is_some() {
                    return Err("tunnel duplicate font resource".into());
                }
                Ok(r)
            };
            let p = lookup(primary)?;
            let f = lookup(fallback)?;
            let pf = face(p, bytes[primary].as_ref(), family, weight)?;
            let ff = face(f, bytes[fallback].as_ref(), "Noto Serif JP", weight)?;
            let glyphs: BTreeSet<char> = match role {
                "dot400" => LATIN
                    .iter()
                    .flat_map(|s| s.chars())
                    .chain("   ·   ".chars())
                    .collect(),
                "heavy900" => self
                    .words
                    .last()
                    .ok_or("tunnel missing title")?
                    .chars()
                    .collect(),
                _ => self
                    .words
                    .iter()
                    .chain(self.plan.iter().flatten().map(|(_, w)| w))
                    .flat_map(|s| s.chars())
                    .chain("　・".chars())
                    .collect(),
            };
            if glyphs.len() > 2048 {
                return Err("tunnel font glyph budget exceeded".into());
            }
            let mut routes = BTreeMap::new();
            for ch in glyphs {
                let selected = if pf.glyph_index(ch).is_some() {
                    primary
                } else if ff.glyph_index(ch).is_some() {
                    fallback
                } else {
                    return Err(format!(
                        "tunnel declared font stack lacks U+{:04X}",
                        u32::from(ch)
                    ));
                };
                routes.insert(ch.to_string(), selected.clone());
            }
            let alias = |r: &Resource| format!("mv-tunnel-{}-{weight}", r.sha256());
            stacks.insert(
                role.into(),
                Stack {
                    role: role.into(),
                    resources: [p.clone(), f.clone()],
                    aliases: [alias(p), alias(f)],
                    routes,
                },
            );
        }
        Ok(Admission { stacks })
    }
}
