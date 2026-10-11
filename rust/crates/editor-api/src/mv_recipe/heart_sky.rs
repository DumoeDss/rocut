//! Retained original skyBuild preparation, bound to one explicit admitted source descriptor.
use super::{BackgroundFact, Sample, sky_geometry, sky_night_data, sky_plan};
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    pub bg: String,
    pub char: String,
    #[serde(default)]
    pub night: Option<String>,
    #[serde(default)]
    pub seed: Option<u32>,
    #[serde(default)]
    pub impact: Option<[f64; 2]>,
    #[serde(default)]
    pub release_beat: Option<u32>,
    #[serde(default)]
    pub bands: Option<u32>,
    #[serde(default)]
    pub char_x: Option<f64>,
    #[serde(default)]
    pub char_h: Option<f64>,
}
pub struct Session {
    pub(super) source: Resource,
    pub(super) dimensions: [u32; 2],
    pub(super) seed: u32,
    pub(super) impact: [f64; 2],
    pub(super) night_color: super::draw::Color,
    pub(super) pieces: Vec<sky_geometry::Piece>,
    pub(super) night: sky_night_data::Night,
}
impl Session {
    /// Source encoded hash and native dimensions are independently verified by the owning provider.
    /// Reserve worst-case fracture growth before allocating geometry or night vectors.
    pub fn prepare(
        source: Resource,
        width: u32,
        height: u32,
        seed: u32,
        impact: [f64; 2],
        night: &str,
        max_bytes: usize,
    ) -> Result<Self, String> {
        if let Some(issue) =
            crate::programmatic_resources::validate(std::slice::from_ref(&source)).first()
        {
            return Err(issue.message.clone());
        }
        if source.kind != "image" {
            return Err("Sky source must be an explicit image".into());
        }
        let decoded = crate::image_sequence::decoded_image_bytes(width, height)?;
        // <=340 cells; <=22 shared paths/cell; each jagged path <=180 points.
        // 96MiB bounds vector growth, shared-edge clones, retained cells and temporaries.
        // Fixed 110/6000/1600/55 night records fit in the additional 2MiB allowance.
        let reserved = decoded
            .checked_mul(2)
            .and_then(|v| v.checked_add(source.byte_length()))
            .and_then(|v| v.checked_add(98 * 1024 * 1024))
            .ok_or("Sky preparation residency overflow")?;
        if reserved > (max_bytes as u64).min(256 * 1024 * 1024) {
            return Err("Sky preparation exceeds admission ceiling".into());
        }
        let night_color = night_color(night)?;
        let pieces = sky_geometry::build(seed, impact).map_err(str::to_owned)?;
        let night = sky_night_data::build(seed);
        Ok(Self {
            source,
            dimensions: [width, height],
            seed,
            impact,
            night_color,
            pieces,
            night,
        })
    }
    pub fn frame(
        &self,
        a: &Args,
        s: &Sample<'_>,
        character: &BackgroundFact<'_>,
    ) -> Result<sky_plan::Plan, String> {
        super::sky_producer::frame(self, a, s, character)
    }
}
pub(super) fn night_color(s: &str) -> Result<super::draw::Color, String> {
    // Bounded authored CSS hex colours; reject unsupported syntax rather than guessing.
    let hex = s
        .strip_prefix('#')
        .ok_or("Sky night requires a CSS hex colour")?;
    if !matches!(hex.len(), 3 | 4 | 6 | 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid sky night colour".into());
    }
    let short = hex.len() <= 4;
    let step = if short { 1 } else { 2 };
    let mut c = [0.0, 0.0, 0.0, 1.0];
    for (i, start) in (0..hex.len()).step_by(step).enumerate() {
        let n = u8::from_str_radix(&hex[start..start + step], 16)
            .map_err(|_| "Invalid sky night colour")?;
        c[i] = if short {
            n as f64 * 17.0 / 255.0
        } else {
            n as f64 / 255.0
        };
    }
    Ok(c)
}
