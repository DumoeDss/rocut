pub(super) use super::seeded::{TAU, lerp, noise, rnd, rnds};
pub(super) fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
pub(super) fn inv(a: f64, b: f64, t: f64) -> f64 {
    clamp((t - a) / (b - a))
}
pub(super) fn smooth(a: f64, b: f64, t: f64) -> f64 {
    let k = inv(a, b, t);
    k * k * (3.0 - 2.0 * k)
}
pub(super) fn sine(v: f64) -> f64 {
    -((std::f64::consts::PI * v).cos() - 1.0) / 2.0
}
pub(super) fn cubic(v: f64) -> f64 {
    if v < 0.5 {
        4.0 * v * v * v
    } else {
        1.0 - (-2.0 * v + 2.0).powi(3) / 2.0
    }
}
pub(super) fn out_cubic(v: f64) -> f64 {
    1.0 - (1.0 - v).powi(3)
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
pub(super) fn rgb(r: u8, g: u8, b: u8, a: f64) -> [f64; 4] {
    [r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0, a]
}
pub(super) fn random3(a: f64, b: f64, c: f64) -> f64 {
    super::seeded::hash(&[a, b, c]) as f64 / 4294967296.0
}
pub(super) fn signed3(a: f64, b: f64, c: f64) -> f64 {
    random3(a, b, c) * 2.0 - 1.0
}
pub(super) fn round(v: f64) -> f64 {
    (v + 0.5).floor()
}
