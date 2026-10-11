//! Byte-admitted original 256x16 LUT atlas and named post-row resolution.
#[path = "mv_lut_atlas_layout.rs"]
mod layout;
use crate::{image_sequence::inspect_encoded_image, programmatic_resources::Resource};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub palette_resource: String,
    pub images: Vec<Binding>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub path: String,
    pub resource_id: String,
}
/// Actual decoded image facts from the native platform resource bridge, not authored JSON.
pub struct DecodedImage {
    pub resource_id: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Deserialize, Serialize)]
struct Palette {
    pub id: String,
    pub lut: String,
    pub lut_duotone: String,
    #[serde(flatten)]
    metadata: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
struct Document {
    palettes: Vec<Palette>,
    #[serde(flatten)]
    _metadata: BTreeMap<String, Value>,
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Row {
    Image {
        row: u8,
        resource: Resource,
        source_rect: [u32; 4],
        destination_rect: [u32; 4],
    },
    Ramp {
        row: u8,
        name: String,
        gradient_points: [u32; 4],
        stops: Vec<(f64, String)>,
        destination_rect: [u32; 4],
    },
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSample {
    row: u8,
    rect: [u32; 4],
    atlas_sha256: String,
    source_resource: Option<Resource>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    version: u8,
    profile: &'static str,
    size: [u32; 2],
    palette_resource: Resource,
    atlas_sha256: String,
    used_rows: u8,
    aliases: BTreeMap<String, u8>,
    palettes: BTreeMap<String, Value>,
    rows: Vec<Row>,
    allocation_bytes: u64,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn resource<'a>(id: &str, resources: &'a [Resource]) -> Result<&'a Resource, String> {
    let mut found = resources.iter().filter(|r| r.id == id);
    let r = found.next().ok_or("LUT atlas undeclared resource")?;
    if found.next().is_some() {
        return Err("LUT atlas duplicate resource ID".into());
    }
    Ok(r)
}
fn bytes<'a, T: AsRef<[u8]>>(
    r: &Resource,
    bodies: &'a BTreeMap<String, T>,
    max: usize,
) -> Result<&'a [u8], String> {
    let b = bodies
        .get(&r.id)
        .ok_or("LUT atlas missing actual bytes")?
        .as_ref();
    if b.is_empty() || b.len() > max || b.len() as u64 != r.byte_length() || digest(b) != r.sha256()
    {
        return Err("LUT atlas byte SHA/length admission mismatch".into());
    }
    Ok(b)
}
pub fn build<T: AsRef<[u8]>>(
    settings: &Settings,
    resources: &[Resource],
    bodies: &BTreeMap<String, T>,
    decoded: &[DecodedImage],
) -> Result<Plan, String> {
    if settings.images.len() > 10 || settings.palette_resource.is_empty() {
        return Err("LUT atlas binding count/identity invalid".into());
    }
    let palette = resource(&settings.palette_resource, resources)?;
    if palette.kind != "analysis" || palette.mime_type() != "application/json" {
        return Err("LUT atlas palettes require real JSON data resource".into());
    }
    let json = bytes(palette, bodies, 256 * 1024)?;
    let text = std::str::from_utf8(json).map_err(|_| "LUT atlas palettes are not strict UTF-8")?;
    let json = text.strip_prefix('\u{feff}').unwrap_or(text);
    let doc: Document =
        serde_json::from_str(json).map_err(|e| format!("LUT atlas invalid palettes JSON: {e}"))?;
    let specs: Vec<_> = doc
        .palettes
        .iter()
        .map(|p| layout::Palette {
            id: p.id.clone(),
            lut: p.lut.clone(),
            lut_duotone: p.lut_duotone.clone(),
        })
        .collect();
    let layout = layout::layout(&specs)?;
    let mut bindings = BTreeMap::new();
    let mut bound_ids = BTreeSet::new();
    for binding in &settings.images {
        if binding.path.is_empty()
            || binding.path.len() > 512
            || binding.resource_id.is_empty()
            || !bound_ids.insert(&binding.resource_id)
            || bindings
                .insert(binding.path.clone(), binding.resource_id.clone())
                .is_some()
        {
            return Err("LUT atlas duplicate/missing path/resource binding".into());
        }
    }
    if settings.images.len() != doc.palettes.len() * 2 {
        return Err("LUT atlas missing/extra image bindings".into());
    }
    let mut actual = BTreeMap::new();
    for facts in decoded {
        if actual.insert(facts.resource_id.clone(), facts).is_some() {
            return Err("LUT atlas duplicate decoded image facts".into());
        }
    }
    let mut rows = Vec::new();
    let mut allocation = 256u64 * 16 * 4 * 4 + palette.byte_length() * 4;
    for (index, row) in layout.rows.into_iter().enumerate() {
        let row_index = index as u8;
        match row {
            layout::Row::Image { path } => {
                let id = bindings
                    .get(&path)
                    .ok_or("LUT atlas missing palette image mapping")?;
                let r = resource(id, resources)?;
                if r.kind != "image" || r.mime_type() != "image/png" {
                    return Err("LUT atlas LUT image must be actual PNG resource".into());
                }
                let body = bytes(r, bodies, 4 * 1024 * 1024)?;
                let (width, height) = inspect_encoded_image(r.mime_type(), body)?;
                let facts = actual
                    .get(id)
                    .ok_or("LUT atlas missing actual decoded dimensions")?;
                if width == 0
                    || height == 0
                    || width > 4096
                    || height > 4096
                    || u64::from(width) * u64::from(height) * 4 > 16 * 1024 * 1024
                    || facts.width != width
                    || facts.height != height
                {
                    return Err(
                        "LUT atlas encoded/decoded dimension mismatch or budget exceeded".into(),
                    );
                }
                allocation = allocation
                    .checked_add(u64::from(width) * u64::from(height) * 4 * 3 + r.byte_length() * 2)
                    .ok_or("LUT atlas allocation overflow")?;
                rows.push(Row::Image {
                    row: row_index,
                    resource: r.clone(),
                    source_rect: [0, 0, width, height],
                    destination_rect: [0, u32::from(row_index), 256, 1],
                });
            }
            layout::Row::Ramp { name, stops } => rows.push(Row::Ramp {
                row: row_index,
                name: name.into(),
                gradient_points: [0, 0, 256, 0],
                stops: stops.into_iter().map(|(n, c)| (n, c.into())).collect(),
                destination_rect: [0, u32::from(row_index), 256, 1],
            }),
        }
    }
    if allocation > 256 * 1024 * 1024 {
        return Err("LUT atlas aggregate allocation budget exceeded".into());
    }
    let palettes = layout
        .palette_aliases
        .iter()
        .map(|(alias, index)| {
            Ok((
                alias.clone(),
                serde_json::to_value(&doc.palettes[*index]).map_err(|e| e.to_string())?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let mut plan = Plan {
        version: 1,
        profile: "original-lut-atlas-v1",
        size: [256, 16],
        palette_resource: palette.clone(),
        atlas_sha256: String::new(),
        used_rows: rows.len() as u8,
        aliases: layout.aliases,
        palettes,
        rows,
        allocation_bytes: allocation,
    };
    plan.atlas_sha256 = digest(&serde_json::to_vec(&plan).map_err(|e| e.to_string())?);
    Ok(plan)
}
impl Plan {
    pub fn resolve_row(&self, name: &str) -> Result<u8, String> {
        self.aliases
            .get(name)
            .copied()
            .ok_or_else(|| format!("LUT atlas missing required alias {name}"))
    }
    pub fn row_sample(&self, name: &str) -> Result<RowSample, String> {
        let row = self.resolve_row(name)?;
        let source_resource = match &self.rows[row as usize] {
            Row::Image { resource, .. } => Some(resource.clone()),
            Row::Ramp { .. } => None,
        };
        Ok(RowSample {
            row,
            rect: [0, u32::from(row), 256, 1],
            atlas_sha256: self.atlas_sha256.clone(),
            source_resource,
        })
    }
    /// Only name-to-row policy runs here; the existing Rust original GL producer
    /// remains responsible for complete closed post parameter validation.
    pub fn resolve_post_parameters(&self, input: &Value) -> Result<Value, String> {
        let mut object = input
            .as_object()
            .ok_or("LUT atlas post parameters must be object")?
            .clone();
        for key in ["lutA", "lutB"] {
            if let Some(value) = object.get(key).cloned() {
                let row = if let Some(name) = value.as_str() {
                    self.resolve_row(name)?
                } else {
                    let n = value
                        .as_f64()
                        .ok_or("LUT atlas post row requires name or integer")?;
                    if !n.is_finite()
                        || n < 0.0
                        || n.fract() != 0.0
                        || n >= f64::from(self.used_rows)
                    {
                        return Err("LUT atlas post row is missing/unused".into());
                    }
                    n as u8
                };
                object.insert(key.into(), Value::from(row));
            }
        }
        if !object.contains_key("lutB") {
            if let Some(value) = object.get("lutA").cloned() {
                object.insert("lutB".into(), value);
            }
        }
        Ok(Value::Object(object))
    }
}
/// Opaque actual native row pixels; TS performs readback only, never LUT grading.
pub struct RowPixels {
    sample: RowSample,
    pixels: Vec<u8>,
    sampled_sha256: String,
}
pub fn prepare_row_pixels(
    plan: &Plan,
    sample: &RowSample,
    rgba: &[u8],
) -> Result<RowPixels, String> {
    if sample.atlas_sha256 != plan.atlas_sha256
        || sample.row >= plan.used_rows
        || sample.rect != [0, u32::from(sample.row), 256, 1]
        || rgba.len() != 256 * 4
    {
        return Err("LUT atlas actual row pixel binding/shape mismatch".into());
    }
    let expected = match &plan.rows[sample.row as usize] {
        Row::Image { resource, .. } => Some(resource),
        Row::Ramp { .. } => None,
    };
    if sample.source_resource.as_ref() != expected {
        return Err("LUT atlas row source identity mismatch".into());
    }
    Ok(RowPixels {
        sample: sample.clone(),
        pixels: rgba.to_vec(),
        sampled_sha256: digest(rgba),
    })
}
impl RowPixels {
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }
    pub fn row(&self) -> u8 {
        self.sample.row
    }
    pub fn source_resource(&self) -> Option<&Resource> {
        self.sample.source_resource.as_ref()
    }
    pub fn sampled_sha256(&self) -> &str {
        &self.sampled_sha256
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Actual original P4_hotarubi.png encoded bytes, not a generated ramp.
    const PNG_HEX: &str = "89504e470d0a1a0a0000000d4948445200000100000000010802000000be3be720000000ad49444154789c754ecb0ec3200c8b83e88ebbedffff94c97910a0ad5a19c7760ce8df9f8808401422826f62717e0f622ae96f6228597c2fdc95f990e72b5c5a5688ae823c28c5ec70122598dc8cbd242f0aab7a6ea3f1b9758cf3a235326b4efd70df6276ee3d2f8bb1a22aaa30bc9146de4adc33e6fadfd6c0a29755e2a012e3884c0be24aa33b14601250d81bf854341b8dd08a408edc35a465b1a30472413e5a7841ba13959e2389a1f3fe07292b07d7326c00140000000049454e44ae426082";
    fn resource_for(id: &str, kind: &str, mime: &str, body: &[u8]) -> Resource {
        serde_json::from_value(serde_json::json!({"id":id,"kind":kind,"attachmentKey":format!("test/{id}"),"mimeType":mime,"byteLength":body.len(),"sha256":digest(body)})).unwrap()
    }
    fn fixture() -> (
        Settings,
        Vec<Resource>,
        BTreeMap<String, Vec<u8>>,
        Vec<DecodedImage>,
    ) {
        let png: Vec<u8> = PNG_HEX
            .as_bytes()
            .chunks_exact(2)
            .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
            .collect();
        let json =
            br#"{"palettes":[{"id":"P4_real","lut":"lut.png","lut_duotone":"duo.png"}]}"#.to_vec();
        let settings = Settings {
            palette_resource: "pal".into(),
            images: vec![
                Binding {
                    path: "lut.png".into(),
                    resource_id: "lut".into(),
                },
                Binding {
                    path: "duo.png".into(),
                    resource_id: "duo".into(),
                },
            ],
        };
        let resources = vec![
            resource_for("pal", "analysis", "application/json", &json),
            resource_for("lut", "image", "image/png", &png),
            resource_for("duo", "image", "image/png", &png),
        ];
        let bodies = BTreeMap::from([
            ("pal".into(), json),
            ("lut".into(), png.clone()),
            ("duo".into(), png),
        ]);
        let decoded = vec![
            DecodedImage {
                resource_id: "lut".into(),
                width: 256,
                height: 1,
            },
            DecodedImage {
                resource_id: "duo".into(),
                width: 256,
                height: 1,
            },
        ];
        (settings, resources, bodies, decoded)
    }
    #[test]
    fn actual_png_identity_and_native_row_pixel_admission() {
        let (s, r, b, d) = fixture();
        let plan = build(&s, &r, &b, &d).unwrap();
        assert_eq!(plan.resolve_row("P4").unwrap(), 0);
        assert_eq!(plan.resolve_row("P4_duo").unwrap(), 1);
        assert_eq!(plan.used_rows, 7);
        let sample = plan.row_sample("P4").unwrap();
        assert_eq!(
            sample.source_resource.as_ref().unwrap().sha256(),
            "69860d423c2d3954c4c447725af2bd35a8e13e9941ab6fe5f339ffeabd21acfe"
        );
        let rgba = vec![7; 1024];
        let row = prepare_row_pixels(&plan, &sample, &rgba).unwrap();
        assert_eq!(row.pixels(), rgba);
        assert_eq!(row.row(), 0);
        assert_eq!(row.sampled_sha256(), digest(&rgba));
        assert!(prepare_row_pixels(&plan, &sample, &rgba[..1023]).is_err());
    }
    #[test]
    fn reject_missing_modified_mime_and_false_decode_facts() {
        let (s, r, mut b, mut d) = fixture();
        b.get_mut("lut").unwrap()[50] ^= 1;
        assert!(build(&s, &r, &b, &d).is_err());
        let (s, mut r, b, _) = fixture();
        let raw = b["lut"].clone();
        r[1] = resource_for("lut", "image", "image/jpeg", &raw);
        assert!(build(&s, &r, &b, &d).is_err());
        let (mut s, r, b, _) = fixture();
        s.images.pop();
        assert!(build(&s, &r, &b, &d).is_err());
        let (s, r, b, _) = fixture();
        d[0].width = 255;
        assert!(build(&s, &r, &b, &d).is_err());
    }
    #[test]
    fn named_post_rows_are_native_and_missing_alias_fails_closed() {
        let (s, r, b, d) = fixture();
        let plan = build(&s, &r, &b, &d).unwrap();
        let p = plan
            .resolve_post_parameters(&serde_json::json!({"lutA":"P4","lutMix":0.18}))
            .unwrap();
        assert_eq!(p["lutA"], 0);
        assert_eq!(p["lutB"], 0);
        assert_eq!(p["lutMix"], 0.18);
        assert!(
            plan.resolve_post_parameters(&serde_json::json!({"lutA":"absent"}))
                .is_err()
        );
        assert!(
            plan.resolve_post_parameters(&serde_json::json!({"lutA":15}))
                .is_err()
        );
    }
}
