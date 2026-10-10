use super::{CanvasConfig, CanvasError, CanvasStroke, MAX_STROKES, validate};
use std::collections::BTreeMap;

const CONFIG_KEYS: [&str; 14] = [
    "columns",
    "rows",
    "durationTicks",
    "seed",
    "drying",
    "diffusion",
    "weaveFrequency",
    "weaveHeight",
    "lightX",
    "lightY",
    "lightZ",
    "relief",
    "strokeCount",
    "version",
];
const SLOT_KEYS: [&str; 11] = [
    "StartTicks",
    "EndTicks",
    "FromX",
    "FromY",
    "ToX",
    "ToY",
    "Radius",
    "Bristles",
    "Opacity",
    "Wetness",
    "Thickness",
];

fn number(p: &BTreeMap<String, f64>, key: &str) -> Result<f64, CanvasError> {
    p.get(key)
        .copied()
        .filter(|v| v.is_finite())
        .ok_or(CanvasError(
            "Canvas requires complete finite numeric fields",
        ))
}
fn integer(p: &BTreeMap<String, f64>, key: &str, max: u64) -> Result<u64, CanvasError> {
    let v = number(p, key)?;
    if v < 0.0 || v > max as f64 || v.fract() != 0.0 {
        return Err(CanvasError(
            "Canvas integer field is unsafe or out of range",
        ));
    }
    Ok(v as u64)
}

/// Strict numeric DTO seam. All configuration and active stroke fields required;
/// no defaults, normalization, inferred trajectory, or inactive slot acceptance.
pub fn parse(p: &BTreeMap<String, f64>) -> Result<(CanvasConfig, Vec<CanvasStroke>), CanvasError> {
    if integer(p, "version", 1)? != 1 {
        return Err(CanvasError("Unsupported Canvas parameter version"));
    }
    let count = integer(p, "strokeCount", MAX_STROKES as u64)? as usize;
    for key in p.keys() {
        if CONFIG_KEYS.contains(&key.as_str()) {
            continue;
        }
        if !(0..count).any(|index| {
            SLOT_KEYS
                .iter()
                .any(|suffix| key == &format!("stroke{index}{suffix}"))
        }) {
            return Err(CanvasError(
                "Unknown Canvas parameter or inactive stroke slot",
            ));
        }
    }
    let c = CanvasConfig {
        columns: integer(p, "columns", 128)? as u32,
        rows: integer(p, "rows", 128)? as u32,
        duration_ticks: integer(p, "durationTicks", super::MAX_DURATION_TICKS)?,
        seed: integer(p, "seed", 16_777_215)? as u32,
        drying: number(p, "drying")?,
        diffusion: number(p, "diffusion")?,
        weave_frequency: number(p, "weaveFrequency")?,
        weave_height: number(p, "weaveHeight")?,
        light: [
            number(p, "lightX")?,
            number(p, "lightY")?,
            number(p, "lightZ")?,
        ],
        relief: number(p, "relief")?,
    };
    // Validate size and coefficients before allocating the bounded schedule.
    validate(&c, &[])?;
    let mut strokes = Vec::with_capacity(count);
    for i in 0..count {
        let key = |suffix: &str| format!("stroke{i}{suffix}");
        strokes.push(CanvasStroke {
            start_ticks: integer(p, &key("StartTicks"), super::MAX_DURATION_TICKS)?,
            end_ticks: integer(p, &key("EndTicks"), super::MAX_DURATION_TICKS)?,
            from: [number(p, &key("FromX"))?, number(p, &key("FromY"))?],
            to: [number(p, &key("ToX"))?, number(p, &key("ToY"))?],
            radius: number(p, &key("Radius"))?,
            bristles: integer(p, &key("Bristles"), 32)? as u32,
            opacity: number(p, &key("Opacity"))?,
            wetness: number(p, &key("Wetness"))?,
            thickness: number(p, &key("Thickness"))?,
        });
    }
    validate(&c, &strokes)?;
    Ok((c, strokes))
}
