use super::{model::*, validate::same_content};
use crate::programmatic_resources::Resource;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
};

pub struct Context<'a> {
    manifests: BTreeMap<&'a str, (&'a Resource, &'a Manifest)>,
    selected: RefCell<BTreeMap<String, SequenceImage>>,
}

impl<'a> Context<'a> {
    pub fn new(resources: &'a [Resource], inputs: &'a [ManifestInput]) -> Result<Self, String> {
        let declared: Vec<_> = resources
            .iter()
            .filter(|r| r.kind == "imageSequence")
            .collect();
        if declared.len() > LIMITS.max_manifests || inputs.len() != declared.len() {
            return Err(
                "Image sequence manifests must exactly cover declared resources (maximum 8)".into(),
            );
        }
        let mut manifests = BTreeMap::new();
        let mut closure = BTreeMap::<&str, &Resource>::new();
        let mut dimensions = BTreeMap::new();
        let mut total = 0u64;
        let mut sources = 0u64;
        for input in inputs {
            let resource = declared
                .iter()
                .find(|r| r.id == input.resource_id)
                .ok_or("Unexpected image sequence manifest resource ID")?;
            if manifests
                .insert(resource.id.as_str(), (*resource, &input.manifest))
                .is_some()
            {
                return Err("Duplicate image sequence manifest resource ID".into());
            }
            let dependencies = input.manifest.validate()?;
            for frame in &input.manifest.frames {
                let shape = (input.manifest.width, input.manifest.height);
                if dimensions
                    .insert(frame.attachment_key(), shape)
                    .is_some_and(|previous| previous != shape)
                {
                    return Err("Image sequence content has conflicting declared dimensions".into());
                }
            }
            for dependency in dependencies.into_iter().chain(std::iter::once(*resource)) {
                if let Some(previous) = closure.get(dependency.attachment_key()) {
                    if !same_content(previous, dependency) {
                        return Err(
                            "Conflicting image sequence closure attachment descriptors".into()
                        );
                    }
                    continue;
                }
                total = total
                    .checked_add(dependency.byte_length())
                    .ok_or("Image sequence closure size overflow")?;
                if dependency.kind == "source" {
                    sources = sources
                        .checked_add(dependency.byte_length())
                        .ok_or("Image sequence source size overflow")?;
                }
                if total > LIMITS.max_closure_bytes || sources > LIMITS.max_source_bytes {
                    return Err(
                        "Image sequence aggregate closure or source byte budget exceeded".into(),
                    );
                }
                closure.insert(dependency.attachment_key(), dependency);
            }
        }
        Ok(Self {
            manifests,
            selected: RefCell::new(BTreeMap::new()),
        })
    }

    pub fn sample(
        &self,
        id: &str,
        source_ticks: u64,
        origin: i64,
        rate: Rate,
    ) -> Result<String, String> {
        if source_ticks > MAX_SAFE || origin.unsigned_abs() > MAX_SAFE || !rate.valid_playback() {
            return Err("Invalid image sequence playback clock or rational rate".into());
        }
        let (descriptor, manifest) = self
            .manifests
            .get(id)
            .ok_or("Missing image sequence manifest")?;
        let numerator = i128::from(source_ticks)
            .checked_sub(i128::from(origin))
            .and_then(|v| v.checked_mul(i128::from(rate.numerator)))
            .and_then(|v| v.checked_mul(i128::from(manifest.frame_rate.numerator)))
            .ok_or("Image sequence frame numerator overflow")?;
        let denominator = 120_000i128
            .checked_mul(i128::from(rate.denominator))
            .and_then(|v| v.checked_mul(i128::from(manifest.frame_rate.denominator)))
            .filter(|v| *v > 0)
            .ok_or("Image sequence frame denominator overflow")?;
        // One signed floor, after both rational clocks. firstFileFrame is an
        // external filename convention, never an offset in this time domain.
        let ordinal = numerator
            .div_euclid(denominator)
            .clamp(0, (manifest.frames.len() - 1) as i128) as usize;
        let image_key = format!(
            "image-sequence:{}:{}:{}",
            descriptor.id,
            descriptor.sha256(),
            ordinal
        );
        let mut selected = self.selected.borrow_mut();
        if !selected.contains_key(&image_key) {
            let bytes = u64::from(manifest.width)
                .checked_mul(u64::from(manifest.height))
                .and_then(|v| v.checked_mul(4))
                .ok_or("Image sequence frame decode size overflow")?;
            let mut seen = BTreeSet::new();
            let total = selected.values().try_fold(0u64, |total, image| {
                if !seen.insert(image.resource.attachment_key()) {
                    return Ok(total);
                }
                u64::from(image.width)
                    .checked_mul(u64::from(image.height))
                    .and_then(|v| v.checked_mul(4))
                    .and_then(|v| total.checked_add(v))
                    .ok_or("Image sequence aggregate decode size overflow")
            })?;
            let total = if seen.insert(manifest.frames[ordinal].attachment_key()) {
                total
                    .checked_add(bytes)
                    .ok_or("Image sequence aggregate decode size overflow")?
            } else {
                total
            };
            if total > LIMITS.max_decoded_bytes {
                return Err("Image sequence current-frame decode budget exceeded".into());
            }
            selected.insert(
                image_key.clone(),
                SequenceImage {
                    image_key: image_key.clone(),
                    manifest_id: descriptor.id.clone(),
                    manifest_sha256: descriptor.sha256().to_string(),
                    ordinal,
                    resource: manifest.frames[ordinal].clone(),
                    width: manifest.width,
                    height: manifest.height,
                    alpha: manifest.alpha,
                },
            );
        }
        Ok(image_key)
    }

    pub fn into_images(self) -> Vec<SequenceImage> {
        self.selected.into_inner().into_values().collect()
    }
}
