pub(super) use super::seeded::{Rng, TAU, lerp, rnd, rnds};
pub(super) fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
pub(super) fn inv(a: f64, b: f64, v: f64) -> f64 {
    clamp((v - a) / (b - a))
}
pub(super) fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let k = inv(a, b, v);
    k * k * (3.0 - 2.0 * k)
}
pub(super) fn sine(v: f64) -> f64 {
    -((std::f64::consts::PI * v).cos() - 1.0) / 2.0
}
pub(super) fn expo(v: f64) -> f64 {
    if v >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * v)
    }
}
pub(super) fn fract(v: f64) -> f64 {
    v - v.floor()
}
pub(super) fn fbm(v: f64, seed: f64) -> f64 {
    let (mut sum, mut amp, mut freq) = (0.0, 0.5, 1.0);
    for i in 0..3 {
        sum += amp * super::seeded::noise(v * freq, seed + i as f64 * 17.0);
        amp *= 0.5;
        freq *= 2.0;
    }
    sum
}
pub(super) fn rgb(r: u8, g: u8, b: u8, a: f64) -> [f64; 4] {
    [r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0, a]
}
