use super::{clock::Clock, draw::*, math::*, model::Palette};

pub(super) fn draw(d: &mut Draw, c: &Clock, p: &Palette) {
    for i in 0..140 {
        let n = f64::from(i);
        let fire = i < 44;
        let seed = c.seed + if fire { 30.0 } else { 50.0 };
        let [x, y, r, v] = c.kin(n, seed, 250.0, 1350.0, 0.3, c.t);
        if v >= 1.0 || r < 10.0 {
            continue;
        }
        let [px, py, ..] = c.kin(
            n,
            seed,
            250.0,
            1350.0,
            0.3,
            c.t - if fire { 0.02 } else { 0.035 },
        );
        let col = if fire {
            p.firefly.body
        } else if i % 3 != 0 {
            p.glow
        } else {
            p.sunset
        };
        let blink = if fire {
            0.35 + 0.65 * (c.t * (2.0 + rnd(n, 3.0)) + n).sin().max(0.0).powf(2.0)
        } else {
            0.6 + 0.4 * (c.t * 19.0 + n).sin()
        };
        let alpha = blink * clamp(r / 100.0) * (0.75 + 0.4 * c.u);
        if fire {
            let rr = 10.0 + 8.0 * rnd(n, 4.0);
            d.glow(
                x,
                y,
                rr,
                &[
                    (0.0, rgba(p.firefly.core, alpha)),
                    (0.25, rgba(col, 0.55 * alpha)),
                    (1.0, rgba(p.firefly.edge, 0.0)),
                ],
                "lighter",
            );
            d.path(
                line([px, py], [x, y]),
                vec![stroke(
                    solid(rgba(col, 0.35 * alpha)),
                    3.0,
                    "round",
                    "miter",
                    "lighter",
                )],
            );
        } else {
            d.path(
                line([px, py], [x, y]),
                vec![
                    stroke(
                        solid(rgba(col, 0.3 * alpha)),
                        5.0,
                        "round",
                        "miter",
                        "lighter",
                    ),
                    stroke(
                        solid(rgba(col, 0.9 * alpha)),
                        1.8,
                        "round",
                        "miter",
                        "lighter",
                    ),
                ],
            );
            d.path(
                circle(x, y, 1.6),
                vec![fill(solid(rgba(p.core, alpha)), "lighter")],
            );
        }
    }
}
