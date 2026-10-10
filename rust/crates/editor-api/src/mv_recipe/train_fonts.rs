//! Byte-proven real original font families, weights, SFNT axes and cmap routing.
use super::model::Settings;
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use ttf_parser::{name_id, Face, Tag};
#[derive(Clone, Serialize)]
pub struct Stack {
    pub role: String,
    pub resources: [Resource; 2],
    pub aliases: [String; 2],
    pub routes: BTreeMap<String, String>,
}
pub struct Admission {
    pub(super) stacks: Vec<Stack>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Descriptor {
    family: String,
    style: String,
    weight: u16,
    #[serde(default)]
    axes: BTreeMap<String, f64>,
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
        return Err("Train font bytes mismatch".into());
    }
    let d: Descriptor = serde_json::from_value(
        serde_json::to_value(resource)
            .map_err(|e| e.to_string())?
            .get("font")
            .cloned()
            .ok_or("Train missing font descriptor")?,
    )
    .map_err(|e| e.to_string())?;
    if d.family != family || d.style != "normal" || d.weight != weight {
        return Err("Train fixed original font descriptor mismatch".into());
    }
    let mut f = Face::parse(bytes, 0).map_err(|_| "Train invalid SFNT")?;
    if f.is_italic()
        || !f.names().into_iter().any(|n| {
            (n.name_id == name_id::FAMILY || n.name_id == name_id::TYPOGRAPHIC_FAMILY)
                && n.to_string().as_deref() == Some(family)
        })
    {
        return Err("Train real SFNT family/style mismatch".into());
    }
    let axes: Vec<_> = f.variation_axes().into_iter().collect();
    if axes.is_empty() {
        if !d.axes.is_empty() || f.weight().to_number() != weight {
            return Err("Train static SFNT weight mismatch".into());
        }
    } else if family != "Noto Serif JP"
        || axes.len() != 1
        || axes[0].tag != Tag::from_bytes(b"wght")
        || d.axes.len() != 1
        || d.axes.get("wght") != Some(&f64::from(weight))
        || f32::from(weight) < axes[0].min_value
        || f32::from(weight) > axes[0].max_value
        || f.set_variation(Tag::from_bytes(b"wght"), f32::from(weight))
            .is_none()
    {
        return Err("Train variable font axes mismatch".into());
    }
    Ok(f)
}
impl Settings {
    pub fn admit_fonts<T: AsRef<[u8]>>(
        &self,
        resources: &[Resource],
        bytes: &BTreeMap<String, T>,
    ) -> Result<Admission, String> {
        self.validate()?;
        let roles = [
            (
                "mincho700",
                &self.fonts.mincho700,
                &self.fonts.noto700,
                "Shippori Mincho B1",
                700,
            ),
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
        ];
        let mut ids = BTreeSet::new();
        let mut total = 0usize;
        for (_, p, f, _, _) in roles {
            for id in [p, f] {
                if !ids.insert(id) {
                    return Err("Train font role IDs must be distinct".into());
                }
                total = total
                    .checked_add(
                        bytes
                            .get(id)
                            .ok_or("Train missing font bytes")?
                            .as_ref()
                            .len(),
                    )
                    .ok_or("Train font byte overflow")?;
            }
        }
        if total > 96 * 1024 * 1024 {
            return Err("Train font aggregate byte budget exceeded".into());
        }
        let lookup = |id: &String| -> Result<&Resource, String> {
            let mut found = resources.iter().filter(|r| &r.id == id);
            let r = found.next().ok_or("Train undeclared font resource")?;
            if found.next().is_some() {
                return Err("Train duplicate font resource".into());
            }
            Ok(r)
        };
        let mut stacks = Vec::new();
        for (role, primary, fallback, family, weight) in roles {
            let p = lookup(primary)?;
            let f = lookup(fallback)?;
            let pf = face(p, bytes[primary].as_ref(), family, weight)?;
            let ff = face(f, bytes[fallback].as_ref(), "Noto Serif JP", weight)?;
            let glyphs: BTreeSet<char> = "願いねがい祈り夢明日0123456789COUNTRAIN:./"
                .chars()
                .collect();
            if glyphs.len() > 2048 {
                return Err("Train glyph routing budget exceeded".into());
            }
            let mut routes = BTreeMap::new();
            for ch in glyphs {
                let id = if pf.glyph_index(ch).is_some() {
                    primary
                } else if ff.glyph_index(ch).is_some() {
                    fallback
                } else {
                    return Err(format!("Train font stack lacks U+{:04X}", ch as u32));
                };
                routes.insert(ch.to_string(), id.clone());
            }
            let alias = |r: &Resource| format!("mv-train-{}-{weight}", r.sha256());
            stacks.push(Stack {
                role: role.into(),
                resources: [p.clone(), f.clone()],
                aliases: [alias(p), alias(f)],
                routes,
            });
        }
        Ok(Admission { stacks })
    }
}
