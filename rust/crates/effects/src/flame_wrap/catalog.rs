use crate::stylized_catalog::{Definition, Field};

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: !matches!(key, "speed" | "seed"),
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "flame-wrap",
        version: 1,
        name: "Flame Wrap",
        animated: true,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field(
                "boundaryWidth",
                "Boundary width (pixels)",
                [1.0, 32.0, 0.1, 8.0],
            ),
            field(
                "flameHeight",
                "Flame height (pixels)",
                [1.0, 128.0, 0.1, 32.0],
            ),
            field("flameOpacity", "Flame opacity", [0.0, 1.0, 0.01, 0.85]),
            field("sparkOpacity", "Spark opacity", [0.0, 1.0, 0.01, 0.6]),
            field(
                "refraction",
                "Heat refraction (pixels)",
                [0.0, 16.0, 0.1, 2.0],
            ),
            field("speed", "Cycles per second", [0.0, 4.0, 0.01, 1.0]),
            field("wind", "Rise drift", [-1.0, 1.0, 0.01, 0.0]),
            field("seed", "Seed", [0.0, 65535.0, 1.0, 0.0]),
        ],
    }
}
