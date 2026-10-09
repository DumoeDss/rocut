use super::{draw::*, math::*, model::Palette, plan::Operation};

pub(super) fn ember(
    d: &mut Draw,
    x: f64,
    y: f64,
    intensity: f64,
    t: f64,
    streak: f64,
    p: &Palette,
) {
    let k =
        (intensity * (1.0 + 0.07 * noise(t * 17.0, 3.0) + 0.05 * noise(t * 43.0, 5.0))).max(0.0);
    if k <= 0.002 {
        return;
    }
    let r1 = 40.0 + 300.0 * k;
    d.glow(
        x,
        y,
        r1,
        &[
            (0.0, rgba(p.sunset, 0.42 * k)),
            (0.1, rgba(p.verm, 0.26 * k.min(1.2))),
            (0.38, rgba(p.dusk, 0.08 * k.min(1.2))),
            (1.0, rgba(p.dusk, 0.0)),
        ],
        "lighter",
    );
    let r2 = 7.0 + 30.0 * k;
    d.glow(
        x,
        y,
        r2,
        &[
            (0.0, rgba(p.hi, 0.85 * k + 0.15)),
            (0.3, rgba(p.glow, 0.6 * k.min(1.0))),
            (1.0, rgba(p.sunset, 0.0)),
        ],
        "lighter",
    );
    if streak > 1.0 {
        let depth = d.operations.len();
        for (h, a) in [(2.2, 0.55), (9.0, 0.12)] {
            d.operations.push(Operation::Translate { offset: [x, y] });
            d.operations.push(Operation::Scale {
                factors: [streak / h, 1.0],
            });
            d.rect(
                [-h, -h, 2.0 * h, 2.0 * h],
                fill(
                    radial(
                        0.0,
                        0.0,
                        h,
                        &[
                            (0.0, rgba(p.hi, a * k.min(1.0))),
                            (0.35, rgba(p.glow, a * 0.4 * k.min(1.0))),
                            (1.0, rgba(p.sunset, 0.0)),
                        ],
                    ),
                    "lighter",
                ),
            );
            d.operations.truncate(depth);
        }
    }
    d.path(
        circle(x, y, 1.1 + 2.4 * k.min(1.5)),
        vec![fill(solid(rgba(p.core, 0.6 + k)), "lighter")],
    );
}

pub(super) fn fire_ring(
    d: &mut Draw,
    x: f64,
    y: f64,
    r: f64,
    intensity: f64,
    t: f64,
    p: &Palette,
    width: f64,
    wobble: f64,
) {
    if r < 0.5 || intensity <= 0.01 {
        return;
    }
    let w = width * (22.0 + 55.0 * intensity.min(1.5));
    let r0 = (r - w).max(0.0);
    let r1 = r + w * 1.7;
    let kr = (r - r0) / (r1 - r0);
    let style = super::plan::Style::Radial {
        from: [x, y, r0],
        to: [x, y, r1],
        stops: stops(&[
            (0.0, rgba(p.verm, 0.0)),
            (kr * 0.6, rgba(p.verm, 0.1 * intensity)),
            (kr, rgba(p.sunset, (0.5 * intensity).min(0.9))),
            (kr + (1.0 - kr) * 0.3, rgba(p.verm, 0.16 * intensity)),
            (1.0, rgba(p.dusk, 0.0)),
        ]),
    };
    d.path(circle(x, y, r1), vec![fill(style, "lighter")]);
    let count = super::ease::jsround(r * 0.9).clamp(48.0, 220.0) as usize;
    let wob = wobble * (0.8 + 1.6 * intensity);
    let mut path = Vec::new();
    for i in 0..=count {
        let th = i as f64 / count as f64 * TAU;
        let rr = r + wob
            * (1.6 * (3.0 * th + t * 2.1).sin()
                + 1.1 * (7.0 * th - t * 3.7 + 1.3).sin()
                + 0.7 * (13.0 * th + t * 6.1 + 0.4).sin());
        let point = [x + th.cos() * rr, y + th.sin() * rr];
        path.push(if i == 0 {
            super::plan::Step::MoveTo { point }
        } else {
            super::plan::Step::LineTo { point }
        });
    }
    path.push(super::plan::Step::Close);
    d.path(
        path,
        vec![
            stroke(solid(rgba(p.glow, 0.55 * intensity)), 7.0, "butt", "miter"),
            stroke(solid(rgba(p.hi, 0.95 * intensity)), 2.2, "butt", "miter"),
        ],
    );
    for j in 0..3 {
        let jf = j as f64;
        let c = t * (0.8 + jf * 0.41) * if j % 2 == 1 { -1.0 } else { 1.0 } + jf * 2.1;
        d.path(
            vec![arc(x, y, r, c, c + 0.28 + 0.1 * jf, false)],
            vec![stroke(
                solid(rgba(p.core, 0.55 * intensity)),
                3.2,
                "round",
                "miter",
            )],
        );
    }
}
