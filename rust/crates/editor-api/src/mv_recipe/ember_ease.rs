use super::{math::clamp, model::Easing};

pub(super) fn inv(a: f64, b: f64, t: f64) -> f64 {
    clamp((t - a) / (b - a))
}
pub(super) fn sine(t: f64) -> f64 {
    -((std::f64::consts::PI * t).cos() - 1.0) / 2.0
}
pub(super) fn hit(t: f64, start: f64, k: f64) -> f64 {
    if t < start {
        0.0
    } else {
        (-(t - start) * k).exp()
    }
}
pub(super) fn jsround(t: f64) -> f64 {
    (t + 0.5).floor()
}
// Whip's negative anticipation can push otherwise valid endpoints above one.
// Check exact cubic-y extrema during admission, not in the middle of an export.
pub(super) fn iris_segment_valid(from: f64, to: f64, easing: Easing) -> bool {
    if !matches!(easing, Easing::Whip) {
        return true;
    }
    let cy = 3.0 * (-0.28);
    let by = 3.0 * (1.0 - (-0.28)) - cy;
    let ay = 1.0 - cy - by;
    let a = 3.0 * ay;
    let b = 2.0 * by;
    let discriminant: f64 = b * b - 4.0 * a * cy;
    for u in [
        (-b - discriminant.sqrt()) / (2.0 * a),
        (-b + discriminant.sqrt()) / (2.0 * a),
    ] {
        if (0.0..=1.0).contains(&u) {
            let y = ((ay * u + by) * u + cy) * u;
            let factor = from + (to - from) * y;
            if !(0.0..=1.0).contains(&factor) {
                return false;
            }
        }
    }
    true
}
pub(super) fn ease(x: f64, kind: Easing) -> f64 {
    let (x1, y1, x2, y2) = match kind {
        Easing::Out => (0.16, 1.0, 0.3, 1.0),
        Easing::In => (0.7, 0.0, 0.84, 0.0),
        Easing::Io => (0.83, 0.0, 0.17, 1.0),
        Easing::Soft => (0.45, 0.0, 0.2, 1.0),
        Easing::Whip => (0.6, -0.28, 0.2, 1.0),
    };
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
            lo = u
        } else {
            hi = u
        }
        u = (lo + hi) / 2.0;
    }
    sy(u)
}
