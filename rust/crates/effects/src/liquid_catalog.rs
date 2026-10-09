use crate::stylized_catalog::{Definition, Field};

pub(crate) const MAX_EVENTS: usize = 16;
pub(crate) const MAX_TICKS: u64 = 3_600_000;
pub(crate) const STEP_TICKS: u64 = 1_000;
pub(crate) const MAX_WORK: u64 = 80_000_000;
pub(crate) const MAX_MEMORY: u64 = 8 * 1024 * 1024;
pub(crate) const MAX_SAFE_TICKS: f64 = 9_007_199_254_740_991.0;

pub(crate) const EVENT_KEYS: [[&str; 7]; MAX_EVENTS] = [
    [
        "event0Time",
        "event0X",
        "event0Y",
        "event0Radius",
        "event0VelocityX",
        "event0VelocityY",
        "event0Dye",
    ],
    [
        "event1Time",
        "event1X",
        "event1Y",
        "event1Radius",
        "event1VelocityX",
        "event1VelocityY",
        "event1Dye",
    ],
    [
        "event2Time",
        "event2X",
        "event2Y",
        "event2Radius",
        "event2VelocityX",
        "event2VelocityY",
        "event2Dye",
    ],
    [
        "event3Time",
        "event3X",
        "event3Y",
        "event3Radius",
        "event3VelocityX",
        "event3VelocityY",
        "event3Dye",
    ],
    [
        "event4Time",
        "event4X",
        "event4Y",
        "event4Radius",
        "event4VelocityX",
        "event4VelocityY",
        "event4Dye",
    ],
    [
        "event5Time",
        "event5X",
        "event5Y",
        "event5Radius",
        "event5VelocityX",
        "event5VelocityY",
        "event5Dye",
    ],
    [
        "event6Time",
        "event6X",
        "event6Y",
        "event6Radius",
        "event6VelocityX",
        "event6VelocityY",
        "event6Dye",
    ],
    [
        "event7Time",
        "event7X",
        "event7Y",
        "event7Radius",
        "event7VelocityX",
        "event7VelocityY",
        "event7Dye",
    ],
    [
        "event8Time",
        "event8X",
        "event8Y",
        "event8Radius",
        "event8VelocityX",
        "event8VelocityY",
        "event8Dye",
    ],
    [
        "event9Time",
        "event9X",
        "event9Y",
        "event9Radius",
        "event9VelocityX",
        "event9VelocityY",
        "event9Dye",
    ],
    [
        "event10Time",
        "event10X",
        "event10Y",
        "event10Radius",
        "event10VelocityX",
        "event10VelocityY",
        "event10Dye",
    ],
    [
        "event11Time",
        "event11X",
        "event11Y",
        "event11Radius",
        "event11VelocityX",
        "event11VelocityY",
        "event11Dye",
    ],
    [
        "event12Time",
        "event12X",
        "event12Y",
        "event12Radius",
        "event12VelocityX",
        "event12VelocityY",
        "event12Dye",
    ],
    [
        "event13Time",
        "event13X",
        "event13Y",
        "event13Radius",
        "event13VelocityX",
        "event13VelocityY",
        "event13Dye",
    ],
    [
        "event14Time",
        "event14X",
        "event14Y",
        "event14Radius",
        "event14VelocityX",
        "event14VelocityY",
        "event14Dye",
    ],
    [
        "event15Time",
        "event15X",
        "event15Y",
        "event15Radius",
        "event15VelocityX",
        "event15VelocityY",
        "event15Dye",
    ],
];

fn field(key: &'static str, label: &'static str, range: [f64; 4], optical: bool) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: optical,
        required: None,
    }
}

pub(crate) fn fields() -> Vec<Field> {
    vec![
        field("amount", "Amount", [0.0, 1.0, 0.01, 1.0], true),
        field(
            "refraction",
            "Flow refraction (short-side fraction)",
            [0.0, 0.25, 0.001, 0.06],
            true,
        ),
        field(
            "dyeOpacity",
            "Dye tint opacity",
            [0.0, 1.0, 0.01, 0.35],
            true,
        ),
        field("colorR", "Dye red", [0.0, 1.0, 0.01, 0.1], true),
        field("colorG", "Dye green", [0.0, 1.0, 0.01, 0.45], true),
        field("colorB", "Dye blue", [0.0, 1.0, 0.01, 1.0], true),
        field("columns", "Fluid columns", [8.0, 64.0, 1.0, 16.0], false),
        field("rows", "Fluid rows", [8.0, 64.0, 1.0, 12.0], false),
        field(
            "viscosity",
            "Viscosity (short-side squared/second)",
            [0.0, 0.02, 0.0001, 0.001],
            false,
        ),
        field(
            "velocityDamping",
            "Velocity damping (per second)",
            [0.0, 10.0, 0.01, 0.5],
            false,
        ),
        field(
            "dyeDissipation",
            "Dye dissipation (per second)",
            [0.0, 10.0, 0.01, 0.15],
            false,
        ),
        field(
            "pressureIterations",
            "Pressure iterations",
            [4.0, 80.0, 1.0, 24.0],
            false,
        ),
        field(
            "diffusionIterations",
            "Diffusion iterations",
            [2.0, 24.0, 1.0, 6.0],
            false,
        ),
        field(
            "vorticity",
            "Vorticity confinement",
            [0.0, 4.0, 0.01, 0.5],
            false,
        ),
        field(
            "startTicks",
            "Simulation start (clip-local ticks)",
            [0.0, MAX_SAFE_TICKS, 1.0, 0.0],
            false,
        ),
        field(
            "durationTicks",
            "Simulation duration (ticks)",
            [1_000.0, MAX_TICKS as f64, 1.0, 240_000.0],
            false,
        ),
        field(
            "eventCount",
            "Impulse count",
            [0.0, MAX_EVENTS as f64, 1.0, 0.0],
            false,
        ),
    ]
}

pub(crate) fn definition() -> Definition {
    let mut fields = fields();
    for keys in EVENT_KEYS {
        for (key, label, range) in [
            (
                keys[0],
                "Impulse time (relative ticks)",
                [0.0, MAX_TICKS as f64, 1.0, 0.0],
            ),
            (
                keys[1],
                "Impulse X (width fraction)",
                [0.0, 1.0, 0.001, 0.5],
            ),
            (
                keys[2],
                "Impulse Y (height fraction)",
                [0.0, 1.0, 0.001, 0.5],
            ),
            (
                keys[3],
                "Impulse radius (short-side fraction)",
                [0.01, 2.0, 0.001, 0.2],
            ),
            (
                keys[4],
                "Horizontal velocity increment",
                [-3.0, 3.0, 0.01, 0.0],
            ),
            (
                keys[5],
                "Vertical velocity increment",
                [-3.0, 3.0, 0.01, 0.0],
            ),
            (
                keys[6],
                "Dye concentration increment",
                [0.0, 1.0, 0.01, 1.0],
            ),
        ] {
            let mut slot = field(key, label, range, false);
            slot.required = Some(false);
            fields.push(slot);
        }
    }
    Definition {
        id: "liquid",
        version: 1,
        name: "Liquid",
        animated: true,
        fields,
    }
}
