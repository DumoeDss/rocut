//! Seekable rest-space deformation; no wall-clock integration or retained history.
use serde::{Deserialize, Serialize};

pub const MAX_LIQUID_OBJECT_VERTICES: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiquidObjectControls {
    pub amount: f64,
    pub frequency: f64,
    pub speed: f64,
    pub twist: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiquidObjectFrame {
    pub positions: Vec<f64>,
    pub restore: bool,
}

pub fn deform_liquid_object(
    rest: &[f64],
    controls: &LiquidObjectControls,
    time: f64,
    seed: u32,
    enabled: bool,
) -> Result<LiquidObjectFrame, &'static str> {
    if rest.is_empty() || rest.len() % 3 != 0 || rest.len() / 3 > MAX_LIQUID_OBJECT_VERTICES {
        return Err("positions must contain 1..100000 xyz vertices");
    }
    if rest.iter().any(|v| !v.is_finite() || v.abs() > 1_000_000.0) {
        return Err("rest positions must be finite and within +/-1000000");
    }
    if !time.is_finite() || !(0.0..=86_400.0).contains(&time) {
        return Err("absolute frame time must be finite seconds within 0..86400");
    }
    for (v, lo, hi) in [
        (controls.amount, 0.0, 1.0),
        (controls.frequency, 0.0, 16.0),
        (controls.speed, 0.0, 16.0),
        (controls.twist, -2.0, 2.0),
    ] {
        if !v.is_finite() || !(lo..=hi).contains(&v) {
            return Err("invalid deformation controls");
        }
    }
    if !enabled || controls.amount == 0.0 {
        return Ok(LiquidObjectFrame {
            positions: rest.to_vec(),
            restore: true,
        });
    }
    let mut minimum = [f64::INFINITY; 3];
    let mut maximum = [f64::NEG_INFINITY; 3];
    for p in rest.chunks_exact(3) {
        for axis in 0..3 {
            minimum[axis] = minimum[axis].min(p[axis]);
            maximum[axis] = maximum[axis].max(p[axis]);
        }
    }
    let center = std::array::from_fn::<_, 3, _>(|i| (minimum[i] + maximum[i]) * 0.5);
    let extent = (0..3)
        .map(|i| maximum[i] - minimum[i])
        .fold(0.0_f64, f64::max);
    if extent == 0.0 {
        return Ok(LiquidObjectFrame {
            positions: rest.to_vec(),
            restore: true,
        });
    }
    let phase = (seed as f64 / (u32::MAX as f64 + 1.0)) * std::f64::consts::TAU;
    let temporal = time * controls.speed;
    let mut positions = Vec::with_capacity(rest.len());
    for p in rest.chunks_exact(3) {
        let x = (p[0] - center[0]) / extent;
        let y = (p[1] - center[1]) / extent;
        let z = (p[2] - center[2]) / extent;
        let wave = ((x + z) * controls.frequency + temporal + phase).sin();
        let angle = controls.twist * controls.amount * y * (temporal + phase).sin();
        let (sin, cos) = angle.sin_cos();
        let bulge = 1.0 + controls.amount * 0.2 * wave;
        positions.extend([
            center[0] + extent * (x * cos - z * sin) * bulge,
            center[1] + extent * (y + controls.amount * 0.1 * wave),
            center[2] + extent * (x * sin + z * cos) * bulge,
        ]);
    }
    Ok(LiquidObjectFrame {
        positions,
        restore: false,
    })
}

#[cfg(test)]
#[path = "liquid_object_tests.rs"]
mod tests;
