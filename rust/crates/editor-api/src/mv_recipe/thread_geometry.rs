use super::{clock::Clock, hand::Hand, math::*, model::Thread, state::State};
pub(super) type Point = [f64; 2];

pub(super) fn normals(p: &[Point]) -> Vec<Point> {
    p.iter()
        .enumerate()
        .map(|(i, _)| {
            let a = p[i.saturating_sub(1)];
            let b = p[(i + 1).min(p.len() - 1)];
            let (tx, ty) = (b[0] - a[0], b[1] - a[1]);
            let len = tx.hypot(ty);
            let len = if len == 0.0 { 1.0 } else { len };
            [-ty / len, tx / len]
        })
        .collect()
}
fn catmull(p: &[Point]) -> Vec<Point> {
    let mut out = Vec::new();
    for k in 0..p.len() - 1 {
        let (p0, p1, p2, p3) = (
            p[k.saturating_sub(1)],
            p[k],
            p[k + 1],
            p[(k + 2).min(p.len() - 1)],
        );
        for j in 0..20 {
            let f = j as f64 / 20.0;
            let f2 = f * f;
            let f3 = f2 * f;
            out.push(std::array::from_fn(|c| {
                0.5 * (2.0 * p1[c]
                    + (-p0[c] + p2[c]) * f
                    + (2.0 * p0[c] - 5.0 * p1[c] + 4.0 * p2[c] - p3[c]) * f2
                    + (-p0[c] + 3.0 * p1[c] - 3.0 * p2[c] + p3[c]) * f3)
            }));
        }
    }
    out.push(*p.last().unwrap());
    out
}
fn resample(p: &[Point]) -> Vec<Point> {
    let mut cum = vec![0.0];
    for pair in p.windows(2) {
        cum.push(cum.last().unwrap() + (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]));
    }
    let len = *cum.last().unwrap();
    let mut j = 0;
    (0..=300)
        .map(|i| {
            let s = i as f64 / 300.0 * len;
            while j < cum.len() - 2 && cum[j + 1] < s {
                j += 1;
            }
            let f = (s - cum[j]) / (cum[j + 1] - cum[j]).max(1e-6);
            [lerp(p[j][0], p[j + 1][0], f), lerp(p[j][1], p[j + 1][1], f)]
        })
        .collect()
}
pub(super) fn visible(a: &Thread, c: &Clock, s: &State, hand: &Hand) -> Vec<Point> {
    let t0 = hand.map([845.0, 968.0]);
    let td = hand.dir([0.52, 0.86]);
    let x = |f| lerp(t0[0], a.light[0], f);
    let y = |f| lerp(t0[1], a.light[1], f);
    let ctrl = [
        t0,
        [t0[0] + td[0] * 70.0, t0[1] + td[1] * 70.0],
        [x(0.2), y(0.0) + 95.0],
        [x(0.4), y(0.1) + 70.0],
        [x(0.58), y(0.36)],
        [x(0.76), y(0.66) - 10.0],
        [x(0.92), y(0.9) - 6.0],
        [a.light[0] - 40.0, a.light[1] + 62.0],
    ];
    let ctrl: Vec<_> = ctrl
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i < 2 {
                *p
            } else {
                [
                    p[0] + fbm(c.quantized * 0.35 + i as f64 * 3.1, 11.0) * 30.0,
                    p[1] + fbm(c.quantized * 0.3 + i as f64 * 5.7, 12.0) * 30.0,
                ]
            }
        })
        .collect();
    let base = resample(&catmull(&ctrl));
    let normals = normals(&base);
    let count = ((s.growth * 300.0).round() as usize + 1).max(5);
    base.iter()
        .zip(normals)
        .enumerate()
        .take(count)
        .map(|(i, (p, n))| {
            let u = i as f64 / 300.0;
            let amp = 30.0 * smooth(0.0, 0.25, u) * (0.45 + 0.9 * u) * (1.0 + 0.45 * s.beat);
            let wave = (TAU * 2.1 * u - 3.4 * c.quantized).sin()
                + 0.35 * (TAU * 4.7 * u - 6.1 * c.quantized + 1.7).sin();
            let bump = if s.tug > -0.3 && s.tug < 1.5 {
                (-((u - s.tug) / 0.075).powi(2)).exp()
                    * 64.0
                    * smooth(0.0, 0.12, u)
                    * (1.0 - 0.35 * clamp(s.tug))
            } else {
                0.0
            };
            let d = amp * wave - bump;
            [p[0] + n[0] * d, p[1] + n[1] * d]
        })
        .collect()
}
