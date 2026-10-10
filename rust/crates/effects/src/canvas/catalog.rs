use super::{MAX_DURATION_TICKS, MAX_STROKES};
use crate::stylized_catalog::{Definition, Field};

macro_rules! slot {
    ($n:literal) => {
        [
            concat!("stroke", $n, "StartTicks"),
            concat!("stroke", $n, "EndTicks"),
            concat!("stroke", $n, "FromX"),
            concat!("stroke", $n, "FromY"),
            concat!("stroke", $n, "ToX"),
            concat!("stroke", $n, "ToY"),
            concat!("stroke", $n, "Radius"),
            concat!("stroke", $n, "Bristles"),
            concat!("stroke", $n, "Opacity"),
            concat!("stroke", $n, "Wetness"),
            concat!("stroke", $n, "Thickness"),
        ]
    };
}
pub(super) const STROKE_KEYS: [[&str; 11]; MAX_STROKES] = [
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
fn field(key: &'static str, label: &'static str, range: [f64; 4], required: bool) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: false,
        required: Some(required),
    }
}
pub(crate) fn definition() -> Definition {
    let mut fields = vec![
        field(
            "version",
            "Canvas parameter version",
            [1.0, 1.0, 1.0, 1.0],
            true,
        ),
        field(
            "columns",
            "Material grid columns",
            [8.0, 128.0, 1.0, 32.0],
            true,
        ),
        field("rows", "Material grid rows", [8.0, 128.0, 1.0, 32.0], true),
        field(
            "durationTicks",
            "Material replay duration (ticks)",
            [1.0, MAX_DURATION_TICKS as f64, 1.0, 120000.0],
            true,
        ),
        field(
            "seed",
            "Stable bristle and weave seed",
            [0.0, 16777215.0, 1.0, 17.0],
            true,
        ),
        field(
            "drying",
            "Wetness decay per second",
            [0.0, 20.0, 0.01, 2.0],
            true,
        ),
        field(
            "diffusion",
            "Wet neighbour transport",
            [0.0, 4.0, 0.01, 2.0],
            true,
        ),
        field(
            "weaveFrequency",
            "Warp/weft cycles per short side",
            [2.0, 128.0, 0.1, 9.0],
            true,
        ),
        field(
            "weaveHeight",
            "Woven substrate height",
            [0.0, 0.05, 0.001, 0.01],
            true,
        ),
        field("lightX", "Static light X", [-1.0, 1.0, 0.01, 0.4], true),
        field("lightY", "Static light Y", [-1.0, 1.0, 0.01, 0.2], true),
        field("lightZ", "Static light Z", [-1.0, 1.0, 0.01, 1.0], true),
        field(
            "relief",
            "Material normal relief",
            [0.0, 8.0, 0.01, 2.0],
            true,
        ),
        field(
            "strokeCount",
            "Explicit linear brush trajectories",
            [0.0, MAX_STROKES as f64, 1.0, 0.0],
            true,
        ),
    ];
    for keys in STROKE_KEYS {
        for (component, key) in keys.into_iter().enumerate() {
            let range = match component {
                0 => [0.0, MAX_DURATION_TICKS as f64, 1.0, 0.0],
                1 => [1.0, MAX_DURATION_TICKS as f64, 1.0, 120000.0],
                2..=5 => [-1.0, 2.0, 0.001, 0.5],
                6 => [0.005, 0.25, 0.001, 0.1],
                7 => [2.0, 32.0, 1.0, 5.0],
                8 | 9 => [0.0, 1.0, 0.01, 1.0],
                _ => [0.0, 0.1, 0.001, 0.08],
            };
            fields.push(field(key, key, range, false));
        }
    }
    Definition {
        id: "canvas",
        version: 1,
        name: "Canvas",
        animated: true,
        fields,
    }
}
