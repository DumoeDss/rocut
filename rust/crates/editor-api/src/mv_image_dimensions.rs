//! Transient decoded-image facts. Only platform decode produces these facts;
//! authored scenes contain resource references, never purported image sizes.
use crate::{image_sequence::LIMITS, programmatic_resources::Resource};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[path = "mv_image_dimensions/admission.rs"]
mod admission;
pub use admission::inspect_programmatic_image_bytes;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) resource: Resource,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Measurement {
    pub(crate) resource: Resource,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Dimensions {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// Deduplicate the caller's residency/geometry requirements. A complete recipe
/// supplies all resident declared images; individual producers may request only
/// their own images. No author-facing request flag can bypass this internal list.
pub(crate) fn requests(resources: &[Resource], ids: &[&str]) -> Result<Vec<Request>, String> {
    // A scene without dimension requirements must retain its existing validation
    // behavior. Source still owns unconditional resource admission separately.
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    if let Some(issue) = crate::programmatic_resources::validate(resources).first() {
        return Err(issue.message.clone());
    }
    ids.iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|id| {
            let resource = resources
                .iter()
                .find(|r| r.id == id && r.kind == "image")
                .ok_or("Image dimensions require a declared image resource")?;
            Ok(Request {
                resource: resource.clone(),
            })
        })
        .collect()
}

pub(crate) struct Context {
    dimensions: BTreeMap<String, Dimensions>,
}

impl Context {
    pub(crate) fn new(requests: &[Request], measured: &[Measurement]) -> Result<Self, String> {
        if requests.len() > 64 || measured.len() != requests.len() {
            return Err(
                "Image dimension facts have missing/extra resources or exceed limits".into(),
            );
        }
        let mut expected = BTreeMap::new();
        for request in requests {
            if request.resource.kind != "image"
                || expected
                    .insert(request.resource.id.as_str(), &request.resource)
                    .is_some()
            {
                return Err("Image dimension requests require unique declared images".into());
            }
        }
        let mut dimensions = BTreeMap::new();
        let mut decoded_bytes = 0u64;
        for measured in measured {
            let resource = expected
                .get(measured.resource.id.as_str())
                .ok_or("Unexpected measured image")?;
            if *resource != &measured.resource {
                return Err("Image dimension identity does not match the full declaration".into());
            }
            decoded_bytes = decoded_bytes
                .checked_add(crate::image_sequence::decoded_image_bytes(
                    measured.width,
                    measured.height,
                )?)
                .ok_or("Image dimension budget overflow")?;
            if decoded_bytes > LIMITS.max_decoded_bytes {
                return Err("Image dimension facts exceed the combined decode budget".into());
            }
            if dimensions
                .insert(
                    measured.resource.id.clone(),
                    Dimensions {
                        width: measured.width,
                        height: measured.height,
                    },
                )
                .is_some()
            {
                return Err("Duplicate measured image".into());
            }
        }
        Ok(Self { dimensions })
    }

    pub(crate) fn image(&self, id: &str) -> Result<Dimensions, String> {
        self.dimensions
            .get(id)
            .copied()
            .ok_or_else(|| "Missing decoded image dimensions".into())
    }
}

#[cfg(test)]
#[path = "mv_image_dimensions/tests.rs"]
mod tests;
