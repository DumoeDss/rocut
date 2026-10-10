pub(super) use super::seeded::{Rng, TAU, lerp, noise};
pub(super) fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
pub(super) fn smooth(v: f64) -> f64 {
    let k = clamp(v);
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
pub(super) fn rgb(r: u8, g: u8, b: u8, a: f64) -> [f64; 4] {
    [r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0, a]
}
pub(super) fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    lerp(a, b, r.next())
}
