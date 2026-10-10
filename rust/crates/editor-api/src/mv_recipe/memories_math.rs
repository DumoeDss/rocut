#[path = "converge_math.rs"]
mod seeded;
pub fn rnd(xs: &[f64]) -> f64 {
    seeded::hash(xs) as f64 / 4294967296.0
}
pub fn rnds(xs: &[f64]) -> f64 {
    rnd(xs) * 2.0 - 1.0
}
pub fn noise(x: f64, seed: f64) -> f64 {
    seeded::noise(x, seed)
}
pub fn fbm1(x: f64, seed: f64) -> f64 {
    let (mut sum, mut a, mut f) = (0.0, 0.5, 1.0);
    for o in 0..3 {
        sum += a * noise(x * f, seed + o as f64 * 17.0);
        a *= 0.5;
        f *= 2.0;
    }
    sum
}
pub fn vn2(x: f64, y: f64, s: f64) -> f64 {
    let xi = x.floor();
    let yi = y.floor();
    let xf = x - xi;
    let yf = y - yi;
    let u = xf * xf * (3.0 - 2.0 * xf);
    let v = yf * yf * (3.0 - 2.0 * yf);
    let a = rnd(&[xi, yi, s]);
    let b = rnd(&[xi + 1.0, yi, s]);
    let c = rnd(&[xi, yi + 1.0, s]);
    let d = rnd(&[xi + 1.0, yi + 1.0, s]);
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
pub fn fbm2(x: f64, y: f64, s: f64, oct: usize) -> f64 {
    let (mut t, mut a, mut f, mut n) = (0.0, 0.5, 1.0, 0.0);
    for o in 0..oct {
        t += a * vn2(x * f, y * f, s + o as f64 * 31.0);
        n += a;
        a *= 0.5;
        f *= 2.03;
    }
    t / n
}
pub fn hsh(x: f64, y: f64, s: f64) -> f64 {
    let h = (x * 374761393.0 + y * 668265263.0 + s * 2147483647.0)
        .trunc()
        .rem_euclid(4294967296.0) as u32;
    let h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    (h ^ (h >> 16)) as f64 / 4294967296.0
}
pub fn byte(v: f64) -> u8 {
    let v = v.clamp(0.0, 255.0);
    let f = v.floor();
    let k = v - f;
    if k > 0.5 || (k == 0.5 && (f as u32) % 2 == 1) {
        (f + 1.0) as u8
    } else {
        f as u8
    }
}
pub fn inv(a: f64, b: f64, v: f64) -> f64 {
    ((v - a) / (b - a)).clamp(0.0, 1.0)
}
pub fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let k = inv(a, b, v);
    k * k * (3.0 - 2.0 * k)
}
pub fn in_out_sine(k: f64) -> f64 {
    -((std::f64::consts::PI * k).cos() - 1.0) / 2.0
}
pub fn out_cubic(k: f64) -> f64 {
    1.0 - (1.0 - k).powi(3)
}
pub fn lerp(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
pub struct Rng(seeded::Rng);
impl Rng {
    pub fn new(seed: f64) -> Self {
        Self(seeded::Rng::new(seed))
    }
    pub fn next(&mut self) -> f64 {
        self.0.next()
    }
    pub fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next()
    }
}
