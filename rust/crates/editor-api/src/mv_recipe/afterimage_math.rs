use super::model::Grain;

// Reference JS uses Math.floor(x * 1000003) | 0, then 32-bit imul.
// A Rust float-to-int cast saturates, so explicitly retain modulo-2^32 bits.
pub(super) fn hash(values: &[f64]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for x in values {
        h ^= (x * 1_000_003.0).floor().rem_euclid(4_294_967_296.0) as u32;
        h = h.wrapping_mul(0x0100_0193);
        h ^= h >> 13;
        h = h.wrapping_mul(0x5bd1_e995);
        h ^= h >> 15;
    }
    h
}
fn random(values: &[f64]) -> f64 {
    f64::from(hash(values)) / 4_294_967_296.0
}
pub(super) fn noise(x: f64, seed: u32) -> f64 {
    let i = x.floor();
    let f = x - i;
    let u = f * f * (3.0 - 2.0 * f);
    let a = random(&[i, f64::from(seed)]) * 2.0 - 1.0;
    let b = random(&[i + 1.0, f64::from(seed)]) * 2.0 - 1.0;
    a + (b - a) * u
}
pub(super) fn sine(x: f64) -> f64 {
    (1.0 - (std::f64::consts::PI * x.clamp(0.0, 1.0)).cos()) / 2.0
}
pub(super) fn rise(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    // cubic-bezier(.16, 1, .3, 1), including reference solver tolerances.
    let sx = |u: f64| ((0.58 * u - 0.06) * u + 0.48) * u;
    let sy = |u: f64| ((u - 3.0) * u + 3.0) * u;
    let dx = |u: f64| (1.74 * u - 0.12) * u + 0.48;
    let mut u = x;
    for _ in 0..6 {
        let e = sx(u) - x;
        let d = dx(u);
        if e.abs() < 1e-6 {
            return sy(u);
        }
        if d.abs() < 1e-6 {
            break;
        }
        u -= e / d;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    u = x;
    for _ in 0..30 {
        let v = sx(u);
        if (v - x).abs() < 1e-7 {
            break;
        }
        if v < x {
            lo = u;
        } else {
            hi = u;
        }
        u = (lo + hi) / 2.0;
    }
    sy(u)
}
fn next(a: &mut u32) -> f64 {
    *a = a.wrapping_add(0x6d2b_79f5);
    let t = (*a ^ (*a >> 15)).wrapping_mul(1 | *a);
    let t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    f64::from(t ^ (t >> 14)) / 4_294_967_296.0
}
pub(super) fn grain(seed: u32, sample: u64, opacity: f64) -> Option<Grain> {
    if opacity == 0.0 {
        return None;
    }
    let tile_seed = seed.wrapping_add(900 + (sample % 4) as u32);
    let mut state = hash(&[f64::from(tile_seed)]);
    let gray = (0..65_536)
        .map(|_| {
            let value =
                128.0 + (next(&mut state) + next(&mut state) + next(&mut state) - 1.5) * 92.0;
            // Uint8ClampedArray uses nearest, with ties-to-even, not truncation.
            value.clamp(0.0, 255.0).round_ties_even() as u8
        })
        .collect();
    Some(Grain {
        size: [256, 256],
        gray,
        opacity,
        offset: [1, 2].map(|channel| {
            (random(&[sample as f64, f64::from(seed.wrapping_add(channel))]) * 256.0).floor() as u32
        }),
    })
}
