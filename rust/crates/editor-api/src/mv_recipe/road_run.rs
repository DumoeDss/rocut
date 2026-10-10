use super::{
    camera::Camera,
    math::*,
    model::{Args, FreezeStyle, Sample},
    plan::{Action as A, Draw},
    runner::Runner,
    timing,
};
pub fn draw(d: &mut Draw, a: &Args, s: &Sample<'_>, id: &str, size: [u32; 2]) {
    let t = s.song_ticks as f64 / 120000.0;
    let tm = timing::run(a, s);
    let tf = t.min(tm.freeze);
    let dist = timing::distance(t, &tm);
    let v = timing::speed(t, &tm);
    let vk = v / 8.5;
    let zh = 20.0 + dist;
    let yaw = std::f64::consts::FRAC_PI_2 + 0.3;
    let f = [yaw.sin(), 0.0, yaw.cos()];
    let r = [yaw.cos(), 0.0, -yaw.sin()];
    let target = [0.05, 0.92, zh - 0.25];
    let shake = [
        rnds(&[(tf * 24.0).floor(), 7.0]),
        rnds(&[(tf * 24.0).floor(), 14.0]),
    ];
    let shk = 0.012 * vk * if t < tm.freeze { 1.0 } else { 0.0 };
    let pos = [
        target[0] - f[0] * 2.75 + r[0] * -0.62,
        1.02 + shake[1] * shk * 0.5,
        target[2] - f[2] * 2.75 + r[2] * -0.62,
    ];
    let pitch = 0.035 + shake[0] * shk * 0.02 + 0.004 * fbm(tf * 0.8, 2.0);
    let c = Camera::new(pos, yaw + 0.004 * fbm(tf * 0.6, 4.0), pitch, 1060.0);
    let af = t - tm.freeze;
    let punch = if af > 0.0 {
        1.0 + 0.035 * expo(clamp(af / 0.12))
    } else {
        1.0
    };
    d.a(A::Save);
    d.a(A::Translate {
        offset: [960.0, 540.0],
    });
    d.a(A::Rotate { radians: -0.045 });
    d.a(A::Scale {
        factors: [punch, punch],
    });
    d.a(A::Translate {
        offset: [-960.0, -540.0],
    });
    super::world::world(
        d,
        c,
        tf,
        0.85,
        -260.0,
        -dist * 2.0,
        &super::world::run_glints(zh),
    );
    super::tiles::run(d, c, tf, v, zh, s);
    super::run_particles::air(d, c, tf, v, zh, dist);
    let tq = quant(tf);
    let dq = timing::distance(tq, &tm);
    let phase = dq / 1.9;
    if let (Some(foot), Some(head)) = (c.p([0.0, 0.0, zh]), c.p([0.0, 1.62, zh])) {
        let h = (foot[1] - head[1]) * 1.02;
        let bob = -(std::f64::consts::PI * phase).sin().abs() * 16.0 * (0.4 + 0.6 * vk);
        let rock = 0.028 * (TAU * phase * 0.5).sin() * (0.4 + 0.6 * vk);
        let sq = 1.0 - 0.018 * (std::f64::consts::PI * phase).cos().powi(8);
        let o = Runner {
            x: foot[0],
            y: foot[1] + bob,
            h,
            rot: rock - 0.05,
            sy: sq,
            amp: 15.0 * (0.35 + 0.65 * vk),
            ft: tq,
        };
        super::runner::lit(d, id, size, &o, foot[1]);
        d.glow(
            o.x + 8.0,
            foot[1] + 2.0,
            70.0,
            [255.0, 241.0, 214.0],
            0.28 * (1.0 - (-bob / 16.0).min(1.0) * 0.6),
        );
    }
    super::run_particles::speed_lines(d, dist, vk);
    d.a(A::Restore);
    if af >= 0.0 {
        d.a(A::Save);
        d.a(A::Composite {
            value: "saturation",
        });
        d.a(A::Alpha {
            value: 0.42 * clamp(af / 0.08),
        });
        d.fill([128.0, 128.0, 128.0], 1.0);
        d.rect([0.0, 0.0, 1920.0, 1080.0]);
        d.a(A::Composite { value: "lighter" });
        d.a(A::Alpha {
            value: 0.6 * (-af * 26.0).exp(),
        });
        d.fill([255.0, 244.0, 230.0], 1.0);
        d.rect([0.0, 0.0, 1920.0, 1080.0]);
        d.a(A::Restore);
        if a.freeze_style.as_ref().unwrap_or(&FreezeStyle::Photo) == &FreezeStyle::Photo {
            let m = lerp(0.0, 26.0, expo(clamp(af / 0.2)));
            d.a(A::Save);
            d.fill([239.0, 230.0, 214.0], 0.9);
            for rect in [
                [0.0, 0.0, 1920.0, m],
                [0.0, 1080.0 - m, 1920.0, m],
                [0.0, 0.0, m, 1080.0],
                [1920.0 - m, 0.0, m, 1080.0],
            ] {
                d.rect(rect);
            }
            d.a(A::Restore);
        }
    }
    d.radial(
        [960.0, 540.0, 324.0],
        [960.0, 540.0, 1134.0],
        &[(0.0, [0.0, 0.0, 0.0], 0.0), (1.0, [3.0, 2.0, 8.0], 0.6)],
    );
    d.rect([0.0, 0.0, 1920.0, 1080.0]);
}
