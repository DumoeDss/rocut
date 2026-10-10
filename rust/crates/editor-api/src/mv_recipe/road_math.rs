#[path = "converge_math.rs"]
mod seeded;
pub const TAU: f64 = std::f64::consts::TAU;
pub fn rnd(xs: &[f64]) -> f64 {
    seeded::hash(xs) as f64 / 4294967296.0
}
pub fn rnds(xs: &[f64]) -> f64 {
    rnd(xs) * 2.0 - 1.0
}
pub fn fbm(x: f64, seed: f64) -> f64 {
    let (mut sum, mut a, mut f) = (0.0, 0.5, 1.0);
    for o in 0..3 {
        sum += a * seeded::noise(x * f, seed + o as f64 * 17.0);
        a *= 0.5;
        f *= 2.0;
    }
    sum
}
pub fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
pub fn lerp(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
pub fn inv(a: f64, b: f64, t: f64) -> f64 {
    clamp((t - a) / (b - a))
}
pub fn smooth(a: f64, b: f64, t: f64) -> f64 {
    let k = inv(a, b, t);
    k * k * (3.0 - 2.0 * k)
}
pub fn sine(k: f64) -> f64 {
    -((std::f64::consts::PI * k).cos() - 1.0) / 2.0
}
pub fn expo(k: f64) -> f64 {
    if k >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * k)
    }
}
pub fn fract(v: f64) -> f64 {
    v - v.floor()
}
pub fn quant(t: f64) -> f64 {
    (t * 12.0 + 1e-6).floor() / 12.0
}
pub fn mix(a: [f64; 3], b: [f64; 3], k: f64) -> [f64; 3] {
    std::array::from_fn(|i| lerp(a[i], b[i], k))
}
pub fn ramp(k: f64) -> [f64; 3] {
    let stops = [
        (0.0, [190.0, 240.0, 255.0]),
        (0.22, [236.0, 250.0, 255.0]),
        (0.45, [255.0, 244.0, 222.0]),
        (0.72, [255.0, 212.0, 160.0]),
        (1.0, [246.0, 168.0, 158.0]),
    ];
    for i in 1..stops.len() {
        if clamp(k) <= stops[i].0 {
            return mix(
                stops[i - 1].1,
                stops[i].1,
                (clamp(k) - stops[i - 1].0) / (stops[i].0 - stops[i - 1].0),
            );
        }
    }
    stops[4].1
}
pub fn zk(z: f64) -> f64 {
    (z.max(1.2) / 1.2).ln() / (400.0f64 / 1.2).ln()
}
