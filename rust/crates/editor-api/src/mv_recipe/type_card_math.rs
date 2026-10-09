use super::plan::Grain;
pub(super) fn clamp(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}
pub(super) fn smooth(x: f64) -> f64 {
    let x = clamp(x);
    x * x * (3.0 - 2.0 * x)
}
pub(super) fn bezier(x: f64, x1: f64, x2: f64, y1: f64, y2: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
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
        if e.abs() < 1e-5 || d.abs() < 1e-6 {
            break;
        }
        u -= e / d;
    }
    if !(0.0..=1.0).contains(&u) || (sx(u) - x).abs() > 1e-3 {
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..24 {
            u = (lo + hi) / 2.0;
            if sx(u) < x {
                lo = u;
            } else {
                hi = u;
            }
        }
    }
    sy(u)
}
pub(super) fn soft(x: f64) -> f64 {
    bezier(x, 0.33, 0.2, 0.0, 1.0)
}
pub(super) fn out(x: f64) -> f64 {
    bezier(x, 0.16, 0.3, 1.0, 1.0)
}
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
pub(super) struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(hash(&[f64::from(seed)]))
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let t = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        let t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}
pub(super) fn grain(seed: u32, sample: u64, opacity: f64) -> Option<Grain> {
    if opacity == 0.0 {
        return None;
    }
    let mut rng = Rng::new(seed.wrapping_add(4242));
    let gray = (0..65_536)
        .map(|_| ((rng.next() * 0.6 + rng.next() * 0.4) * 255.0).floor() as u8)
        .collect();
    Some(Grain {
        size: [256, 256],
        gray,
        opacity,
        offset: [1, 2].map(|c| {
            (random(&[sample as f64, f64::from(seed.wrapping_add(c))]) * 256.0).floor() as u32
        }),
    })
}
