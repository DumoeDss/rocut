use std::collections::BTreeMap;

use super::{
    catalog,
    trajectory::{Config, Point, Trajectory},
};

pub(super) struct Prepared {
    pub optics: BTreeMap<String, f64>,
    pub trajectory: Trajectory,
    pub start_ticks: u64,
    pub duration_ticks: u64,
    pub speed: f64,
}

impl Prepared {
    pub fn neutral(&self) -> bool {
        self.optics["amount"] == 0.0 || optical_neutral(|key| self.optics[key])
    }
}

pub(super) fn optical_neutral(get: impl Fn(&str) -> f64) -> bool {
    (get("refraction") == 0.0 || (get("ior") == 1.0 && get("dispersion") == 0.0))
        && ["frost", "shine", "rim", "iridescence", "tintStrength"]
            .iter()
            .all(|key| get(key) == 0.0)
}

pub(super) fn prepare(params: &BTreeMap<String, f64>) -> Result<Prepared, String> {
    let fields = catalog::definition().fields;
    for key in params.keys() {
        if !fields.iter().any(|field| field.key == key) {
            return Err(format!("Unknown Bubble parameter {key}"));
        }
    }
    let mut values = BTreeMap::new();
    for field in fields
        .iter()
        .filter(|field| !field.key.starts_with("point") || field.key == "pointCount")
    {
        let value = params.get(field.key).copied().unwrap_or(field.default);
        validate(field, value)?;
        values.insert(field.key, value);
    }
    let count = values["pointCount"] as usize;
    let mut points = Vec::with_capacity(count);
    for (index, keys) in catalog::POINT_KEYS.iter().enumerate() {
        if index >= count {
            if let Some(key) = keys.iter().find(|key| params.contains_key(**key)) {
                return Err(format!("Inactive Bubble point slot supplied: {key}"));
            }
            continue;
        }
        let mut point = [0.0; 3];
        for (axis, key) in keys.iter().enumerate() {
            let value = *params
                .get(*key)
                .ok_or_else(|| format!("Missing active Bubble point field {key}"))?;
            validate(
                fields
                    .iter()
                    .find(|field| field.key == *key)
                    .expect("point field exists"),
                value,
            )?;
            point[axis] = value;
        }
        points.push(Point {
            ticks: point[0] as u64,
            position: [point[1], point[2]],
        });
    }
    let config = Config {
        start_ticks: values["startTicks"] as u64,
        duration_ticks: values["durationTicks"] as u64,
        follow: values["follow"],
        trail: values["trail"] as u32,
        trail_duration_ticks: values["trailDurationTicks"] as u64,
    };
    let trajectory = Trajectory::new(config, &points)
        .map_err(|error| format!("Invalid Bubble trajectory: {error:?}"))?;
    let optics = catalog::optical_fields()
        .iter()
        .map(|field| (field.key.into(), values[field.key]))
        .collect();
    Ok(Prepared {
        optics,
        trajectory,
        start_ticks: config.start_ticks,
        duration_ticks: config.duration_ticks,
        speed: values["speed"],
    })
}

fn validate(field: &crate::stylized_catalog::Field, value: f64) -> Result<(), String> {
    if !value.is_finite()
        || !(field.min..=field.max).contains(&value)
        || (field.step == 1.0 && value.fract() != 0.0)
    {
        return Err(format!(
            "Invalid Bubble parameter {}: expected {}..{}{}",
            field.key,
            field.min,
            field.max,
            if field.step == 1.0 {
                " integral"
            } else {
                " finite"
            }
        ));
    }
    Ok(())
}
