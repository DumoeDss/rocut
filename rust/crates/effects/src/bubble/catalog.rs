use crate::stylized_catalog::{Definition, Field};

pub(super) const POINT_KEYS: [[&str; 3]; 16] = [
    ["point0Time", "point0X", "point0Y"],
    ["point1Time", "point1X", "point1Y"],
    ["point2Time", "point2X", "point2Y"],
    ["point3Time", "point3X", "point3Y"],
    ["point4Time", "point4X", "point4Y"],
    ["point5Time", "point5X", "point5Y"],
    ["point6Time", "point6X", "point6Y"],
    ["point7Time", "point7X", "point7Y"],
    ["point8Time", "point8X", "point8Y"],
    ["point9Time", "point9X", "point9Y"],
    ["point10Time", "point10X", "point10Y"],
    ["point11Time", "point11X", "point11Y"],
    ["point12Time", "point12X", "point12Y"],
    ["point13Time", "point13X", "point13Y"],
    ["point14Time", "point14X", "point14Y"],
    ["point15Time", "point15X", "point15Y"],
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
    let mut fields = vec![
        field("amount", "Amount", [0.0, 1.0, 0.01, 1.0], true),
        field(
            "radius",
            "Radius (short-side fraction)",
            [0.005, 0.5, 0.001, 30.0 / 1080.0],
            true,
        ),
        field("blend", "Merge sharpness", [1.0, 24.0, 0.1, 14.0], true),
        field(
            "refraction",
            "Optical plane distance (short-side fraction)",
            [-0.25, 0.25, 0.001, 80.0 / 1080.0],
            true,
        ),
        field("ior", "Index of refraction", [1.0, 2.5, 0.01, 1.33], true),
        field(
            "dispersion",
            "Chromatic dispersion",
            [0.0, 3.0, 0.01, 1.0],
            true,
        ),
        field("frost", "Frost", [0.0, 1.0, 0.01, 0.0], true),
        field("shine", "Shine", [0.0, 2.0, 0.01, 0.25], true),
        field("rim", "Rim", [0.0, 2.0, 0.01, 0.5], true),
        field("iridescence", "Iridescence", [0.0, 2.0, 0.01, 1.0], true),
        field("intensity", "Sheen intensity", [0.0, 5.0, 0.01, 0.9], true),
        field("tintStrength", "Tint strength", [0.0, 1.0, 0.01, 0.0], true),
    ];
    for (key, label, default) in [
        ("tintR", "Tint red", 1.0),
        ("tintG", "Tint green", 1.0),
        ("tintB", "Tint blue", 1.0),
        ("colorAR", "Sheen A red", 0.2902),
        ("colorAG", "Sheen A green", 0.4549),
        ("colorAB", "Sheen A blue", 0.7216),
        ("colorBR", "Sheen B red", 0.4118),
        ("colorBG", "Sheen B green", 0.4118),
        ("colorBB", "Sheen B blue", 0.4157),
    ] {
        fields.push(field(key, label, [0.0, 1.0, 0.01, default], true));
    }
    fields
}

pub(crate) fn definition() -> Definition {
    let mut fields = optical_fields();
    fields.extend([
        field(
            "speed",
            "Sheen cycles per second",
            [0.0, 6.0, 0.01, 2.0],
            false,
        ),
        field(
            "follow",
            "Trajectory following",
            [0.0, 1.0, 0.01, 0.5],
            false,
        ),
        field("trail", "Trail balls", [1.0, 24.0, 1.0, 24.0], false),
        field(
            "trailDurationTicks",
            "Trail history (ticks)",
            [0.0, 120000.0, 1.0, 46000.0],
            false,
        ),
        field(
            "startTicks",
            "Activity start (ticks)",
            [0.0, 9007199254740991.0, 1.0, 0.0],
            false,
        ),
        field(
            "durationTicks",
            "Activity duration (ticks)",
            [1000.0, 3600000.0, 1.0, 240000.0],
            false,
        ),
        field(
            "pointCount",
            "Trajectory points",
            [1.0, 16.0, 1.0, 1.0],
            false,
        ),
    ]);
    for (index, keys) in POINT_KEYS.iter().enumerate() {
        for (axis, key) in keys.iter().enumerate() {
            let range = if axis == 0 {
                [0.0, if index == 0 { 0.0 } else { 3600000.0 }, 1.0, 0.0]
            } else {
                [-1.0, 2.0, 0.001, 0.5]
            };
            let mut entry = field(key, key, range, false);
            // Default authoring materializes point 0 only. Activating another
            // slot requires all three authored values, not its catalog defaults.
            entry.required = Some(index == 0);
            fields.push(entry);
        }
    }
    Definition {
        id: "bubble",
        version: 1,
        name: "Bubble",
        animated: true,
        fields,
    }
}
