use bridge::export;
use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct ColorAdjustment {
    pub exposure: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
}

fn finite_clamp(value: f32, min: f32, max: f32) -> f32 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        0.0
    }
}

#[export]
pub fn normalize_color_adjustment(params: ColorAdjustment) -> ColorAdjustment {
    ColorAdjustment {
        exposure: finite_clamp(params.exposure, -4.0, 4.0),
        contrast: finite_clamp(params.contrast, -100.0, 100.0),
        saturation: finite_clamp(params.saturation, -100.0, 100.0),
        temperature: finite_clamp(params.temperature, -100.0, 100.0),
        tint: finite_clamp(params.tint, -100.0, 100.0),
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ColorAdjustmentField {
    pub key: String,
    pub label: String,
    pub min: f32,
    pub max: f32,
    pub step: f32,
    pub default: f32,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ColorAdjustmentPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub params: ColorAdjustment,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ColorAdjustmentCatalog {
    pub fields: Vec<ColorAdjustmentField>,
    pub presets: Vec<ColorAdjustmentPreset>,
}

#[export]
pub fn color_adjustment_catalog() -> ColorAdjustmentCatalog {
    let fields = [
        ("exposure", "Exposure (EV)", -4.0, 4.0, 0.1),
        ("contrast", "Contrast", -100.0, 100.0, 1.0),
        ("saturation", "Saturation", -100.0, 100.0, 1.0),
        ("temperature", "Temperature", -100.0, 100.0, 1.0),
        ("tint", "Tint", -100.0, 100.0, 1.0),
    ]
    .into_iter()
    .map(|(key, label, min, max, step)| ColorAdjustmentField {
        key: key.into(),
        label: label.into(),
        min,
        max,
        step,
        default: 0.0,
    })
    .collect();
    let neutral = ColorAdjustment::default();
    let presets = [
        ("neutral", "Neutral", "Start with unchanged colors", neutral),
        (
            "mono",
            "Monochrome",
            "Remove color, keep luminance",
            ColorAdjustment {
                saturation: -100.0,
                ..neutral
            },
        ),
        (
            "warm",
            "Warm",
            "Gentle warmth and contrast",
            ColorAdjustment {
                temperature: 35.0,
                contrast: 8.0,
                ..neutral
            },
        ),
        (
            "cool",
            "Cool",
            "Cooler whites and restrained color",
            ColorAdjustment {
                temperature: -35.0,
                saturation: -10.0,
                ..neutral
            },
        ),
    ]
    .into_iter()
    .map(|(id, name, description, params)| ColorAdjustmentPreset {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        params,
    })
    .collect();
    ColorAdjustmentCatalog { fields, presets }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_neutral_and_clamps_untrusted_parameters() {
        assert_eq!(
            normalize_color_adjustment(ColorAdjustment::default()),
            ColorAdjustment::default()
        );
        let normalized = normalize_color_adjustment(ColorAdjustment {
            exposure: 9.0,
            contrast: -999.0,
            saturation: f32::NAN,
            temperature: f32::INFINITY,
            tint: 101.0,
        });
        assert_eq!(
            normalized,
            ColorAdjustment {
                exposure: 4.0,
                contrast: -100.0,
                saturation: 0.0,
                temperature: 0.0,
                tint: 100.0,
            }
        );
    }
    #[test]
    fn catalog_presets_and_defaults_are_inside_the_declared_ranges() {
        let catalog = color_adjustment_catalog();
        assert_eq!(catalog.fields.len(), 5);
        assert_eq!(catalog.presets.len(), 4);
        for field in catalog.fields {
            assert!(field.min <= field.default && field.default <= field.max);
        }
        for preset in catalog.presets {
            assert_eq!(normalize_color_adjustment(preset.params), preset.params);
        }
    }
}
