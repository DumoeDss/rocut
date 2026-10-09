//! Deterministic seq-overlay light leak adapted from reference meta.js/util.js.
//! Rust owns the outer clock, signed value noise and resolved gradient geometry.
use super::post_model::Effect;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Alpha {
    Preserve,
    Expand,
}

pub(super) fn default_speed() -> f64 {
    1.0
}

#[derive(Serialize)]
pub struct Stop {
    pub offset: f64,
    pub color: [f64; 4],
}
#[derive(Serialize)]
pub struct Gradient {
    pub center: [f64; 2],
    pub radius: f64,
    pub stops: Vec<Stop>,
}
#[derive(Serialize)]
pub struct Plan {
    pub seconds: f64,
    pub seed: u32,
    pub gradients: [Gradient; 2],
}

// JS Math.floor(x * 1000003) | 0: preserve modulo-2^32 conversion rather
// than Rust's saturating float-to-integer cast. All inputs are validated finite.
fn signed_random(x: f64, seed: f64) -> f64 {
    let mut h = 0x811c9dc5u32;
    for value in [x, seed] {
        h ^= (value * 1000003.0).floor().rem_euclid(4294967296.0) as u32;
        h = h.wrapping_mul(0x01000193);
        h ^= h >> 13;
        h = h.wrapping_mul(0x5bd1e995);
        h ^= h >> 15;
    }
    f64::from(h) / 4294967296.0 * 2.0 - 1.0
}
fn noise(x: f64, seed: f64) -> f64 {
    let i = x.floor();
    let f = x - i;
    let u = f * f * (3.0 - 2.0 * f);
    let a = signed_random(i, seed);
    a + (signed_random(i + 1.0, seed) - a) * u
}
fn stop(offset: f64, rgb: [u8; 3], alpha: f64) -> Stop {
    Stop {
        offset,
        color: [
            f64::from(rgb[0]),
            f64::from(rgb[1]),
            f64::from(rgb[2]),
            alpha,
        ],
    }
}

pub(super) fn resolve(
    effect: &Effect,
    song_seconds: f64,
    source_seed: u32,
    width: f64,
    height: f64,
) -> Option<Plan> {
    let Effect::LightLeak {
        amount,
        speed,
        seed_offset,
        ..
    } = effect
    else {
        return None;
    };
    let seed = source_seed.wrapping_add(*seed_offset);
    let s = f64::from(seed);
    let t = song_seconds * speed;
    let alpha = amount * (0.6 + 0.4 * noise(t * 0.6, s + 9.0));
    Some(Plan {
        seconds: t,
        seed,
        gradients: [
            Gradient {
                center: [
                    width * (0.88 + 0.16 * noise(t * 0.23, s)),
                    height * (0.18 + 0.35 * noise(t * 0.19, s + 3.0)),
                ],
                radius: height * (1.0 + 0.35 * noise(t * 0.31, s + 5.0)),
                stops: vec![
                    stop(0.0, [255, 194, 122], 0.55 * alpha),
                    stop(0.35, [255, 106, 58], 0.28 * alpha),
                    stop(1.0, [255, 80, 40], 0.0),
                ],
            },
            Gradient {
                center: [
                    width * (0.05 + 0.1 * noise(t * 0.17, s + 11.0)),
                    height * (0.85 + 0.1 * noise(t * 0.2, s + 13.0)),
                ],
                radius: height * 0.7,
                stops: vec![
                    stop(0.0, [255, 79, 106], 0.3 * alpha),
                    stop(1.0, [255, 79, 106], 0.0),
                ],
            },
        ],
    })
}
