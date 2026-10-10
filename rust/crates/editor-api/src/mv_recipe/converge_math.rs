pub(super) const TAU: f64 = std::f64::consts::TAU;
pub(super) fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
pub(super) fn lerp(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
pub(super) fn seg(t: f64, start: f64, duration: f64) -> f64 {
    clamp((t - start) / duration)
}
pub(super) fn cube(v: f64) -> f64 {
    v * v * v
}
pub(super) fn hash(values: &[f64]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for v in values {
        h ^= (v * 1_000_003.0).floor().rem_euclid(4_294_967_296.0) as u32;
        h = h.wrapping_mul(0x0100_0193);
        h ^= h >> 13;
        h = h.wrapping_mul(0x5bd1_e995);
        h ^= h >> 15;
    }
    h
}
pub(in crate::mv_recipe) fn rnd(i: f64, seed: f64) -> f64 {
    f64::from(hash(&[i, seed])) / 4_294_967_296.0
}
pub(in crate::mv_recipe) fn rnds(i: f64, seed: f64) -> f64 {
    rnd(i, seed) * 2.0 - 1.0
}
pub(in crate::mv_recipe) fn noise(x: f64, seed: f64) -> f64 {
    let i = x.floor();
    let f = x - i;
    lerp(rnds(i, seed), rnds(i + 1.0, seed), f * f * (3.0 - 2.0 * f))
}
pub(in crate::mv_recipe) struct Rng(u32);
impl Rng {
    pub fn new(seed: f64) -> Self {
        Self(hash(&[seed]))
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let t = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        let t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}
// Preserve intro.js's precise Newton early return and bisection fallback.
// TypeCard has a different house helper; sharing that approximation changes beat kicks.
pub(super) fn out(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let (x1, x2, y1, y2) = (0.16, 0.3, 1.0, 1.0);
    let cx = 3.0 * x1;
    let bx = 3.0 * (x2 - x1) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;
    let sx = |u: f64| ((ax * u + bx) * u + cx) * u;
    let sy = |u: f64| ((ay * u + by) * u + cy) * u;
    let dx = |u: f64| (3.0 * ax * u + 2.0 * bx) * u + cx;
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
