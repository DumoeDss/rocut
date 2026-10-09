use super::{clock::Clock, draw::*, math::*, model::Palette};

pub(super) fn draw(d: &mut Draw, c: &Clock, p: &Palette) {
    for j in 0..9 {
        let j = f64::from(j);
        let angle = j / 9.0 * TAU + rnds(j, c.seed) * 0.3;
        let len = 1000.0 + 800.0 * rnd(j, c.seed + 1.0);
        let k = clamp(c.u * (1.02 + 0.2 * rnd(j, c.seed + 3.0)));
        let tip = lerp(420.0 + 520.0 * rnd(j, c.seed + 2.0), 0.0, k * k);
        let points: Vec<_> = (0..=72)
            .map(|q| {
                let s = f64::from(q) / 72.0;
                let r = tip + s * len;
                let th = c.spiral(angle, r) + 0.04 * (s * 11.0 - c.t * 5.0 + j).sin() * s;
                ([960.0 + th.cos() * r, 540.0 + th.sin() * r * 0.9], s)
            })
            .collect();
        // Preserve j-major / pass-major / segment-major paint ordering.
        for (width, alpha, col, comp) in [
            (20.0, 0.08, p.verm, "lighter"),
            (5.5, 0.95, p.verm, "source-over"),
            (2.0, 0.55, p.sunset, "lighter"),
            (0.8, 0.45, p.hi, "lighter"),
        ] {
            for q in 1..points.len() {
                let s = points[q].1;
                let fa = (1.0 - s).powf(1.1) * clamp(s * 14.0);
                if fa < 0.02 {
                    continue;
                }
                d.path(
                    line(points[q - 1].0, points[q].0),
                    vec![stroke(
                        solid(rgba(col, alpha * fa)),
                        width * (1.0 - 0.55 * s),
                        "round",
                        "round",
                        comp,
                    )],
                );
            }
        }
    }
}
