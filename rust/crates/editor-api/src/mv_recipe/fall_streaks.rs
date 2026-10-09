use super::{clock::Clock, draw::*, math::*, model::Fall, plan::*, raster::*};
fn streak(
    d: &mut Draw,
    vp: [f64; 2],
    dist: f64,
    v: f64,
    i: f64,
    seed: f64,
    rate: f64,
    bright: f64,
    wmul: f64,
    lmul: f64,
) {
    let th = lerp(0.03, 0.97, rnd(i, seed)) * std::f64::consts::PI;
    let k = fract(rnd(i, seed + 1.0) + dist * rate * (0.7 + 0.6 * rnd(i, seed + 2.0)));
    let z = 1.0 + 9.0 * k;
    let depth = 1500.0 * (0.7 + 0.6 * rnd(i, seed + 3.0)) / z;
    let len = (((depth * depth / 1500.0) * (0.28 + 0.42 * v) + 8.0) * lmul).min(1300.0);
    let (cy, cx) = th.sin_cos();
    let head = [vp[0] + cx * depth, vp[1] + cy * depth];
    let tail = [head[0] + cx * len, head[1] + cy * len];
    let alpha = smooth(0.0, 0.06, k)
        * (1.0 - smooth(0.4, 0.95, k))
        * (0.2 + 0.8 * rnd(i, seed + 4.0))
        * bright;
    if alpha < 0.02 {
        return;
    }
    let warm = rnd(i, seed + 5.0) < 0.1;
    let gradient = linear(
        head,
        tail,
        &[
            (
                0.0,
                if warm {
                    rgb(255, 197, 138, alpha)
                } else {
                    rgb(224, 238, 255, alpha)
                },
            ),
            (
                0.3,
                if warm {
                    rgb(255, 154, 90, alpha * 0.5)
                } else {
                    rgb(143, 178, 201, alpha * 0.5)
                },
            ),
            (
                1.0,
                if warm {
                    rgb(240, 102, 58, 0.0)
                } else {
                    rgb(63, 98, 132, 0.0)
                },
            ),
        ],
    );
    d.path(
        line(head, tail),
        vec![stroke(
            gradient,
            (0.5 + 2.4 * depth / 1500.0) * wmul,
            "round",
            "miter",
        )],
    );
}
pub(super) fn draw(d: &mut Draw, a: &Fall, c: &Clock, dist: f64, v: f64) {
    for i in 0..150 {
        streak(d, a.vp, dist, v, i as f64, 1.0, 0.24, 0.6, 1.0, 1.0);
    }
    for i in 0..26 {
        streak(d, a.vp, dist, v, i as f64, 11.0, 0.36, 1.0, 1.8, 1.5);
    }
    let camera = d.operations.clone();
    for i in 0..40 {
        let i = i as f64;
        let th = lerp(0.02, 0.98, rnd(i, 21.0)) * std::f64::consts::PI;
        let k = fract(rnd(i, 22.0) + dist * (0.08 + 0.1 * rnd(i, 23.0)));
        let z = 1.0 + 7.0 * k;
        let depth = 1500.0 * (0.6 + 0.7 * rnd(i, 24.0)) / z;
        let x = a.vp[0] + th.cos() * depth;
        let y = a.vp[1] + th.sin() * depth;
        let r = 3.0 + 48.0 * (depth / 1500.0).powf(1.6);
        let alpha = smooth(0.0, 0.1, k)
            * (1.0 - smooth(0.5, 1.0, k))
            * (0.35 + 0.65 * rnd(i, 25.0))
            * (0.8 + 0.5 * c.beat);
        if alpha < 0.02 {
            continue;
        }
        let col = if rnd(i, 26.0) < 0.15 {
            rgb(255, 178, 122, 1.0)
        } else if rnd(i, 27.0) < 0.5 {
            rgb(127, 196, 234, 1.0)
        } else {
            rgb(74, 140, 184, 1.0)
        };
        d.operations = camera.clone();
        d.operations.extend([
            Operation::Translate { offset: [x, y] },
            Operation::Rotate { radians: th },
            Operation::Scale {
                factors: [1.0 + 0.5 * v, 1.0],
            },
        ]);
        d.path(
            circle(0.0, 0.0, r),
            vec![
                fill(solid(rgba(col, 0.12 * alpha)), "lighter"),
                stroke(solid(rgba(col, 0.32 * alpha)), 1.5, "round", "miter"),
            ],
        );
    }
    d.operations = camera;
}
