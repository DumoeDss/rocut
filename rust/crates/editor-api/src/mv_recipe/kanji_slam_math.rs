pub(super) use super::seeded::{Rng, TAU, clamp, hash, lerp, noise, rnd, rnds};

pub(super) fn random(values: &[f64]) -> f64 {
    f64::from(hash(values)) / 4_294_967_296.0
}
pub(super) fn quant(time: f64, fps: f64) -> f64 {
    (time * fps + 1e-6).floor() / fps
}
pub(super) fn frame(time: f64, fps: f64) -> f64 {
    (time * fps + 1e-6).floor()
}
pub(super) fn round(value: f64) -> f64 {
    (value + 0.5).floor()
}
pub(super) fn damp(u: f64, amp: f64, rate: f64, hz: f64) -> f64 {
    if u < 0.0 {
        0.0
    } else {
        amp * (-u * rate).exp() * (u * TAU * hz).cos()
    }
}
// typo.js uses a different Newton termination than intro.js. Preserve its
// coefficients, six iterations and conditional 24-step bisection exactly.
pub(super) fn bezier(x: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
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
pub(super) fn out(x: f64) -> f64 {
    bezier(x, 0.16, 1.0, 0.3, 1.0)
}
pub(super) fn io(x: f64) -> f64 {
    bezier(x, 0.65, 0.0, 0.35, 1.0)
}
pub(super) fn small(ch: char) -> bool {
    "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ".contains(ch)
}
pub(super) fn particle(ch: char) -> bool {
    "はがをにへとでのもやかねよ".contains(ch)
}
