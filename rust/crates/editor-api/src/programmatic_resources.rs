//! Resource policy is shared by editing validation and both rendering hosts.
use crate::model::Issue;
use bridge::export;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

const MAX_RESOURCE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FONT_AXES: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoLimits {
    max_bytes: u64,
    max_dimension: u32,
    max_elements: u32,
}

pub fn video_limits(html: bool) -> Option<VideoLimits> {
    html.then_some(VideoLimits {
        max_bytes: MAX_RESOURCE_BYTES,
        max_dimension: 4096,
        max_elements: 16,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeLimits {
    max_bytes: u64,
    max_decoded_bytes: u64,
    max_dimension: u32,
    max_objects: u32,
}

pub fn decode_limits(resources: &[Resource], three_build: bool) -> Option<DecodeLimits> {
    (three_build
        || resources
            .iter()
            .any(|r| matches!(r.kind.as_str(), "model" | "environment")))
    .then_some(DecodeLimits {
        max_bytes: MAX_RESOURCE_BYTES,
        max_decoded_bytes: 128 * 1024 * 1024,
        max_dimension: 8192,
        max_objects: 100_000,
    })
}

#[export]
pub fn validate_programmatic_resources_json(input: String) -> String {
    let issues = match serde_json::from_str::<Vec<Resource>>(&input) {
        Ok(resources) => validate(&resources),
        Err(error) => vec![Issue::new(
            "editing.programmatic.resources",
            &error.to_string(),
        )],
    };
    serde_json::to_string(&issues).expect("serializable issues")
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resource {
    pub(crate) id: String,
    pub(crate) kind: String,
    attachment_key: String,
    mime_type: String,
    byte_length: u64,
    sha256: String,
    #[serde(
        default,
        deserialize_with = "deserialize_font",
        skip_serializing_if = "Option::is_none"
    )]
    font: Option<Font>,
}

impl Resource {
    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(crate) fn attachment_key(&self) -> &str {
        &self.attachment_key
    }
    pub(crate) fn byte_length(&self) -> u64 {
        self.byte_length
    }
    pub(crate) fn mime_type(&self) -> &str {
        &self.mime_type
    }
    pub(crate) fn same_content(&self, other: &Self) -> bool {
        self.kind == other.kind
            && self.attachment_key == other.attachment_key
            && self.mime_type() == other.mime_type()
            && self.byte_length == other.byte_length
            && self.sha256 == other.sha256
            && self.font == other.font
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Font {
    family: String,
    style: String,
    weight: u16,
    // An omitted declaration retains the font's default instance. A structured
    // map keeps arbitrary OpenType tags separate from executable CSS text.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    axes: BTreeMap<String, f64>,
}

fn deserialize_font<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Font>, D::Error> {
    Font::deserialize(d).map(Some)
}

pub fn validate(resources: &[Resource]) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut ids = HashSet::new();
    let mut faces = HashSet::new();
    let mut total = 0u64;
    let mut issue = |message| issues.push(Issue::new("editing.programmatic.resources", message));
    if resources.len() > 64 {
        issue("A source may declare at most 64 resources");
    }
    for r in resources {
        // Portable logical paths support nested authored assets, without URL,
        // query, percent-decoding, backslash or traversal aliases.
        if r.id.is_empty()
            || r.id.len() > 240
            || !r
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
            || r.id
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !ids.insert(&r.id)
        {
            issue("Resource IDs must be unique portable relative logical paths");
        }
        if r.sha256.len() != 64
            || !r
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || r.attachment_key
                != format!(
                    "{}{}",
                    if r.kind == "source" {
                        "programmatic-source-sha256-"
                    } else {
                        "programmatic-sha256-"
                    },
                    r.sha256
                )
        {
            issue("Resource attachment key must match its lowercase SHA-256");
        }
        total = total.saturating_add(r.byte_length);
        if (r.byte_length == 0 && r.kind != "source") || r.byte_length > MAX_RESOURCE_BYTES {
            issue("Resource bytes must be 1..16777216 (source archives may be empty)");
        }
        match (r.kind.as_str(), &r.font) {
            ("source", None) if r.mime_type == "application/octet-stream" => {}
            ("document", None) if r.mime_type == "text/html" => {}
            ("analysis", None) if r.mime_type == "application/json" => {}
            ("imageSequence", None) if r.mime_type == crate::image_sequence::MIME => {}
            ("video", None) if matches!(r.mime_type.as_str(), "video/mp4" | "video/webm") => {}
            ("model", None)
                if matches!(r.mime_type.as_str(), "model/gltf-binary" | "image/svg+xml") => {}
            ("environment", None)
                if matches!(r.mime_type.as_str(), "image/vnd.radiance" | "image/x-exr") => {}
            ("image", None)
                if matches!(
                    r.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                ) => {}
            ("font", Some(font))
                if matches!(
                    r.mime_type.as_str(),
                    "font/ttf" | "font/otf" | "font/woff" | "font/woff2"
                ) =>
            {
                if font.family.trim().is_empty()
                    || font.family.len() > 128
                    || font
                        .family
                        .chars()
                        .any(|c| c.is_control() || matches!(c, '\'' | '"' | '\\' | ';'))
                    || !matches!(font.style.as_str(), "normal" | "italic")
                    || !(1..=1000).contains(&font.weight)
                    || !faces.insert((font.family.to_lowercase(), &font.style, font.weight))
                {
                    issue("Font family/style/weight must identify a valid unique face");
                }
                if font.axes.len() > MAX_FONT_AXES
                    || font.axes.iter().any(|(tag, value)| {
                        tag.len() != 4
                            || !tag.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
                            || !value.is_finite()
                    })
                {
                    issue(
                        "Font axes require at most 64 four-byte printable ASCII tags with finite numeric values",
                    );
                }
            }
            _ => issue("Resource kind, MIME type and font descriptor do not match"),
        }
    }
    if total > MAX_TOTAL_RESOURCE_BYTES {
        issue("Total source resource bytes exceed 67108864");
    }
    issues
}
