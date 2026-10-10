use super::math::*;
pub(super) type Point = [f64; 2];
pub(super) struct Main {
    pub points: &'static [Point],
    pub direction: f64,
    pub radius: f64,
    pub turns: f64,
    pub width: f64,
    pub delay: f64,
    pub duration: f64,
}
pub(super) const MAIN: [Main; 9] = [
    Main {
        points: &[
            [-60., 1030.],
            [260., 950.],
            [600., 850.],
            [860., 800.],
            [1080., 790.],
            [1270., 740.],
            [1400., 640.],
        ],
        direction: 1.,
        radius: 58.,
        turns: 1.15,
        width: 62.,
        delay: 0.,
        duration: 3.1,
    },
    Main {
        points: &[
            [1990., 150.],
            [1680., 250.],
            [1380., 360.],
            [1150., 420.],
            [820., 470.],
            [640., 430.],
            [540., 320.],
        ],
        direction: -1.,
        radius: 52.,
        turns: 1.1,
        width: 56.,
        delay: 0.35,
        duration: 3.2,
    },
    Main {
        points: &[[-50., 640.], [220., 610.], [460., 560.], [640., 520.]],
        direction: -1.,
        radius: 46.,
        turns: 1.2,
        width: 50.,
        delay: 0.25,
        duration: 2.8,
    },
    Main {
        points: &[[-60., -40.], [200., 110.], [430., 180.], [630., 220.]],
        direction: 1.,
        radius: 42.,
        turns: 1.15,
        width: 44.,
        delay: 0.9,
        duration: 2.8,
    },
    Main {
        points: &[[1980., 980.], [1720., 880.], [1470., 850.], [1260., 880.]],
        direction: 1.,
        radius: 40.,
        turns: 1.2,
        width: 50.,
        delay: 0.15,
        duration: 2.7,
    },
    Main {
        points: &[[1990., 610.], [1720., 590.], [1470., 540.], [1290., 500.]],
        direction: -1.,
        radius: 44.,
        turns: 1.15,
        width: 46.,
        delay: 0.6,
        duration: 2.9,
    },
    Main {
        points: &[[1900., -60.], [1700., 80.], [1500., 140.], [1330., 170.]],
        direction: -1.,
        radius: 36.,
        turns: 1.2,
        width: 40.,
        delay: 1.1,
        duration: 2.7,
    },
    Main {
        points: &[[520., 1120.], [600., 1030.], [700., 985.], [770., 975.]],
        direction: -1.,
        radius: 26.,
        turns: 1.25,
        width: 30.,
        delay: 0.5,
        duration: 2.3,
    },
    Main {
        points: &[[760., -70.], [740., 40.], [700., 110.]],
        direction: 1.,
        radius: 24.,
        turns: 1.2,
        width: 22.,
        delay: 1.5,
        duration: 2.2,
    },
];
pub(super) fn heading(p: &[Point]) -> f64 {
    let a = p[p.len() - 2];
    let b = p[p.len() - 1];
    (b[1] - a[1]).atan2(b[0] - a[0])
}
pub(super) fn crozier(
    p: Point,
    mut th: f64,
    dir: f64,
    mut radius: f64,
    turns: f64,
    ds: f64,
    shrink: f64,
) -> Vec<Point> {
    let [mut x, mut y] = p;
    let mut acc = 0.0;
    let mut out = vec![];
    while acc < turns * TAU && radius > 2.0 {
        th += dir * ds / radius;
        acc += ds / radius;
        x += th.cos() * ds;
        y += th.sin() * ds;
        out.push([x, y]);
        radius *= shrink;
    }
    out
}
pub(super) fn body(p: &[Point]) -> Vec<Point> {
    let mut dense = vec![];
    for k in 0..p.len() - 1 {
        let (p0, p1, p2, p3) = (
            p[k.saturating_sub(1)],
            p[k],
            p[k + 1],
            p[(k + 2).min(p.len() - 1)],
        );
        for j in 0..16 {
            let f = j as f64 / 16.0;
            let f2 = f * f;
            let f3 = f2 * f;
            dense.push(std::array::from_fn(|c| {
                0.5 * (2.0 * p1[c]
                    + (-p0[c] + p2[c]) * f
                    + (2.0 * p0[c] - 5.0 * p1[c] + 4.0 * p2[c] - p3[c]) * f2
                    + (-p0[c] + 3.0 * p1[c] - 3.0 * p2[c] + p3[c]) * f3)
            }));
        }
    }
    dense.push(*p.last().unwrap());
    let mut cum = vec![0.0];
    for q in dense.windows(2) {
        cum.push(cum.last().unwrap() + (q[1][0] - q[0][0]).hypot(q[1][1] - q[0][1]));
    }
    let length = *cum.last().unwrap();
    let n = p.len() * 22;
    let mut j = 0;
    (0..=n)
        .map(|i| {
            let s = (i as f64 / n as f64) * length;
            while j < cum.len() - 2 && cum[j + 1] < s {
                j += 1;
            }
            let f = (s - cum[j]) / (cum[j + 1] - cum[j]).max(1e-6);
            [
                lerp(dense[j][0], dense[j + 1][0], f),
                lerp(dense[j][1], dense[j + 1][1], f),
            ]
        })
        .collect()
}
