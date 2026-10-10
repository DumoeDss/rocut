pub const W: f64 = 1920.0;
pub const H: f64 = 1080.0;
pub const TAU: f64 = std::f64::consts::TAU;
pub fn sat(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}
pub fn lerp(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
pub fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let k = sat((x - a) / (b - a));
    k * k * (3.0 - 2.0 * k)
}
pub fn dec(x: f64, k: f64) -> f64 {
    if x < 0.0 {
        0.0
    } else {
        (-x * k).exp()
    }
}
pub fn out_cubic(x: f64) -> f64 {
    1.0 - (1.0 - x).powi(3)
}
pub fn in_out_sine(x: f64) -> f64 {
    (1.0 - (std::f64::consts::PI * x).cos()) / 2.0
}
pub fn out_expo(x: f64) -> f64 {
    if x >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * x)
    }
}
pub fn hash(values: &[f64]) -> u32 {
    let mut h = 0x811c9dc5u32;
    for x in values {
        h ^= (x * 1000003.0).floor().rem_euclid(4294967296.0) as u32;
        h = h.wrapping_mul(0x01000193);
        h ^= h >> 13;
        h = h.wrapping_mul(0x5bd1e995);
        h ^= h >> 15;
    }
    h
}
pub fn rnd(values: &[f64]) -> f64 {
    hash(values) as f64 / 4294967296.0
}
pub fn rnds(values: &[f64]) -> f64 {
    rnd(values) * 2.0 - 1.0
}
pub fn noise(x: f64, seed: f64) -> f64 {
    let i = x.floor();
    let f = x - i;
    lerp(
        rnds(&[i, seed]),
        rnds(&[i + 1.0, seed]),
        f * f * (3.0 - 2.0 * f),
    )
}
pub fn fbm(x: f64, seed: f64) -> f64 {
    (0..3)
        .map(|o| 0.5f64.powi(o + 1) * noise(x * 2.0f64.powi(o), seed + o as f64 * 17.0))
        .sum()
}
pub fn byte(x: f64) -> u8 {
    let x = x.clamp(0.0, 255.0);
    let f = x.floor();
    let d = x - f;
    (if d > 0.5 || (d == 0.5 && (f as u32) % 2 == 1) {
        f + 1.0
    } else {
        f
    }) as u8
}
pub fn rgba(color: &str, alpha: f64) -> String {
    let n = u32::from_str_radix(color.trim_start_matches('#'), 16).expect("validated RGB color");
    format!(
        "rgba({},{},{},{})",
        (n >> 16) & 255,
        (n >> 8) & 255,
        n & 255,
        alpha
    )
}
pub fn index(beats: &[f64], t: f64) -> Option<usize> {
    beats.partition_point(|b| *b <= t).checked_sub(1)
}
pub fn phase(beats: &[f64], bpm: f64, t: f64) -> f64 {
    match index(beats, t) {
        None => 0.0,
        Some(i) => sat((t - beats[i])
            / (beats.get(i + 1).copied().unwrap_or(beats[i] + 60.0 / bpm) - beats[i])),
    }
}
pub fn pulse(beats: &[f64], t: f64, k: f64) -> f64 {
    index(beats, t).map_or(0.0, |i| (-k * (t - beats[i])).exp())
}
pub fn down(beats: &[f64], offset: i64, t: f64) -> bool {
    (index(beats, t + 1e-4).map_or(-1, |i| i as i64) - offset).rem_euclid(4) == 0
}
pub fn count_rings(age: f64) -> Vec<(f64, f64, usize)> {
    let radius = 24.0 + 360.0 * (1.0 - (-age * 1.15).exp()) + 50.0 * age;
    (0..4)
        .filter_map(|j| {
            let r = radius * (1.0 - 0.13 * j as f64) - 6.0 * j as f64;
            let a = sat(1.0 - age / 2.3).powf(1.4) * (1.0 - 0.2 * j as f64) * sat(age / 0.04);
            (r >= 8.0 && a > 0.01).then_some((r, a, j))
        })
        .collect()
}
pub fn fall_rings(age: f64, size: f64, hero: bool) -> Vec<(f64, f64, usize)> {
    let h = if hero { 1.0 } else { 0.0 };
    let radius = size * (0.3 + (3.0 + 1.2 * h) * (1.0 - (-age * 1.25).exp()) + 0.35 * age);
    (0..4)
        .filter_map(|j| {
            let r = radius * (1.0 - 0.14 * j as f64) - size * 0.05 * j as f64;
            let a = sat(1.0 - age / (2.4 + 0.6 * h)).powf(1.5)
                * (1.0 - 0.2 * j as f64)
                * sat(age / 0.05);
            (r > size * 0.08 && a > 0.01).then_some((r, a, j))
        })
        .collect()
}
