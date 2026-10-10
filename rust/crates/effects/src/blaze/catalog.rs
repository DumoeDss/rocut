use crate::stylized_catalog::{Definition, Field};

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: !matches!(key, "scale" | "speed" | "seed"),
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "blaze",
        version: 1,
        name: "Blaze",
        animated: true,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field("flameOpacity", "Flame opacity", [0.0, 1.0, 0.01, 0.8]),
            field("sparkOpacity", "Spark opacity", [0.0, 1.0, 0.01, 0.6]),
            field("smokeOpacity", "Smoke opacity", [0.0, 1.0, 0.01, 0.25]),
            field(
                "refraction",
                "Heat refraction (short-side fraction)",
                [0.0, 0.08, 0.001, 0.015],
            ),
            field(
                "height",
                "Emission height (short-side fraction)",
                [0.1, 1.5, 0.001, 0.65],
            ),
            field(
                "scale",
                "Noise scale (short-side fraction)",
                [0.025, 0.5, 0.001, 0.15],
            ),
            field("speed", "Rise cycles per second", [0.0, 4.0, 0.01, 0.4]),
            field(
                "wind",
                "Rise drift (short-side fraction)",
                [-1.0, 1.0, 0.001, 0.0],
            ),
            field("seed", "Seed", [0.0, 65535.0, 1.0, 1.0]),
        ],
    }
}
