use super::model::Color;
use serde::{Deserialize, Serialize};

/// Role-local post remains the default for existing version-1 recipes.
#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PostStage {
    #[default]
    Role,
    Composite,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BloomAlpha {
    Preserve,
    Expand,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Effect {
    LightLeak {
        amount: f64,
        alpha: super::light_leak::Alpha,
        #[serde(default = "super::light_leak::default_speed")]
        speed: f64,
        #[serde(default)]
        seed_offset: u32,
    },
    Invert {
        amount: f64,
    },
    Flash {
        amount: f64,
        color: [f64; 3],
    },
    Fade {
        amount: f64,
    },
    /// Per-side frame-height fraction, not an implicit target aspect ratio.
    Letterbox {
        amount: f64,
        height_fraction: f64,
    },
    /// Static, shared RGB noise before quantization; amount 1 spans one 8-bit LSB.
    QuantizationDither {
        amount: f64,
    },
    Grade {
        exposure: f64,
        contrast: f64,
        saturation: f64,
        lift: [f64; 3],
        gain: [f64; 3],
    },
    /// Luminance gradient map in sRGB, not a 3D LUT.
    Palette {
        colors: Vec<Color>,
        mix: f64,
    },
    Vignette {
        amount: f64,
    },
    Grain {
        amount: f64,
        fps: u32,
    },
    /// Displacement amplitude and noise-cell spacing are output pixels.
    LineBoil {
        amount: f64,
        cell_size: f64,
        fps: u32,
    },
    Glitch {
        amount: f64,
        bands: u32,
        fps: u32,
    },
    ChromaticAberration {
        amount: f64,
        center: [f64; 2],
    },
    ZoomBlur {
        amount: f64,
        center: [f64; 2],
    },
    /// Three downsampled levels. Radius is measured in full-resolution pixels.
    Bloom {
        amount: f64,
        threshold: f64,
        radius: f64,
        alpha: BloomAlpha,
    },
}
