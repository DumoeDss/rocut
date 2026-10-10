use super::{
    camera::Camera,
    math::*,
    plan::{Action as A, Draw},
};
pub fn glints(seed: f64, n: usize, x0: f64, x1: f64, z0: f64, z1: f64) -> Vec<[f64; 3]> {
    (0..n)
        .map(|i| {
            [
                lerp(x0, x1, rnd(&[i as f64, seed])),
                z0 * (z1 / z0).powf(rnd(&[i as f64, seed + 1.0])),
                rnd(&[i as f64, seed + 2.0]),
            ]
        })
        .collect()
}
pub fn run_glints(zh: f64) -> Vec<[f64; 3]> {
    glints(97.0, 160, -1.5, 40.0, 1.0, 60.0)
        .into_iter()
        .map(|g| [g[0], zh - 30.0 + fract((g[1] - zh) / 60.0) * 60.0, g[2]])
        .collect()
}
pub fn world(
    d: &mut Draw,
    c: Camera,
    t: f64,
    dawn: f64,
    dx: f64,
    star_shift: f64,
    glints: &[[f64; 3]],
) {
    let yh = c.yh;
    if (yh - 1.0).min(1080.0) > -200.0 {
        d.linear(
            [0.0, yh - 950.0],
            [0.0, yh],
            &[
                (0.0, [3.0, 2.0, 7.0], 1.0),
                (0.55, [7.0, 5.0, 14.0], 1.0),
                (0.86, mix([14.0, 10.0, 26.0], [40.0, 26.0, 60.0], dawn), 1.0),
                (1.0, mix([30.0, 20.0, 44.0], [104.0, 62.0, 98.0], dawn), 1.0),
            ],
        );
        d.rect([-300.0, -300.0, 2520.0, yh + 300.0]);
    }
    if yh < 1380.0 {
        d.linear(
            [0.0, yh],
            [0.0, yh + 700.0],
            &[
                (0.0, mix([16.0, 12.0, 26.0], [44.0, 28.0, 50.0], dawn), 1.0),
                (0.08, [10.0, 8.0, 18.0], 1.0),
                (1.0, [4.0, 3.0, 8.0], 1.0),
            ],
        );
        d.rect([-300.0, yh, 2520.0, 1680.0 - yh]);
    }
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    for i in 0..70 {
        let i = i as f64;
        let sx = rnd(&[i, 801.0]) * 2320.0 - 200.0 + star_shift;
        let sy = yh - 60.0 - rnd(&[i, 802.0]) * 900.0;
        if sy < -10.0 || sy > 1080.0 {
            continue;
        }
        let al = (0.18 + 0.4 * rnd(&[i, 803.0]))
            * (0.6 + 0.4 * (t * (1.0 + rnd(&[i, 804.0])) + i).sin())
            * (1.0 - 0.7 * dawn)
            * smooth(0.0, 260.0, yh - sy);
        d.fill([220.0, 215.0, 255.0], al);
        d.rect([sx, sy, 1.6, 1.6]);
    }
    if dawn > 0.001 {
        d.a(A::Save);
        d.a(A::Translate { offset: [dx, yh] });
        d.a(A::BeginPath);
        d.a(A::RectPath {
            rect: [-4000.0, -3000.0, 8000.0, 3000.0],
        });
        d.a(A::Clip);
        d.a(A::Scale {
            factors: [1.0, 0.26],
        });
        d.radial(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1300.0],
            &[
                (0.0, [255.0, 222.0, 176.0], 0.9 * dawn),
                (0.18, [246.0, 168.0, 150.0], 0.55 * dawn),
                (0.5, [154.0, 106.0, 160.0], 0.22 * dawn),
                (1.0, [58.0, 45.0, 99.0], 0.0),
            ],
        );
        d.rect([-1300.0, -1300.0, 2600.0, 1300.0]);
        d.a(A::Restore);
        d.a(A::Save);
        d.a(A::Translate { offset: [dx, yh] });
        d.a(A::BeginPath);
        d.a(A::RectPath {
            rect: [-4000.0, 0.0, 8000.0, 3000.0],
        });
        d.a(A::Clip);
        d.a(A::Scale {
            factors: [1.0, 0.11],
        });
        d.radial(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1300.0],
            &[
                (0.0, [255.0, 214.0, 170.0], 0.55 * dawn),
                (0.2, [230.0, 150.0, 150.0], 0.25 * dawn),
                (1.0, [58.0, 45.0, 99.0], 0.0),
            ],
        );
        d.rect([-1300.0, 0.0, 2600.0, 1300.0]);
        d.a(A::Restore);
        d.a(A::Save);
        d.a(A::Translate { offset: [dx, yh] });
        d.a(A::Scale {
            factors: [1.0, 5.5],
        });
        d.radial(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 70.0],
            &[
                (0.0, [255.0, 220.0, 180.0], 0.22 * dawn),
                (1.0, [255.0, 220.0, 180.0], 0.0),
            ],
        );
        d.rect([-70.0, 0.0, 140.0, 70.0]);
        d.a(A::Restore);
        d.linear(
            [dx - 1500.0, 0.0],
            [dx + 1500.0, 0.0],
            &[
                (0.0, [255.0, 200.0, 170.0], 0.0),
                (0.5, [255.0, 236.0, 210.0], 0.75 * dawn),
                (1.0, [255.0, 200.0, 170.0], 0.0),
            ],
        );
        d.rect([dx - 1500.0, yh - 1.0, 3000.0, 2.0]);
    }
    d.linear(
        [0.0, yh - 70.0],
        [0.0, yh + 60.0],
        &[
            (0.0, [90.0, 70.0, 120.0], 0.0),
            (0.55, [110.0, 80.0, 130.0], 0.1 + 0.16 * dawn),
            (1.0, [90.0, 70.0, 120.0], 0.0),
        ],
    );
    d.rect([-300.0, yh - 70.0, 2520.0, 130.0]);
    for gp in glints {
        let Some(p) = c.p([gp[0], 0.0, gp[1]]) else {
            continue;
        };
        if p[1] < yh + 1.0 || p[1] > 1090.0 {
            continue;
        }
        let spec = (-((p[0] - dx) / 900.0).powi(2)).exp() * (0.25 + dawn);
        let tw = 0.5 + 0.5 * (t * (2.0 + gp[2] * 3.0) + gp[2] * 40.0).sin();
        let al = spec * tw * 0.5 * (6.0 / p[2] + 0.2).min(1.0);
        if al < 0.02 {
            continue;
        }
        let len = (3.0 + 180.0 / p[2]).min(40.0);
        d.fill([255.0, 226.0, 200.0], al);
        d.rect([p[0] - len / 2.0, p[1], len, (5.0 / p[2]).max(0.8)]);
    }
    d.a(A::Restore);
}
pub fn motes(d: &mut Draw, c: Camera, t: f64, t0: f64, hw: f64, zmin: f64, zmax: f64, a: f64) {
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    for i in 0..70 {
        let i = i as f64;
        let life = 2.6 + 2.2 * rnd(&[i, 901.0]);
        let k = fract((t - t0) / life + rnd(&[i, 902.0]));
        let x = (rnd(&[i, 903.0]) - 0.5) * 2.0 * hw * 1.7;
        let z = zmin + (zmax - zmin) * rnd(&[i, 904.0]).powf(1.6);
        if t <= t0 + 0.1 + (z - 4.0).abs() * 0.021 + 0.3 {
            continue;
        }
        let y = 0.05 + k * (0.9 + 1.4 * rnd(&[i, 905.0]));
        let al = (std::f64::consts::PI * k).sin() * (0.35 + 0.65 * rnd(&[i, 906.0])) * a;
        let Some(p) = c.p([x + fbm(t * 0.3 + i, 907.0) * 0.3, y, z]) else {
            continue;
        };
        let r = (26.0 / p[2]).max(1.0);
        let col = ramp(zk(z));
        d.radial(
            [p[0], p[1], 0.0],
            [p[0], p[1], r * 3.0],
            &[
                (0.0, [255.0, 250.0, 238.0], al),
                (0.3, col, al * 0.6),
                (1.0, col, 0.0),
            ],
        );
        d.rect([p[0] - r * 3.0, p[1] - r * 3.0, r * 6.0, r * 6.0]);
        let Some(q) = c.p([x, -y, z]) else {
            continue;
        };
        d.radial(
            [q[0], q[1], 0.0],
            [q[0], q[1], r * 3.0],
            &[(0.0, col, al * 0.25), (1.0, col, 0.0)],
        );
        d.rect([q[0] - r * 3.0, q[1] - r * 3.0, r * 6.0, r * 6.0]);
    }
    d.a(A::Restore);
}
