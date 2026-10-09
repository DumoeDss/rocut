//! Whole-string Canvas advance facts. Prefixes are separate complete strings;
//! neither this bridge nor its rasterizer synthesizes widths from glyph facts.
use super::{Measurement, Request};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_ADVANCES: usize = 1024;
const MAX_TEXT_SCALARS: usize = 1024;
const MAX_TOTAL_SCALARS: usize = 65536;
const MAX_WIDTH: f64 = 16777216.0;
pub(super) type Key = (String, String, u64, u64);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AdvanceRequest {
    pub(crate) text: String,
    pub(crate) font_size_px: f64,
    pub(crate) letter_spacing_px: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AdvanceMeasurement {
    pub(crate) text: String,
    pub(crate) font_size_px: f64,
    pub(crate) letter_spacing_px: f64,
    pub(crate) width: f64,
}

pub(super) fn key(
    font_id: &str,
    text: &str,
    font_size_px: f64,
    letter_spacing_px: f64,
) -> Result<Key, String> {
    if text.chars().count() > MAX_TEXT_SCALARS
        || !font_size_px.is_finite()
        || !(0.0 < font_size_px && font_size_px <= 4096.0)
        || !letter_spacing_px.is_finite()
        || letter_spacing_px.abs() > 4096.0
    {
        return Err("Font advances require bounded Unicode strings, size and tracking".into());
    }
    // JSON -0 and 0 identify the same tracking, not two independent facts.
    let tracking = if letter_spacing_px == 0.0 {
        0.0
    } else {
        letter_spacing_px
    };
    Ok((
        font_id.into(),
        text.into(),
        font_size_px.to_bits(),
        tracking.to_bits(),
    ))
}

pub(super) fn validate_requests(requests: &[Request]) -> Result<(), String> {
    let mut count = 0usize;
    let mut scalars = 0usize;
    for request in requests {
        let mut unique = BTreeSet::new();
        for advance in &request.advances {
            count += 1;
            scalars = scalars.saturating_add(advance.text.chars().count());
            if count > MAX_ADVANCES || scalars > MAX_TOTAL_SCALARS {
                return Err("Font advances exceed the global measurement/text budget".into());
            }
            if !unique.insert(key(
                &request.resource.id,
                &advance.text,
                advance.font_size_px,
                advance.letter_spacing_px,
            )?) {
                return Err("Duplicate font advance request".into());
            }
        }
    }
    Ok(())
}

pub(super) fn collect(
    request: &Request,
    measured: &Measurement,
    output: &mut BTreeMap<Key, f64>,
) -> Result<(), String> {
    if measured.advances.len() != request.advances.len() {
        return Err("Font advance set has missing/extra measurements".into());
    }
    let expected = request
        .advances
        .iter()
        .map(|a| {
            key(
                &request.resource.id,
                &a.text,
                a.font_size_px,
                a.letter_spacing_px,
            )
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    for a in &measured.advances {
        let key = key(
            &request.resource.id,
            &a.text,
            a.font_size_px,
            a.letter_spacing_px,
        )?;
        if !expected.contains(&key)
            || !a.width.is_finite()
            || a.width.abs() > MAX_WIDTH
            || (a.text.is_empty() && a.width != 0.0)
        {
            return Err("Invalid or unrequested font advance measurement".into());
        }
        if output.insert(key, a.width).is_some() {
            return Err("Duplicate measured font advance".into());
        }
    }
    Ok(())
}
