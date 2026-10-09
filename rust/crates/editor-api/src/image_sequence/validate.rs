use super::model::*;
use crate::programmatic_resources::{Resource, validate as validate_resources};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub fn safe_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
        && value.split('/').all(|part| {
            let lower = part.to_ascii_lowercase();
            let stem = lower.split('.').next().unwrap_or("");
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with('.')
                && !matches!(stem, "con" | "prn" | "aux" | "nul")
                && !["com", "lpt"].iter().any(|prefix| {
                    stem.strip_prefix(prefix).is_some_and(|n| {
                        matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
                    })
                })
        })
}

fn has_file_parent<'a>(paths: impl IntoIterator<Item = &'a str>) -> bool {
    let paths: BTreeSet<&str> = paths.into_iter().collect();
    paths.iter().any(|path| {
        let mut parent = *path;
        while let Some((prefix, _)) = parent.rsplit_once('/') {
            if paths.contains(prefix) {
                return true;
            }
            parent = prefix;
        }
        false
    })
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn label(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}

pub(super) fn same_content(left: &Resource, right: &Resource) -> bool {
    left.same_content(right)
}

fn parameters(
    value: &Value,
    depth: usize,
    elements: &mut usize,
    bytes: &mut usize,
) -> Result<(), String> {
    *elements = elements
        .checked_add(1)
        .ok_or("Image sequence parameter count overflow")?;
    if depth > LIMITS.max_parameter_depth || *elements > LIMITS.max_parameter_elements {
        return Err("Image sequence parameters exceed depth or element limits".into());
    }
    let string = |s: &str, bytes: &mut usize| -> Result<(), String> {
        if s.len() > LIMITS.max_parameter_string_bytes {
            return Err("Image sequence parameter string is too long".into());
        }
        *bytes = bytes
            .checked_add(s.len())
            .ok_or("Image sequence parameter byte overflow")?;
        if *bytes > LIMITS.max_parameter_bytes {
            return Err("Image sequence parameters exceed byte limit".into());
        }
        Ok(())
    };
    match value {
        Value::String(s) => string(s, bytes)?,
        Value::Array(items) => {
            for item in items {
                parameters(item, depth + 1, elements, bytes)?;
            }
        }
        Value::Object(items) => {
            for (key, item) in items {
                string(key, bytes)?;
                parameters(item, depth + 1, elements, bytes)?;
            }
        }
        Value::Number(n) => {
            let value = n
                .as_f64()
                .ok_or("Invalid image sequence parameter number")?;
            if !value.is_finite() || value.abs() > MAX_SAFE as f64 {
                return Err("Image sequence parameter numbers must be finite safe values".into());
            }
        }
        _ => {}
    }
    Ok(())
}

impl Manifest {
    /// Structural/declaration validation only. Hosts must verify all attachment
    /// bytes, manifest digest, image dimensions and whole source-file hashes.
    pub fn validate<'a>(&'a self) -> Result<Vec<&'a Resource>, String> {
        let pixels = u64::from(self.width)
            .checked_mul(u64::from(self.height))
            .and_then(|v| v.checked_mul(4))
            .ok_or("Image sequence dimensions overflow")?;
        if self.version != 1
            || !label(&self.shot_id)
            || !label(&self.render_id)
            || self.color_space != "srgb"
            || self.width == 0
            || self.height == 0
            || self.width > LIMITS.max_dimension
            || self.height > LIMITS.max_dimension
            || pixels > LIMITS.max_decoded_bytes
        {
            return Err(
                "Invalid image sequence identity, version, color space or decode dimensions".into(),
            );
        }
        if self.frame_rate.numerator == 0
            || self.frame_rate.numerator > 120_000
            || self.frame_rate.denominator == 0
            || self.frame_rate.denominator > 1001
            || self.frames.is_empty()
            || self.frames.len() > LIMITS.max_frames
            || self
                .first_file_frame
                .checked_add((self.frames.len() - 1) as u64)
                .is_none_or(|n| n > MAX_SAFE)
        {
            return Err(
                "Invalid image sequence frame rate, frame count or first file frame".into(),
            );
        }
        let p = &self.provenance;
        if !label(&p.engine)
            || !label(&p.version)
            || !safe_path(&p.entry_file)
            || p.source_files.is_empty()
            || p.source_files.len() > LIMITS.max_source_files
            || !p.source_files.iter().any(|file| file.path == p.entry_file)
        {
            return Err("Image sequence provenance requires bounded engine/version and an archived entry file".into());
        }
        if !p.parameters.is_object() {
            return Err("Image sequence provenance parameters must be an object".into());
        }
        parameters(&p.parameters, 0, &mut 0, &mut 0)?;
        if serde_json::to_vec(&p.parameters)
            .map_err(|e| e.to_string())?
            .len()
            > LIMITS.max_parameter_bytes
        {
            return Err("Image sequence parameters exceed serialized byte limit".into());
        }
        let mut dependencies = Vec::<&Resource>::new();
        let mut ids = BTreeMap::<&str, &Resource>::new();
        let mut portable_ids = BTreeMap::<String, &str>::new();
        let mut keys = BTreeMap::<&str, &Resource>::new();
        let mut total = 0u64;
        let mut add = |resource: &'a Resource, expected: &str| -> Result<(), String> {
            if resource.kind != expected
                || !safe_path(&resource.id)
                || !validate_resources(std::slice::from_ref(resource)).is_empty()
            {
                return Err("Invalid image sequence dependency kind or descriptor (nested sequences are forbidden)".into());
            }
            if ids
                .get(resource.id.as_str())
                .is_some_and(|previous| **previous != *resource)
            {
                return Err("Conflicting image sequence dependency ID descriptors".into());
            }
            ids.insert(resource.id.as_str(), resource);
            if portable_ids
                .insert(resource.id.to_ascii_lowercase(), resource.id.as_str())
                .is_some_and(|previous| previous != resource.id)
            {
                return Err("Image sequence dependency paths must not differ only by case".into());
            }
            if let Some(previous) = keys.get(resource.attachment_key()) {
                if !same_content(previous, resource) {
                    return Err("Conflicting image sequence attachment descriptors".into());
                }
            } else {
                total = total
                    .checked_add(resource.byte_length())
                    .ok_or("Image sequence closure size overflow")?;
                if total > LIMITS.max_closure_bytes {
                    return Err("Image sequence closure exceeds byte budget".into());
                }
                keys.insert(resource.attachment_key(), resource);
                dependencies.push(resource);
            }
            Ok(())
        };
        for frame in &self.frames {
            add(frame, "image")?;
        }
        add(&p.original_manifest, "source")?;
        let mut source_bytes = p.original_manifest.byte_length();
        let mut part_count = 0usize;
        let mut paths = BTreeSet::new();
        for file in &p.source_files {
            if !safe_path(&file.path)
                || !paths.insert(file.path.to_ascii_lowercase())
                || !digest(&file.sha256)
                || file.byte_length > MAX_SAFE
            {
                return Err(
                    "Invalid or duplicate image sequence source-file path, hash or size".into(),
                );
            }
            source_bytes = source_bytes
                .checked_add(file.byte_length)
                .ok_or("Image sequence source size overflow")?;
            if source_bytes > LIMITS.max_source_bytes {
                return Err("Image sequence source archive exceeds byte budget".into());
            }
            part_count = part_count
                .checked_add(file.parts.len())
                .ok_or("Image sequence source part count overflow")?;
            if part_count > LIMITS.max_source_parts {
                return Err("Image sequence source archive has too many parts".into());
            }
            let mut bytes = 0u64;
            for part in &file.parts {
                add(part, "source")?;
                bytes = bytes
                    .checked_add(part.byte_length())
                    .ok_or("Image sequence source parts size overflow")?;
            }
            if bytes != file.byte_length {
                return Err(
                    "Image sequence source-file parts do not match declared byte length".into(),
                );
            }
        }
        if has_file_parent(paths.iter().map(String::as_str))
            || has_file_parent(portable_ids.keys().map(String::as_str))
        {
            return Err("Image sequence file and directory paths must not collide".into());
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() as u64
            > LIMITS.max_manifest_bytes
        {
            return Err("Image sequence manifest exceeds byte budget".into());
        }
        Ok(dependencies)
    }
}
