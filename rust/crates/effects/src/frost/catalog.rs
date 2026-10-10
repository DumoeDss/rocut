use super::strokes::{MAX_FROST_STROKES, MAX_FROST_TICKS};
use crate::stylized_catalog::{Definition, Field};

macro_rules! slot {
    ($n:literal) => {
        [
            concat!("stroke", $n, "TimeTicks"),
            concat!("stroke", $n, "FromX"),
            concat!("stroke", $n, "FromY"),
            concat!("stroke", $n, "ToX"),
            concat!("stroke", $n, "ToY"),
            concat!("stroke", $n, "Radius"),
            concat!("stroke", $n, "Strength"),
        ]
    };
}
pub(super) const STROKE_KEYS: [[&str; 7]; MAX_FROST_STROKES] = [
    slot!("0"),
    slot!("1"),
    slot!("2"),
    slot!("3"),
    slot!("4"),
    slot!("5"),
    slot!("6"),
    slot!("7"),
    slot!("8"),
    slot!("9"),
    slot!("10"),
    slot!("11"),
    slot!("12"),
    slot!("13"),
    slot!("14"),
    slot!("15"),
];
fn field(key: &'static str, label: &'static str, range: [f64; 4], keyframable: bool) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable,
        required: None,
    }
}
pub(super) fn optical_fields() -> Vec<Field> {
    vec![
        field("amount", "Amount", [0.0, 1.0, 0.01, 1.0], true),
        field("coverage", "Frost coverage", [0.0, 1.0, 0.01, 0.8], true),
        field(
            "scale",
            "Crystal cells per short side",
            [4.0, 256.0, 0.1, 32.0],
            true,
        ),
        field(
            "blur",
            "Scattering radius (short-side fraction)",
            [0.0, 0.05, 0.001, 0.012],
            true,
        ),
        field(
            "refraction",
            "Refraction (short-side fraction)",
            [0.0, 0.05, 0.001, 0.004],
            true,
        ),
        field(
            "tintStrength",
            "Ice tint strength",
            [0.0, 1.0, 0.01, 0.2],
            true,
        ),
        field("tintR", "Ice red", [0.0, 1.0, 0.01, 0.8], true),
        field("tintG", "Ice green", [0.0, 1.0, 0.01, 0.9], true),
        field("tintB", "Ice blue", [0.0, 1.0, 0.01, 1.0], true),
        field(
            "seed",
            "Spatial crystal seed (exact 24-bit)",
            [0.0, 16777215.0, 1.0, 17.0],
            false,
        ),
    ]
}
pub(crate) fn definition() -> Definition {
    let mut fields = optical_fields();
    fields.extend([
        field(
            "holdTicks",
            "Melt hold (ticks)",
            [0.0, 3600000.0, 1.0, 0.0],
            false,
        ),
        field(
            "recoveryTicks",
            "Linear refreeze (ticks)",
            [1.0, 3600000.0, 1.0, 120000.0],
            false,
        ),
        field(
            "strokeCount",
            "Authored capsule strokes",
            [0.0, 16.0, 1.0, 0.0],
            false,
        ),
    ]);
    for keys in STROKE_KEYS {
        for (component, key) in keys.into_iter().enumerate() {
            let range = match component {
                0 => [0.0, MAX_FROST_TICKS as f64, 1.0, 0.0],
                1..=4 => [-1.0, 2.0, 0.001, 0.5],
                5 => [0.005, 0.5, 0.001, 0.1],
                _ => [0.0, 1.0, 0.01, 1.0],
            };
            let mut entry = field(key, key, range, false);
            entry.required = Some(false);
            fields.push(entry);
        }
    }
    Definition {
        id: "frost",
        version: 1,
        name: "Frost",
        animated: true,
        fields,
    }
}
