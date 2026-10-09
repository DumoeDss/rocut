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
        id: "clouds",
        version: 1,
        name: "Clouds",
        animated: true,
        fields: vec![
            field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
            field("density", "Density", [0.0, 1.0, 0.01, 0.5]),
            field(
                "scale",
                "Cloud scale (short-side fraction)",
                [0.05, 2.0, 0.001, 0.3],
            ),
            field("speed", "Morph cycles per second", [0.0, 4.0, 0.01, 0.05]),
            field(
                "windX",
                "Horizontal wind offset (short-side fraction)",
                [-16.0, 16.0, 0.001, 0.0],
            ),
            field(
                "windY",
                "Vertical wind offset (short-side fraction)",
                [-16.0, 16.0, 0.001, 0.0],
            ),
            field(
                "refraction",
                "Refraction (short-side fraction)",
                [0.0, 0.08, 0.001, 0.015],
            ),
            field("fogOpacity", "Fog opacity", [0.0, 1.0, 0.01, 0.45]),
            field("colorR", "Fog red", [0.0, 1.0, 0.01, 1.0]),
            field("colorG", "Fog green", [0.0, 1.0, 0.01, 1.0]),
            field("colorB", "Fog blue", [0.0, 1.0, 0.01, 1.0]),
            field("seed", "Seed", [0.0, 65535.0, 1.0, 1.0]),
        ],
    }
}
