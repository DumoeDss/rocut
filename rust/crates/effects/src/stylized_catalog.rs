use bridge::export;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Field {
    pub key: &'static str,
    pub label: &'static str,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub default: f64,
    pub keyframable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Definition {
    pub id: &'static str,
    pub version: u32,
    pub name: &'static str,
    pub animated: bool,
    pub fields: Vec<Field>,
}

fn field(
    key: &'static str,
    label: &'static str,
    min: f64,
    max: f64,
    step: f64,
    default: f64,
) -> Field {
    Field {
        key,
        label,
        min,
        max,
        step,
        default,
        keyframable: key != "seed" && key != "local",
        required: None,
    }
}

fn optical_fields() -> Vec<Field> {
    vec![
        field("amount", "Amount", 0.0, 1.0, 0.01, 1.0),
        field("zoom", "Magnification", 1.0, 8.0, 0.01, 2.0),
        field("refraction", "Dome refraction", 0.0, 1.0, 0.01, 0.0),
        field("dispersion", "Chromatic dispersion", 0.0, 0.1, 0.001, 0.0),
    ]
}

// Native stylized effects and their parameter metadata.
pub(crate) fn definitions() -> Vec<Definition> {
    [
        (
            "vhs",
            "VHS",
            true,
            vec![
                field("amount", "Amount", 0.0, 1.0, 0.01, 0.65),
                field("noise", "Noise", 0.0, 1.0, 0.01, 0.12),
                field("scanlines", "Scanlines", 0.0, 1.0, 0.01, 0.2),
                field("bleed", "Color bleed (pixels)", 0.0, 12.0, 0.1, 2.0),
            ],
        ),
        (
            "glitch",
            "Glitch",
            true,
            vec![
                field("amount", "Amount", 0.0, 1.0, 0.01, 0.65),
                field(
                    "displacement",
                    "Horizontal displacement",
                    0.0,
                    0.25,
                    0.001,
                    0.04,
                ),
                field("bands", "Bands", 1.0, 128.0, 1.0, 24.0),
                field("frequency", "Active band fraction", 0.0, 1.0, 0.01, 0.35),
            ],
        ),
        (
            "retro-dither",
            "Retro Dither",
            false,
            vec![
                field("amount", "Amount", 0.0, 1.0, 0.01, 1.0),
                field("levels", "Levels per channel", 2.0, 16.0, 1.0, 4.0),
                field("cellSize", "Dither cell (pixels)", 1.0, 32.0, 1.0, 2.0),
                field("spread", "Dither spread", 0.0, 1.0, 0.01, 1.0),
            ],
        ),
        (
            "ascii",
            "ASCII",
            false,
            vec![
                field("amount", "Amount", 0.0, 1.0, 0.01, 1.0),
                field("cellSize", "Character width (pixels)", 6.0, 64.0, 1.0, 12.0),
                field(
                    "contrast",
                    "Density contrast (negative inverts)",
                    -2.0,
                    2.0,
                    0.01,
                    1.0,
                ),
                field("color", "Original color", 0.0, 1.0, 0.01, 1.0),
            ],
        ),
        (
            "mono-dither",
            "Monochrome Dither",
            false,
            vec![
                field("amount", "Amount", 0.0, 1.0, 0.01, 1.0),
                field("threshold", "White threshold", 0.0, 1.0, 0.01, 0.5),
                field("cellSize", "Dither cell (pixels)", 1.0, 32.0, 1.0, 2.0),
                field("spread", "Dither spread", 0.0, 1.0, 0.01, 1.0),
            ],
        ),
        ("lens", "Lens", false, optical_fields()),
        ("magnify", "Magnify", false, optical_fields()),
    ]
    .into_iter()
    .map(|(id, name, animated, mut fields)| {
        if !matches!(id, "lens" | "magnify") {
            fields.push(field("seed", "Seed", 0.0, 65535.0, 1.0, 1.0));
        }
        if matches!(id, "ascii" | "retro-dither") {
            fields.push(field("local", "Local region", 0.0, 1.0, 1.0, 0.0));
        }
        if matches!(id, "lens" | "magnify" | "ascii" | "retro-dither") {
            fields.extend([
                field(
                    "centerX",
                    "Center X (width fraction)",
                    -1.0,
                    2.0,
                    0.001,
                    0.5,
                ),
                field(
                    "centerY",
                    "Center Y (height fraction)",
                    -1.0,
                    2.0,
                    0.001,
                    0.5,
                ),
                field(
                    "radius",
                    "Radius (short-side fraction)",
                    0.0,
                    2.0,
                    0.001,
                    0.25,
                ),
                field(
                    "feather",
                    "Edge softness (radius fraction)",
                    0.0,
                    1.0,
                    0.01,
                    0.15,
                ),
            ]);
        }
        if id == "magnify" {
            fields.extend([
                field("hud", "HUD opacity", 0.0, 1.0, 0.01, 0.8),
                field("pulse", "Impulse strength", 0.0, 1.0, 0.01, 0.0),
                field("lineWidth", "HUD line width (pixels)", 0.5, 8.0, 0.1, 1.5),
            ]);
        }
        if matches!(id, "ascii" | "retro-dither") {
            for field in &mut fields {
                if matches!(
                    field.key,
                    "local" | "centerX" | "centerY" | "radius" | "feather"
                ) {
                    field.required = Some(false);
                }
            }
        }
        Definition {
            id,
            version: 1,
            name,
            animated,
            fields,
        }
    })
    .chain(std::iter::once(crate::displacement::definition()))
    .chain(std::iter::once(crate::laser::definition()))
    .chain(std::iter::once(crate::decrypt_reveal::definition()))
    .chain(crate::wave_catalog::definitions())
    .chain(std::iter::once(crate::liquid_catalog::definition()))
    .chain(std::iter::once(crate::droplets::definition()))
    .chain(std::iter::once(crate::clouds::definition()))
    .collect()
}

#[export]
pub fn stylized_effect_catalog_json() -> String {
    serde_json::to_string(&definitions()).expect("finite static effect catalog")
}
