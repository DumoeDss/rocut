use super::{
    math::*,
    model::{Args, Sample},
    plan::{Action as A, Command, Draw},
    timing,
};
pub fn draw(d: &mut Draw, a: &Args, s: &Sample<'_>) {
    let t = s.song_ticks as f64 / 120000.0;
    let tm = timing::tear(a, s);
    let c = timing::tear_camera(&tm, t);
    let ai = t - tm.impact;
    let ah = t - tm.horizon;
    let ao = t - tm.open;
    let dawn = 0.1
        + 0.42 * smooth(tm.horizon, tm.horizon + 1.4, t)
        + 0.2 * smooth(tm.open, tm.dolly, t)
        + 0.14 * smooth(tm.dolly, tm.end, t);
    let dx = c.dir_x(0.0);
    super::world::world(
        d,
        c,
        t,
        dawn,
        dx,
        0.0,
        &super::world::glints(71.0, 150, -40.0, 40.0, 2.5, 160.0),
    );
    let lk = inv(tm.impact + 0.02, tm.horizon, t);
    let le = 1.0 - (1.0 - lk).powf(2.2);
    let zf = if ai > 0.02 {
        if t >= tm.horizon {
            3000.0
        } else {
            (4.0 / (1.0 - 0.996 * le)).min(3000.0)
        }
    } else {
        4.0
    };
    let zb = if ai > 0.02 {
        4.0 - (4.0 - 0.2) * expo(clamp(lk * 1.7))
    } else {
        4.0
    };
    let hw = if ao > 0.0 {
        1.15 * (1.0 - 2.0f64.powf(-9.0 * clamp(ao / 0.95)))
    } else {
        0.0
    };
    super::tiles::tear(d, c, t, s, &tm, hw, zb, zf);
    if ai > 0.02 {
        d.a(A::Save);
        d.a(A::Composite { value: "lighter" });
        let amp = 1.0 - 0.35 * smooth(tm.open, tm.open + 1.5, t);
        let start = zb.max(c.pos[2] + 0.25);
        super::tiles::rail(d, c, 0.0, start, zf, 0.03, &|_| 1.0, amp);
        super::tiles::rail(d, c, 0.0, start, zf, 0.012, &|_| 1.0, amp);
        if t < tm.horizon + 0.1 {
            if let Some(p) = c.p([0.0, 0.0, zf.min(2500.0)]) {
                d.glow(
                    p[0],
                    p[1],
                    30.0 + 220.0 / (zf / 4.0).max(1.0),
                    [255.0, 241.0, 214.0],
                    0.9,
                );
                d.glow(p[0], p[1], 90.0, [246.0, 168.0, 158.0], 0.35);
            }
        }
        d.a(A::Restore);
    }
    if ah > 0.0 {
        let len = 1700.0 * expo(clamp(ah / 0.9));
        let i = 0.35 + 0.65 * (-ah * 2.2).exp();
        d.a(A::Save);
        d.a(A::Composite { value: "lighter" });
        d.linear(
            [dx - len, 0.0],
            [dx + len, 0.0],
            &[
                (0.0, [255.0, 210.0, 180.0], 0.0),
                (0.5, [255.0, 244.0, 226.0], i),
                (1.0, [255.0, 210.0, 180.0], 0.0),
            ],
        );
        d.rect([dx - len, c.yh - 1.5, 2.0 * len, 3.0]);
        d.glow(
            dx,
            c.yh,
            160.0 + 200.0 * (-ah * 2.0).exp(),
            [255.0, 226.0, 184.0],
            0.7 * (-ah * 1.6).exp() + 0.12,
        );
        d.a(A::Save);
        d.a(A::Translate { offset: [dx, c.yh] });
        d.a(A::Scale {
            factors: [1.0, 0.035],
        });
        d.radial(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1400.0],
            &[
                (0.0, [255.0, 236.0, 214.0], 0.8 * (-ah * 1.8).exp()),
                (1.0, [255.0, 200.0, 170.0], 0.0),
            ],
        );
        d.rect([-1400.0, -1400.0, 2800.0, 2800.0]);
        d.a(A::Restore);
        d.a(A::Restore);
    }
    if ao > 0.0 {
        super::world::motes(
            d,
            c,
            t,
            tm.open,
            1.15,
            (c.pos[2] + 1.0).max(1.5),
            45.0,
            clamp(ao / 1.2),
        );
    }
    super::impact::impact(d, c, ai);
    if ai < 0.0 {
        let y = timing::drop_y(&tm, t);
        let p = c.p([0.0, y, 4.0]);
        let q = c.p([0.0, -y, 4.0]);
        let r = 25.0;
        if let Some(p) = p {
            d.surface("road-refraction", [128, 128]);
            d.commands.push(Command::Capture {
                surface: "road-refraction",
                source_rect: [p[0] - r * 9.0, p[1] - r * 9.0 * 0.2, r * 18.0, r * 18.0],
                destination_rect: [0.0, 0.0, 128.0, 128.0],
            });
            d.a(A::Save);
            d.a(A::Composite { value: "lighter" });
            d.linear(
                [p[0], p[1] - 260.0],
                [p[0], p[1] - r],
                &[
                    (0.0, [200.0, 230.0, 255.0], 0.0),
                    (1.0, [200.0, 230.0, 255.0], 0.14),
                ],
            );
            d.rect([p[0] - 1.2, p[1] - 260.0, 2.4, 260.0 - r]);
            d.a(A::Restore);
            d.glow(p[0], p[1], r * 4.0, [191.0, 230.0, 255.0], 0.12);
            super::drop::drop(d, p[0], p[1], r, t, true, false);
            d.release("road-refraction");
        }
        if let Some(q) = q {
            if q[1] > c.yh && q[1] < 1160.0 {
                d.a(A::Save);
                d.a(A::Alpha {
                    value: 0.42 * smooth(c.yh, c.yh + 40.0, q[1]),
                });
                super::drop::drop(d, q[0], q[1], r * 0.96, t, false, true);
                d.a(A::Restore);
            }
        }
    }
    d.radial(
        [960.0, 540.0, 270.0],
        [960.0, 540.0, 1134.0],
        &[
            (0.0, [0.0, 0.0, 0.0], 0.0),
            (
                1.0,
                [2.0, 1.0, 6.0],
                0.78 - 0.25 * smooth(tm.open, tm.dolly, t),
            ),
        ],
    );
    d.rect([0.0, 0.0, 1920.0, 1080.0]);
}
