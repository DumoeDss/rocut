//! Platform glyph facts, bound to complete declared font identities. Layout and
//! animation stay in Rust; these transient measurements are never author data.
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[path = "mv_font_advance.rs"]
mod advance;
pub(crate) use advance::AdvanceRequest;
#[path = "mv_font_bounds.rs"]
mod bounds;
pub(crate) use bounds::{BoundsRequest, TextAlign, TextBaseline};

pub(crate) const MAX_GLYPHS: usize = 1024;
const MAX_BOUND: f64 = 4096.0;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) resource: Resource,
    pub(crate) glyphs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) advances: Vec<AdvanceRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) bounds: Vec<BoundsRequest>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Measurement {
    pub(crate) resource: Resource,
    pub(crate) glyphs: Vec<GlyphMeasurement>,
    #[serde(default)]
    pub(crate) advances: Vec<advance::AdvanceMeasurement>,
    #[serde(default)]
    pub(crate) bounds: Vec<bounds::BoundsMeasurement>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GlyphMeasurement {
    text: String,
    left: f64,
    right: f64,
    ascent: f64,
    descent: f64,
}

/// Raw Canvas actualBoundingBox values at the associated request settings.
/// Legacy glyph facts alone are fixed at 100px, center/middle, no tracking.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Bounds {
    pub(crate) left: f64,
    pub(crate) right: f64,
    pub(crate) ascent: f64,
    pub(crate) descent: f64,
}

pub(crate) struct Context {
    glyphs: BTreeMap<(String, String), Bounds>,
    advances: BTreeMap<advance::Key, f64>,
    bounds: BTreeMap<bounds::Key, Bounds>,
}

impl Context {
    pub(crate) fn new(requests: &[Request], measured: &[Measurement]) -> Result<Self, String> {
        let count: usize = requests.iter().map(|r| r.glyphs.len()).sum();
        if count > MAX_GLYPHS || requests.len() > 64 || measured.len() != requests.len() {
            return Err("Font metric requests exceed limits or have missing/extra fonts".into());
        }
        advance::validate_requests(requests)?;
        bounds::validate_requests(requests)?;
        let mut expected = BTreeMap::new();
        for request in requests {
            if request.resource.kind != "font"
                || (request.glyphs.is_empty()
                    && request.advances.is_empty()
                    && request.bounds.is_empty())
                || expected
                    .insert(request.resource.id.as_str(), request)
                    .is_some()
            {
                return Err("Font metric requests require unique declared fonts and glyphs".into());
            }
            let mut unique = BTreeSet::new();
            for text in &request.glyphs {
                if text.chars().count() != 1 || !unique.insert(text) {
                    return Err("Font metric requests require unique Unicode scalars".into());
                }
            }
        }
        let mut fonts = BTreeSet::new();
        let mut glyphs = BTreeMap::new();
        let mut advances = BTreeMap::new();
        let mut bounds = BTreeMap::new();
        for measurement in measured {
            let id = measurement.resource.id.as_str();
            let request = expected.get(id).ok_or("Unexpected measured font")?;
            if !fonts.insert(id)
                || measurement.resource != request.resource
                || measurement.glyphs.len() != request.glyphs.len()
            {
                return Err(
                    "Font measurement identity or glyph set does not match the request".into(),
                );
            }
            advance::collect(request, measurement, &mut advances)?;
            bounds::collect(request, measurement, &mut bounds)?;
            for glyph in &measurement.glyphs {
                if !request.glyphs.contains(&glyph.text)
                    || [glyph.left, glyph.right, glyph.ascent, glyph.descent]
                        .iter()
                        .any(|v| !v.is_finite() || v.abs() > MAX_BOUND)
                    || glyph.left + glyph.right < 0.0
                    || glyph.ascent + glyph.descent < 0.0
                {
                    return Err(
                        "Invalid glyph measurement: expected bounded finite ink extents".into(),
                    );
                }
                let bounds = Bounds {
                    left: glyph.left,
                    right: glyph.right,
                    ascent: glyph.ascent,
                    descent: glyph.descent,
                };
                if glyphs
                    .insert((id.to_owned(), glyph.text.clone()), bounds)
                    .is_some()
                {
                    return Err("Duplicate measured glyph".into());
                }
            }
        }
        Ok(Self {
            glyphs,
            advances,
            bounds,
        })
    }

    pub(crate) fn glyph(&self, font_id: &str, text: &str) -> Result<Bounds, String> {
        self.glyphs
            .get(&(font_id.to_owned(), text.to_owned()))
            .copied()
            .ok_or_else(|| "Missing declared font glyph measurement".into())
    }

    pub(crate) fn advance(
        &self,
        font_id: &str,
        text: &str,
        font_size_px: f64,
        letter_spacing_px: f64,
    ) -> Result<f64, String> {
        self.advances
            .get(&advance::key(
                font_id,
                text,
                font_size_px,
                letter_spacing_px,
            )?)
            .copied()
            .ok_or_else(|| "Missing declared font advance measurement".into())
    }

    /// Exact requested-size facts only; legacy glyphs never satisfy this lookup.
    pub(crate) fn bounds(&self, font_id: &str, request: &BoundsRequest) -> Result<Bounds, String> {
        self.bounds
            .get(&request.key(font_id)?)
            .copied()
            .ok_or_else(|| "Missing declared exact font bounds measurement".into())
    }
}

#[cfg(test)]
#[path = "mv_font_metrics_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mv_font_advance_tests.rs"]
mod advance_tests;

#[cfg(test)]
#[path = "mv_font_bounds_tests.rs"]
mod bounds_tests;

#[cfg(test)]
#[path = "mv_font_bounds_validation_tests.rs"]
mod bounds_validation_tests;

#[cfg(test)]
#[path = "mv_font_bounds_test_support.rs"]
mod bounds_test_support;
