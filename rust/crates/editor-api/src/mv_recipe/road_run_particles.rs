use super::{
    camera::Camera,
    math::*,
    plan::{Action as A, Draw},
};
pub fn air(d: &mut Draw, c: Camera, tf: f64, v: f64, zh: f64, dist: f64) {
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    d.a(A::LineCap { value: "round" });
    for i in 0..90 {
        let i = i as f64;
        let z = zh + 12.0 - fract(rnd(&[i, 501.0]) - dist / 60.0) * 60.0;
        let x = lerp(-2.6, 9.0, rnd(&[i, 502.0]));
        let y = 0.1 + 2.6 * rnd(&[i, 503.0]);
        let (Some(p), Some(q)) = (c.p([x, y, z]), c.p([x, y, z + (v * 0.045).max(0.05)])) else {
            continue;
        };
        let al = (0.25 + 0.5 * rnd(&[i, 504.0]))
            * (3.0 / p[2]).min(1.0)
            * (0.5 + 0.5 * (tf * 3.0 + i).sin());
        d.stroke(
            ramp(0.3 + 0.4 * rnd(&[i, 505.0])),
            al,
            (5.0 / p[2]).max(1.0),
        );
        d.a(A::BeginPath);
        d.a(A::MoveTo {
            point: [q[0], q[1]],
        });
        d.a(A::LineTo {
            point: [p[0], p[1]],
        });
        d.a(A::Stroke);
    }
    d.a(A::Restore);
}
pub fn speed_lines(d: &mut Draw, dist: f64, vk: f64) {
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    let amp = 0.2 + 0.8 * vk;
    for i in 0..44 {
        let i = i as f64;
        let y = rnd(&[i, 601.0]) * 1080.0;
        if y > 250.0 && y < 760.0 && rnd(&[i, 606.0]) < 0.75 {
            continue;
        }
        let len = (160.0 + 620.0 * rnd(&[i, 602.0])) * (0.5 + 0.5 * vk);
        let x = fract(rnd(&[i, 603.0]) + dist * (0.05 + 0.05 * rnd(&[i, 604.0])))
            * (1920.0 + len + 200.0)
            - len
            - 100.0;
        let al = (0.05 + 0.13 * rnd(&[i, 605.0])) * amp;
        d.linear(
            [x, 0.0],
            [x + len, 0.0],
            &[
                (0.0, [255.0, 240.0, 220.0], 0.0),
                (0.8, [255.0, 240.0, 220.0], al),
                (1.0, [255.0, 240.0, 220.0], 0.0),
            ],
        );
        d.rect([x, y, len, 1.0 + 2.0 * rnd(&[i, 607.0])]);
    }
    d.a(A::Restore);
}
