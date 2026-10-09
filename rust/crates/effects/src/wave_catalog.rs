use crate::stylized_catalog::{Definition, Field};

pub const MAX_WAVE_EVENTS: usize = 16;
pub(crate) const MAX_EVENT_TICKS: f64 = 9_007_199_254_740_991.0;
pub(crate) const EVENT_KEYS: [[&str; 4]; MAX_WAVE_EVENTS] = [
    ["event0Time", "event0X", "event0Y", "event0Amplitude"],
    ["event1Time", "event1X", "event1Y", "event1Amplitude"],
    ["event2Time", "event2X", "event2Y", "event2Amplitude"],
    ["event3Time", "event3X", "event3Y", "event3Amplitude"],
    ["event4Time", "event4X", "event4Y", "event4Amplitude"],
    ["event5Time", "event5X", "event5Y", "event5Amplitude"],
    ["event6Time", "event6X", "event6Y", "event6Amplitude"],
    ["event7Time", "event7X", "event7Y", "event7Amplitude"],
    ["event8Time", "event8X", "event8Y", "event8Amplitude"],
    ["event9Time", "event9X", "event9Y", "event9Amplitude"],
    ["event10Time", "event10X", "event10Y", "event10Amplitude"],
    ["event11Time", "event11X", "event11Y", "event11Amplitude"],
    ["event12Time", "event12X", "event12Y", "event12Amplitude"],
    ["event13Time", "event13X", "event13Y", "event13Amplitude"],
    ["event14Time", "event14X", "event14Y", "event14Amplitude"],
    ["event15Time", "event15X", "event15Y", "event15Amplitude"],
];

fn field(key: &'static str, label: &'static str, range: [f64; 4]) -> Field {
    Field {
        key,
        label,
        min: range[0],
        max: range[1],
        step: range[2],
        default: range[3],
        keyframable: true,
        required: None,
    }
}

pub(crate) fn global_fields(force_field: bool) -> Vec<Field> {
    let mut fields = vec![
        field("amount", "Amount", [0.0, 1.0, 0.01, 1.0]),
        field(
            "speed",
            "Wave speed (short-side/second)",
            [0.01, 4.0, 0.01, 0.4],
        ),
        field(
            "wavelength",
            "Wavelength (short-side fraction)",
            [0.002, 2.0, 0.001, 0.08],
        ),
        field(
            "width",
            "Wave packet half-width (short-side fraction)",
            [0.002, 2.0, 0.001, 0.15],
        ),
        field(
            "refraction",
            "Refraction (short-side fraction)",
            [0.0, 0.25, 0.001, 0.025],
        ),
        field(
            "decay",
            "Exponential decay (per second)",
            [0.0, 20.0, 0.01, 0.5],
        ),
        field(
            "lifetime",
            "Impact lifetime (seconds)",
            [0.01, 60.0, 0.01, 3.0],
        ),
    ];
    if force_field {
        fields.extend([
            field("ringOpacity", "Ring opacity", [0.0, 1.0, 0.01, 0.65]),
            field("glow", "Outer glow", [0.0, 1.0, 0.01, 0.4]),
            field("colorR", "Ring red", [0.0, 1.0, 0.01, 0.15]),
            field("colorG", "Ring green", [0.0, 1.0, 0.01, 0.8]),
            field("colorB", "Ring blue", [0.0, 1.0, 0.01, 1.0]),
        ]);
    }
    fields
}

pub(crate) fn definitions() -> Vec<Definition> {
    [("ripple", "Ripple"), ("force-field", "Force Field")]
        .into_iter()
        .map(|(id, name)| {
            let mut fields = global_fields(id == "force-field");
            let mut count = field(
                "eventCount",
                "Impact count (bounded schedule)",
                [0.0, MAX_WAVE_EVENTS as f64, 1.0, 0.0],
            );
            count.keyframable = false;
            fields.push(count);
            for keys in EVENT_KEYS {
                for (key, label, range) in [
                    (
                        keys[0],
                        "Impact time (clip-local ticks)",
                        [0.0, MAX_EVENT_TICKS, 1.0, 0.0],
                    ),
                    (
                        keys[1],
                        "Impact X (width fraction)",
                        [-1.0, 2.0, 0.001, 0.5],
                    ),
                    (
                        keys[2],
                        "Impact Y (height fraction)",
                        [-1.0, 2.0, 0.001, 0.5],
                    ),
                    (keys[3], "Impact amplitude", [-1.0, 1.0, 0.01, 1.0]),
                ] {
                    let mut slot = field(key, label, range);
                    slot.keyframable = false;
                    // Active groups are required together by schedule validation.
                    slot.required = Some(false);
                    fields.push(slot);
                }
            }
            Definition {
                id,
                version: 1,
                name,
                animated: true,
                fields,
            }
        })
        .collect()
}
