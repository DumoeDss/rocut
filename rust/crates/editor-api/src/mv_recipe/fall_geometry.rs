use super::{character::Character, clock::Clock, math::*};
pub(super) type Point = [f64; 2];
pub(super) fn normals(p: &[Point]) -> Vec<Point> {
    p.iter()
        .enumerate()
        .map(|(i, _)| {
            let a = p[i.saturating_sub(1)];
            let b = p[(i + 1).min(p.len() - 1)];
            let (x, y) = (b[0] - a[0], b[1] - a[1]);
            let n = x.hypot(y);
            let n = if n == 0.0 { 1.0 } else { n };
            [-y / n, x / n]
        })
        .collect()
}
fn catmull(p: &[Point]) -> Vec<Point> {
    let mut out = vec![];
    for k in 0..p.len() - 1 {
        let (a, b, c, d) = (
            p[k.saturating_sub(1)],
            p[k],
            p[k + 1],
            p[(k + 2).min(p.len() - 1)],
        );
        for j in 0..14 {
            let f = j as f64 / 14.0;
            let f2 = f * f;
            let f3 = f2 * f;
            out.push(std::array::from_fn(|i| {
                0.5 * (2.0 * b[i]
                    + (-a[i] + c[i]) * f
                    + (2.0 * a[i] - 5.0 * b[i] + 4.0 * c[i] - d[i]) * f2
                    + (-a[i] + 3.0 * b[i] - 3.0 * c[i] + d[i]) * f3)
            }));
        }
    }
    out.push(*p.last().unwrap());
    out
}
fn resample(p: &[Point]) -> Vec<Point> {
    let mut lengths = vec![0.0];
    for pair in p.windows(2) {
        lengths.push(
            lengths.last().unwrap() + (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]),
        );
    }
    let total = *lengths.last().unwrap();
    let mut j = 0;
    (0..=110)
        .map(|i| {
            let at = i as f64 / 110.0 * total;
            while j < lengths.len() - 2 && lengths[j + 1] < at {
                j += 1;
            }
            let f = (at - lengths[j]) / (lengths[j + 1] - lengths[j]).max(1e-6);
            [lerp(p[j][0], p[j + 1][0], f), lerp(p[j][1], p[j + 1][1], f)]
        })
        .collect()
}
pub(super) fn ribbon(h: &Character, c: &Clock, velocity: f64) -> Vec<Point> {
    let r0 = h.map([793.0, 502.0]);
    let len = 250.0 + 50.0 * velocity;
    let (sn, cs) = h.rotation.sin_cos();
    let (ux, uy) = (0.28 * cs - -0.96 * sn, 0.28 * sn + -0.96 * cs);
    let (px, py) = (-uy, ux);
    let control = [
        r0,
        [
            r0[0] + ux * len * 0.2 + px * 14.0,
            r0[1] + uy * len * 0.2 + py * 14.0,
        ],
        [
            r0[0] + ux * len * 0.5 - px * 22.0,
            r0[1] + uy * len * 0.5 - py * 22.0,
        ],
        [
            r0[0] + ux * len * 0.8 + px * 18.0,
            r0[1] + uy * len * 0.8 + py * 18.0,
        ],
        [r0[0] + ux * len + px * 30.0, r0[1] + uy * len + py * 30.0],
    ];
    let base = resample(&catmull(&control));
    let n = normals(&base);
    base.iter()
        .zip(n)
        .enumerate()
        .map(|(i, (p, n))| {
            let u = i as f64 / (base.len() - 1) as f64;
            let d = (6.0 + 30.0 * u)
                * u
                * ((TAU * 1.7 * u - c.quantized * 10.0).sin()
                    + 0.35 * (TAU * 3.9 * u - c.quantized * 16.0 + 1.0).sin());
            [p[0] + n[0] * d, p[1] + n[1] * d]
        })
        .collect()
}
