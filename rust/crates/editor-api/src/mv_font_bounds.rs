//! Exact whole-string ink facts at explicitly requested Canvas settings.
//! No scaling, Unicode normalization or fallback to legacy 100px glyph facts.
use super::{Bounds, Measurement, Request};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_BOUNDS: usize = 1024;
const MAX_TEXT_SCALARS: usize = 1024;
const MAX_TOTAL_SCALARS: usize = 65536;
const MAX_EXTENT: f64 = 16777216.0;
pub(super) type Key = (String, u8, String, u64, u64, TextAlign, TextBaseline);

/// Physical alignment only; the platform measurement context has direction=ltr.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextBaseline {
    Top,
    Hanging,
    Middle,
    Alphabetic,
    Ideographic,
    Bottom,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BoundsRequest {
    pub(crate) version: u8,
    pub(crate) text: String,
    pub(crate) font_size_px: f64,
    pub(crate) letter_spacing_px: f64,
    pub(crate) align: TextAlign,
    pub(crate) baseline: TextBaseline,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BoundsMeasurement {
    pub(crate) version: u8,
    pub(crate) text: String,
    pub(crate) font_size_px: f64,
    pub(crate) letter_spacing_px: f64,
    pub(crate) align: TextAlign,
    pub(crate) baseline: TextBaseline,
    pub(crate) left: f64,
    pub(crate) right: f64,
    pub(crate) ascent: f64,
    pub(crate) descent: f64,
}

fn key(
    font_id: &str,
    version: u8,
    text: &str,
    size: f64,
    tracking: f64,
    align: TextAlign,
    baseline: TextBaseline,
) -> Result<Key, String> {
    if version != 1
        || text.chars().count() > MAX_TEXT_SCALARS
        || !size.is_finite()
        || !(0.0 < size && size <= 4096.0)
        || !tracking.is_finite()
        || tracking.abs() > 4096.0
    {
        return Err(
            "Font bounds require version 1 and bounded Unicode strings, size and tracking".into(),
        );
    }
    let tracking = if tracking == 0.0 { 0.0 } else { tracking };
    Ok((
        font_id.into(),
        version,
        text.into(),
        size.to_bits(),
        tracking.to_bits(),
        align,
        baseline,
    ))
}

impl BoundsRequest {
    pub(super) fn key(&self, font_id: &str) -> Result<Key, String> {
        key(
            font_id,
            self.version,
            &self.text,
            self.font_size_px,
            self.letter_spacing_px,
            self.align,
            self.baseline,
        )
    }
}

pub(super) fn validate_requests(requests: &[Request]) -> Result<(), String> {
    let mut count = 0usize;
    let mut scalars = 0usize;
    for request in requests {
        let mut unique = BTreeSet::new();
        for bounds in &request.bounds {
            count = count.saturating_add(1);
            scalars = scalars.saturating_add(bounds.text.chars().count());
            if count > MAX_BOUNDS || scalars > MAX_TOTAL_SCALARS {
                return Err("Font bounds exceed the global measurement/text budget".into());
            }
            if !unique.insert(bounds.key(&request.resource.id)?) {
                return Err("Duplicate font bounds request".into());
            }
        }
    }
    Ok(())
}

pub(super) fn collect(
    request: &Request,
    measured: &Measurement,
    output: &mut BTreeMap<Key, Bounds>,
) -> Result<(), String> {
    if measured.bounds.len() != request.bounds.len() {
        return Err("Font bounds set has missing/extra measurements".into());
    }
    let expected = request
        .bounds
        .iter()
        .map(|a| a.key(&request.resource.id))
        .collect::<Result<BTreeSet<_>, _>>()?;
    for a in &measured.bounds {
        let key = key(
            &request.resource.id,
            a.version,
            &a.text,
            a.font_size_px,
            a.letter_spacing_px,
            a.align,
            a.baseline,
        )?;
        let extents = [a.left, a.right, a.ascent, a.descent];
        if !expected.contains(&key)
            || extents
                .iter()
                .any(|v| !v.is_finite() || v.abs() > MAX_EXTENT)
            || a.left + a.right < 0.0
            || a.ascent + a.descent < 0.0
            // Empty text may retain equal/opposite native baseline offsets.
            // Preserve the exact facts while still requiring zero ink size.
            || (a.text.is_empty() && (a.left + a.right != 0.0 || a.ascent + a.descent != 0.0))
        {
            return Err("Invalid or unrequested font bounds measurement".into());
        }
        let bounds = Bounds {
            left: a.left,
            right: a.right,
            ascent: a.ascent,
            descent: a.descent,
        };
        if output.insert(key, bounds).is_some() {
            return Err("Duplicate measured font bounds".into());
        }
    }
    Ok(())
}
