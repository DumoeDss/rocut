//! Native AudioParam event preparation, not a continuously evaluated track gain.
//! Ported from HyperFrames 0.8.139 audioFxAutomation.js; see rust/wasm/NOTICE.
use super::facts::seconds;
use super::fx_numbers::clamp_number;
use super::volume_lane::{envelope, max_gain, parse_volume_lane};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum Event {
    Set {
        time: f64,
        value: f64,
    },
    Ramp {
        time: f64,
        value: f64,
    },
    Curve {
        time: f64,
        duration: f64,
        values: Vec<f32>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BusSchedule {
    pub kind: &'static str,
    pub execution_ready: bool,
    pub static_gain: f64,
    pub cancel_from: f64,
    pub curve_failure_policy: &'static str,
    pub events: Vec<Event>,
}

// ECMAScript parseFloat, intentionally not Number(): author bus volumes retain
// their valid decimal prefix ("0.5suffix" -> .5, "0x10" -> 0).
pub(super) fn static_volume(raw: Option<&str>) -> f64 {
    let raw = raw.unwrap_or("").trim_start_matches(|c: char| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    });
    let bytes = raw.as_bytes();
    let mut index = usize::from(bytes.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    let mut digits = 0;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
        digits += 1;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return 1.0;
    }
    let exponent_start = index;
    if bytes.get(index).is_some_and(|b| matches!(b, b'e' | b'E')) {
        index += 1;
        if bytes.get(index).is_some_and(|b| matches!(b, b'+' | b'-')) {
            index += 1;
        }
        let first_digit = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == first_digit {
            index = exponent_start;
        }
    }
    clamp_number(
        raw[..index]
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .unwrap_or(1.0),
        0.0,
        max_gain(),
    )
}

pub(super) fn prepare(
    raw_volume: Option<&str>,
    automation: Option<&str>,
    scheduled_at: f64,
    elapsed: f64,
    rate: f64,
) -> Result<BusSchedule, String> {
    if !seconds(scheduled_at)
        || !seconds(elapsed)
        || !rate.is_finite()
        || !(0.01..=16.0).contains(&rate)
        || raw_volume.is_some_and(|v| v.len() > 4096)
    {
        return Err("Invalid HyperFrames bus AudioParam timing/volume".into());
    }
    let static_gain = static_volume(raw_volume);
    let mut events = Vec::new();
    let mut curve_values = 0usize;
    if let Some(points) = parse_volume_lane(automation)? {
        let env = envelope(points, 1.0, static_gain);
        if env.points.iter().all(|point| point.v == env.points[0].v) {
            events.push(Event::Set {
                time: scheduled_at,
                value: env.points[0].v,
            });
        } else {
            for pair in env.points.windows(2) {
                let (a, b) = (&pair[0], &pair[1]);
                let to_time = scheduled_at + (b.t - elapsed) / rate;
                if to_time <= scheduled_at {
                    continue;
                }
                let from_time = scheduled_at.max(scheduled_at + (a.t - elapsed) / rate);
                let duration = to_time - from_time;
                if duration <= 0.0 {
                    continue;
                }
                let bent = a.curve.is_some_and(|curve| curve != 0.0)
                    || (a.via_x.is_some() && a.via_y.is_some());
                if !bent {
                    events.push(Event::Ramp {
                        time: to_time,
                        value: b.v,
                    });
                } else {
                    let count = (duration * 100.0).ceil().clamp(8.0, 4096.0) as usize;
                    curve_values += count;
                    if curve_values > 262144 {
                        return Err(
                            "HyperFrames bus fader exceeds the expanded curve-value safety limit"
                                .into(),
                        );
                    }
                    let from = a.t.max(elapsed);
                    // Native samples into Float32Array before AudioParam sees it.
                    let values = (0..count)
                        .map(|index| {
                            env.level(from + (b.t - from) * index as f64 / (count - 1) as f64)
                                as f32
                        })
                        .collect();
                    events.push(Event::Curve {
                        time: from_time,
                        duration,
                        values,
                    });
                }
            }
            if !matches!(events.first(), Some(Event::Curve { time, .. }) if *time <= scheduled_at) {
                events.insert(
                    0,
                    Event::Set {
                        time: scheduled_at,
                        value: env.level(elapsed),
                    },
                );
            }
        }
    }
    Ok(BusSchedule {
        kind: "native-bus-AudioParam-events",
        execution_ready: false,
        static_gain,
        cancel_from: 0.0,
        curve_failure_policy: "native-linear-ramp-fallback",
        events,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    raw_volume: Option<String>,
    automation: Option<String>,
    scheduled_at: f64,
    elapsed: f64,
    rate: f64,
}

#[bridge::export]
pub fn resolve_hyperframes_bus_fader_json(input: String) -> String {
    let result = (|| {
        if input.len() > 256 * 1024 {
            return Err("HyperFrames bus fader payload exceeds its limit".into());
        }
        let request: Request = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid bus fader JSON: {error}"))?;
        if request.version != 1 {
            return Err("Unsupported HyperFrames bus fader version".into());
        }
        prepare(
            request.raw_volume.as_deref(),
            request.automation.as_deref(),
            request.scheduled_at,
            request.elapsed,
            request.rate,
        )
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
