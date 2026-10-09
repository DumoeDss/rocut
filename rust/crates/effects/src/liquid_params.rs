use std::collections::BTreeMap;

use serde_json::{Value, json};
use time::{FrameRate, MediaTime};

use crate::liquid_catalog::{EVENT_KEYS, MAX_EVENTS, MAX_SAFE_TICKS, fields};
use crate::liquid_sim::{Config, Event};

pub(crate) struct Parameters {
    pub config: Config,
    pub events: Vec<Event>,
    pub start_ticks: u64,
    pub duration_ticks: u64,
    pub values: BTreeMap<&'static str, f64>,
}

pub(crate) fn parse(params: &BTreeMap<String, f64>) -> Result<Parameters, String> {
    let definition = crate::liquid_catalog::definition();
    let mut values = BTreeMap::new();
    for key in params.keys() {
        if !definition.fields.iter().any(|f| f.key == key) {
            return Err(format!("Unknown Liquid parameter {key}"));
        }
    }
    for field in &definition.fields {
        let Some(value) = params
            .get(field.key)
            .copied()
            .or_else(|| (field.required != Some(false)).then_some(field.default))
        else {
            continue;
        };
        if !value.is_finite()
            || !(field.min..=field.max).contains(&value)
            || (field.step == 1.0 && value.fract() != 0.0)
        {
            return Err(format!("Invalid Liquid parameter {}", field.key));
        }
        values.insert(field.key, value);
    }
    let duration_ticks = values["durationTicks"] as u64;
    let mut events: Vec<Event> = Vec::with_capacity(values["eventCount"] as usize);
    for keys in &EVENT_KEYS[..values["eventCount"] as usize] {
        for key in keys {
            if !values.contains_key(key) {
                return Err(format!("Active Liquid impulse requires {key}"));
            }
        }
        let event = Event {
            at_ticks: values[keys[0]] as u64,
            center: [values[keys[1]], values[keys[2]]],
            radius: values[keys[3]],
            velocity: [values[keys[4]], values[keys[5]]],
            dye: values[keys[6]],
        };
        if event.at_ticks >= duration_ticks
            || events
                .last()
                .is_some_and(|last| last.at_ticks > event.at_ticks)
        {
            return Err("Liquid impulses must be ordered and strictly before durationTicks".into());
        }
        events.push(event);
    }
    let config = Config {
        columns: values["columns"] as u32,
        rows: values["rows"] as u32,
        viscosity: values["viscosity"],
        velocity_damping: values["velocityDamping"],
        dye_dissipation: values["dyeDissipation"],
        pressure_iterations: values["pressureIterations"] as u32,
        diffusion_iterations: values["diffusionIterations"] as u32,
        vorticity: values["vorticity"],
    };
    Ok(Parameters {
        config,
        events,
        start_ticks: values["startTicks"] as u64,
        duration_ticks,
        values,
    })
}

pub fn validate_liquid_schedule(params: &BTreeMap<String, f64>) -> Result<(), String> {
    let parsed = parse(params)?;
    crate::liquid_replay::validate_budget(
        &parsed.config,
        parsed.events.len(),
        parsed.duration_ticks,
    )
}

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    if local_time.unsigned_abs() > MAX_SAFE_TICKS as u64 {
        return Err("Liquid effect time must be safe integer ticks".into());
    }
    let parsed = parse(params)?;
    crate::liquid_replay::validate_budget(
        &parsed.config,
        parsed.events.len(),
        parsed.duration_ticks,
    )?;
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Liquid requires bounded integral ticks/frame")?;
    let sampled = MediaTime::from_frame(frame, rate)
        .ok_or("Liquid frame tick overflow")?
        .as_ticks();
    let elapsed = (i128::from(sampled) - i128::from(parsed.start_ticks))
        .clamp(0, i128::from(parsed.duration_ticks)) as u64;
    let mut uniforms = serde_json::Map::new();
    for field in fields() {
        if field.key != "startTicks" {
            uniforms.insert(field.key.into(), json!(parsed.values[field.key]));
        }
    }
    uniforms.insert("elapsedTicks".into(), json!(elapsed));
    let events: Vec<_> = parsed
        .events
        .iter()
        .flat_map(|event| {
            [
                event.at_ticks as f64,
                event.center[0],
                event.center[1],
                event.radius,
                event.velocity[0],
                event.velocity[1],
                event.dye,
            ]
        })
        .collect();
    assert!(events.len() <= MAX_EVENTS * 7);
    uniforms.insert("events".into(), json!(events));
    let passes = if parsed.values["amount"] == 0.0 {
        vec![]
    } else {
        vec![json!({"shader":"liquid", "uniforms":uniforms})]
    };
    Ok(json!({"version":1, "frameIndex":frame, "passes":passes}))
}
