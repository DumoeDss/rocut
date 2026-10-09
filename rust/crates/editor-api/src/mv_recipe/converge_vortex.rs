use super::{clock::Clock, draw::*, math::*, model::Palette, plan::*};

pub(super) fn background(d: &mut Draw, c: &Clock, p: &Palette) {
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(
            Style::Linear {
                from: [0.0, 0.0],
                to: [0.0, 1080.0],
                stops: stops(&[
                    (0.0, p.background[0]),
                    (0.5, p.background[1]),
                    (1.0, p.background[2]),
                ]),
            },
            "source-over",
        ),
    );
    for (r, col, amount) in [
        (1000.0, p.shadow, 0.35 + 0.3 * c.u),
        (420.0, p.verm, 0.08 + 0.25 * c.u * c.u),
    ] {
        d.glow(
            960.0,
            540.0,
            r,
            &[(0.0, rgba(col, amount)), (1.0, rgba(col, 0.0))],
            "source-over",
        );
    }
    for j in 0..6 {
        let angle = f64::from(j) / 6.0 * TAU + 0.4;
        let path = (0..=70)
            .map(|q| {
                let r = 1500.0 * (1.0 - f64::from(q) / 70.0).powf(1.4) + 20.0;
                let th = c.spiral(angle, r);
                let point = [960.0 + th.cos() * r, 540.0 + th.sin() * r * 0.9];
                if q == 0 {
                    Step::MoveTo { point }
                } else {
                    Step::LineTo { point }
                }
            })
            .collect();
        d.path(
            path,
            vec![
                stroke(
                    solid(rgba(p.shadow, 0.05 + 0.04 * c.u)),
                    90.0,
                    "round",
                    "miter",
                    "lighter",
                ),
                stroke(
                    solid(rgba(p.dusk, 0.035)),
                    22.0,
                    "round",
                    "miter",
                    "lighter",
                ),
            ],
        );
    }
}
pub(super) fn rings_and_streaks(d: &mut Draw, c: &Clock, p: &Palette) {
    for b in &c.beats {
        let dt = c.t - b;
        if !(0.0..=0.46).contains(&dt) {
            continue;
        }
        let e = cube(dt / 0.46);
        let r = 30.0 + 1150.0 * (1.0 - e);
        d.path(
            vec![Step::Ellipse {
                center: [960.0, 540.0],
                radii: [r, r * 0.9],
                rotation: 0.0,
                start: 0.0,
                end: TAU,
            }],
            vec![stroke(
                solid(rgba(p.hi, 0.5 * clamp(dt / 0.05) * (1.0 - e * 0.6))),
                1.5 + 4.0 * e,
                "butt",
                "miter",
                "lighter",
            )],
        );
    }
    let k = clamp((c.u - 0.35) / (1.0 - 0.35));
    let amount = k * k * 0.8;
    if amount <= 0.01 {
        return;
    }
    let swirl = c.swirl(c.t);
    for i in 0..90 {
        let n = f64::from(i);
        let th = rnd(n, 13.0) * TAU + swirl * 0.35 + c.t * 0.15;
        let rate = (0.9 + 1.6 * rnd(n, 14.0)) * (0.7 + c.u);
        let f = c.t * rate + rnd(n, 15.0);
        let f = f - f.floor();
        let max = 1250.0 + 250.0 * rnd(n, 16.0);
        let head = lerp(max, 36.0, cube(f));
        let tail = head + (30.0 + 260.0 * f) * (0.5 + rnd(n, 17.0));
        let alpha = amount * (std::f64::consts::PI * f).sin() * (0.25 + 0.6 * rnd(n, 18.0));
        let dth = 0.05 + 0.1 * swirl / 2.6;
        d.path(
            line(
                [960.0 + th.cos() * head, 540.0 + th.sin() * head],
                [
                    960.0 + (th - dth).cos() * tail,
                    540.0 + (th - dth).sin() * tail,
                ],
            ),
            vec![stroke(
                solid(rgba(if i % 3 != 0 { p.glow } else { p.hi }, alpha)),
                0.8 + 1.8 * rnd(n, 19.0),
                "round",
                "miter",
                "lighter",
            )],
        );
    }
}
