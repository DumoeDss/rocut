use super::model::{Color, Ease, Span};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entrance {
    pub span: Span,
    pub easing: Ease,
    /// Offset in frame width/height units; scale and opacity are multipliers.
    pub offset: [f64; 2],
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wave {
    /// Displacement in rendered sprite-height units, before rotation/flip.
    pub amplitude: f64,
    pub from: f64,
    pub cycles: f64,
    pub frequency: f64,
    pub phase: f64,
    pub strips: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Underlay {
    pub color: Color,
    /// Screen-aligned offset in frame width/height units.
    pub offset: [f64; 2],
    /// Gaussian blur in output short-side units. Zero means a hard cel edge.
    pub blur: f64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Glow {
    pub color: Color,
    /// Screen-aligned center relative to the anchor, in sprite-height units.
    pub offset: [f64; 2],
    pub radius: f64,
}

#[derive(Serialize)]
pub struct Slice {
    pub start: f64,
    pub end: f64,
    pub offset: f64,
}
