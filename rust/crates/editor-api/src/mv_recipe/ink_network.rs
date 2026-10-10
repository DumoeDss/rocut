use super::{math::*, paths::*};
pub(super) struct Tendril {
    pub points: Vec<Point>,
    pub front: Option<Vec<bool>>,
    pub width: f64,
    pub end_width: Option<f64>,
    pub delay: f64,
    pub duration: f64,
    pub seed: f64,
}
pub(super) struct Network {
    pub tendrils: Vec<Tendril>,
    pub pools: Vec<[f64; 6]>,
}
impl Network {
    pub fn new(seed: u32) -> Self {
        let mut r = Rng::new(seed as f64);
        let mut tendrils = vec![];
        for (i, a) in MAIN.iter().enumerate() {
            let jitter: Vec<_> = a
                .points
                .iter()
                .enumerate()
                .map(|(k, p)| {
                    if k == 0 {
                        *p
                    } else {
                        [
                            p[0] + range(&mut r, -18., 18.),
                            p[1] + range(&mut r, -14., 14.),
                        ]
                    }
                })
                .collect();
            let body = body(&jitter);
            let mut points = body.clone();
            points.extend(crozier(
                *body.last().unwrap(),
                heading(&body),
                a.direction,
                a.radius,
                a.turns,
                4.,
                0.972,
            ));
            tendrils.push(Tendril {
                points,
                front: None,
                width: a.width,
                end_width: None,
                delay: a.delay,
                duration: a.duration,
                seed: (i * 7 + 1) as f64,
            });
            let branches = 2 + usize::from(r.next() < 0.6);
            for b in 0..branches {
                let f = 0.22 + 0.5 * r.next();
                let k = (f * (body.len() - 1) as f64).floor() as usize;
                let side = if r.next() < 0.5 { -1. } else { 1. };
                let mut th = heading(&body[..k + 2]) + side * (0.5 + 0.5 * r.next());
                let [mut x, mut y] = body[k];
                let mut stem = vec![];
                let mut q = 0;
                // The original consumes R() on EVERY loop-condition evaluation,
                // including the final failed condition. Never cache the bound.
                while (q as f64) < 10.0 + r.next() * 14.0 {
                    th += side * 0.03;
                    x += th.cos() * 5.;
                    y += th.sin() * 5.;
                    stem.push([x, y]);
                    q += 1;
                }
                let mut points = vec![body[k]];
                points.extend(&stem);
                let radius = 14.0 + r.next() * 16.0;
                let turns = 1.0 + 0.4 * r.next();
                points.extend(crozier(
                    *stem.last().unwrap(),
                    th,
                    side,
                    radius,
                    turns,
                    3.,
                    0.96,
                ));
                let width = a.width * (0.28 + 0.14 * r.next()) * (1.0 - f * 0.5);
                let duration = 0.9 + 0.7 * r.next();
                tendrils.push(Tendril {
                    points,
                    front: None,
                    width,
                    end_width: None,
                    delay: a.delay + f * a.duration * 0.8,
                    duration,
                    seed: (i * 7 + b + 3) as f64,
                });
            }
        }
        let mut points = vec![];
        let mut front = vec![];
        for i in 0..=160 {
            let u = i as f64 / 160.;
            let y = lerp(995., 640., u);
            let ph = -0.9 + u * 3.1 * std::f64::consts::PI;
            let rx = lerp(95., 175., smooth(u));
            points.push([960. + ph.sin() * rx, y + ph.cos() * 12.]);
            front.push(ph.cos() > 0.);
        }
        let end = crozier(
            *points.last().unwrap(),
            heading(&points),
            -1.,
            22.,
            1.1,
            3.,
            0.965,
        );
        for point in end {
            points.push(point);
            front.push(false);
        }
        tendrils.push(Tendril {
            points,
            front: Some(front),
            width: 12.,
            end_width: Some(2.2),
            delay: 0.8,
            duration: 3.2,
            seed: 99.,
        });
        let mut pools = vec![];
        for i in 0..16 {
            let x = lerp(-80., 2000., i as f64 / 15.) + range(&mut r, -40., 40.);
            let near = (x - 960.).abs() < 260.;
            let y = 1100. + range(&mut r, 0., 40.);
            let radius = if near {
                range(&mut r, 40., 70.)
            } else {
                range(&mut r, 90., 180.)
            };
            pools.push([
                x,
                y,
                radius,
                0.42,
                range(&mut r, 0., 1.2),
                range(&mut r, 2.6, 3.6),
            ]);
        }
        pools.push([960., 994., 130., 0.17, 0.2, 3.2]);
        for [x, y] in [
            [-150., -130.],
            [2070., -130.],
            [-170., 1190.],
            [2090., 1190.],
        ] {
            pools.push([
                x,
                y,
                range(&mut r, 300., 400.),
                1.,
                range(&mut r, 0.1, 0.8),
                3.6,
            ]);
        }
        Self { tendrils, pools }
    }
}
