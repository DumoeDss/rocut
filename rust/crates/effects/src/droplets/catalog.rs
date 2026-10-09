use crate::stylized_catalog::{Definition, Field};

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: matches!(key, "amount" | "refraction" | "highlight"),
        required: None,
    }
}

pub(crate) fn definition() -> Definition {
    Definition {
        id: "droplets",
        version: 1,
        name: "Droplets",
        animated: true,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field("count", "Droplet count", [0.0, 64.0, 1.0, 24.0]),
            field(
                "radius",
                "Radius (short-side fraction)",
                [0.003, 0.15, 0.001, 0.035],
            ),
            field("speed", "Fall cycles per second", [0.0, 4.0, 0.01, 0.35]),
            field("elongation", "Vertical elongation", [1.0, 4.0, 0.01, 1.8]),
            field(
                "refraction",
                "Refraction (short-side fraction)",
                [0.0, 0.1, 0.001, 0.018],
            ),
            field("highlight", "Highlight", [0.0, 1.0, 0.01, 0.15]),
            field("seed", "Seed", [0.0, 65535.0, 1.0, 1.0]),
        ],
    }
}
