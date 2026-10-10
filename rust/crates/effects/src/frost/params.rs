use super::{
    catalog,
    strokes::{MAX_FROST_TICKS, Stroke},
};
use crate::stylized_catalog::Field;
use std::collections::BTreeMap;

pub(super) struct Prepared {
    pub optics: BTreeMap<String, f64>,
    pub strokes: Vec<Stroke>,
    pub hold: u64,
    pub recovery: u64,
}
impl Prepared {
    pub fn neutral(&self) -> bool {
        self.optics["amount"] == 0.0
            || self.optics["coverage"] == 0.0
            || ["blur", "refraction", "tintStrength"]
                .iter()
                .all(|k| self.optics[*k] == 0.0)
    }
}
fn validate(field: &Field, value: f64) -> Result<(), String> {
    if !value.is_finite()
        || !(field.min..=field.max).contains(&value)
        || (field.step == 1.0 && value.fract() != 0.0)
    {
        return Err(format!("Invalid Frost parameter {}", field.key));
    }
    Ok(())
}
pub(super) fn prepare(params: &BTreeMap<String, f64>) -> Result<Prepared, String> {
    let fields = catalog::definition().fields;
    for key in params.keys() {
        if !fields.iter().any(|f| f.key == key) {
            return Err(format!("Unknown Frost parameter {key}"));
        }
    }
    let mut globals = BTreeMap::new();
    for field in fields
        .iter()
        .filter(|f| !f.key.starts_with("stroke") || f.key == "strokeCount")
    {
        let value = params.get(field.key).copied().unwrap_or(field.default);
        validate(field, value)?;
        globals.insert(field.key, value);
    }
    let hold = globals["holdTicks"] as u64;
    let recovery = globals["recoveryTicks"] as u64;
    let lifetime = hold
        .checked_add(recovery)
        .ok_or("Frost recovery tick overflow")?;
    let count = globals["strokeCount"] as usize;
    let mut strokes = Vec::with_capacity(count);
    for (index, keys) in catalog::STROKE_KEYS.iter().enumerate() {
        if index >= count {
            if let Some(key) = keys.iter().find(|k| params.contains_key(**k)) {
                return Err(format!("Inactive Frost stroke field {key}"));
            }
            continue;
        }
        let mut values = [0.0; 7];
        for (component, key) in keys.iter().enumerate() {
            let value = *params
                .get(*key)
                .ok_or_else(|| format!("Missing active Frost stroke field {key}"))?;
            validate(fields.iter().find(|f| f.key == *key).unwrap(), value)?;
            values[component] = value;
        }
        let time = values[0] as u64;
        if time
            .checked_add(lifetime)
            .filter(|end| *end <= MAX_FROST_TICKS)
            .is_none()
        {
            return Err("Frost stroke hold/recovery endpoint exceeds safe ticks".into());
        }
        strokes.push(Stroke {
            time,
            from: [values[1], values[2]],
            to: [values[3], values[4]],
            radius: values[5],
            strength: values[6],
        });
    }
    let optics = catalog::optical_fields()
        .into_iter()
        .map(|f| (f.key.into(), globals[f.key]))
        .collect();
    Ok(Prepared {
        optics,
        strokes,
        hold,
        recovery,
    })
}
