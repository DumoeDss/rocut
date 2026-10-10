pub(super) use super::seeded::{Rng, TAU, clamp, lerp, rnd, rnds};
pub(super) fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let k = clamp((v - a) / (b - a));
    k * k * (3.0 - 2.0 * k)
}
pub(super) fn travel(t: f64, dur: f64, v0: f64, v1: f64) -> f64 {
    if t <= 0.0 {
        v0 * t
    } else if t <= dur {
        v0 * t + (v1 - v0) * t * t * t / (3.0 * dur * dur)
    } else {
        v0 * dur + (v1 - v0) * dur / 3.0 + v1 * (t - dur)
    }
}
pub(super) fn vp(t: f64) -> [f64; 2] {
    [
        960.0 + 34.0 * (t * 0.85 + 0.4).sin() + 12.0 * (t * 2.1).sin(),
        540.0 + 20.0 * (t * 0.6 + 1.3).sin(),
    ]
}
pub(super) fn damp(t: f64) -> f64 {
    if t < 0.0 {
        0.0
    } else {
        (-t * 6.0).exp() * (t * TAU * 0.8).cos()
    }
}
/// typo.js helper, not converge's different early-return solver.
pub(super) fn bez(x: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let (cx, cy) = (3.0 * x1, 3.0 * y1);
    let (bx, by) = (3.0 * (x2 - x1) - cx, 3.0 * (y2 - y1) - cy);
    let (ax, ay) = (1.0 - cx - bx, 1.0 - cy - by);
    let sx = |u: f64| ((ax * u + bx) * u + cx) * u;
    let mut u = x;
    for _ in 0..6 {
        let e = sx(u) - x;
        let d = (3.0 * ax * u + 2.0 * bx) * u + cx;
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
    ((ay * u + by) * u + cy) * u
}
pub(super) fn soft(x: f64) -> f64 {
    bez(x, 0.33, 0.0, 0.2, 1.0)
}
pub(super) fn io(x: f64) -> f64 {
    bez(x, 0.65, 0.0, 0.35, 1.0)
}
pub(super) fn out(x: f64) -> f64 {
    bez(x, 0.16, 1.0, 0.3, 1.0)
}
pub(super) fn rgb(h: u32) -> [f64; 4] {
    [
        ((h >> 16) & 255) as f64,
        ((h >> 8) & 255) as f64,
        (h & 255) as f64,
        1.0,
    ]
}
pub(super) fn mix(a: [f64; 4], b: [f64; 4], k: f64) -> [f64; 4] {
    [
        lerp(a[0], b[0], k),
        lerp(a[1], b[1], k),
        lerp(a[2], b[2], k),
        lerp(a[3], b[3], k),
    ]
}
/// css() applies JavaScript |0 before the browser parses channel bytes.
pub(super) fn css(mut c: [f64; 4], a: f64) -> [f64; 4] {
    for v in &mut c[..3] {
        *v = v.trunc() / 255.0;
    }
    c[3] = a;
    c
}
