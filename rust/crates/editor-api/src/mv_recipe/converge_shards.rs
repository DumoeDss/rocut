use super::{clock::Clock, draw::*, math::*, model::Palette, plan::*};

pub(super) fn draw(d: &mut Draw, c: &Clock, p: &Palette) {
    for i in 0..34 {
        let n = f64::from(i);
        let [x, y, r, v] = c.kin(n, c.seed + 10.0, 380.0, 1300.0, 0.45, c.t);
        if v >= 1.0 || r < 22.0 {
            continue;
        }
        let size = (22.0 + 58.0 * rnd(n, c.seed + 20.0).powf(1.6)) * clamp(r / 260.0);
        let rot =
            c.t * (0.8 + 2.4 * rnd(n, c.seed + 21.0)) * if i % 2 != 0 { 1.0 } else { -1.0 } + n;
        let face = (rot * 0.7).cos().abs();
        let glint = (rot * 1.7 + n).sin().max(0.0).powf(14.0);
        let sy = 0.25 + 0.75 * face;
        let transform = d.identity();
        let operations = vec![
            Operation::Translate { offset: [x, y] },
            Operation::Rotate { radians: rot },
            Operation::Scale { factors: [1.0, sy] },
        ];
        let tri = [
            [0.0, -size],
            [size * 0.75, size * 0.55],
            [-size * 0.55, size * 0.35 + size * 0.3 * rnd(n, 3.0)],
        ];
        let style = Style::Linear {
            from: [-size, -size],
            to: [size, size],
            stops: stops(&[
                (0.0, rgba(p.glow, 0.28 + 0.5 * glint)),
                (0.45, rgba(p.shard.body, 0.35)),
                (1.0, rgba(p.shard.rim, 0.14 + 0.2 * glint)),
            ]),
        };
        d.commands.push(Command::Path {
            transform,
            operations: operations.clone(),
            path: vec![
                Step::MoveTo { point: tri[0] },
                Step::LineTo { point: tri[1] },
                Step::LineTo { point: tri[2] },
                Step::Close,
            ],
            paints: vec![
                fill(style, "source-over"),
                stroke(
                    solid(rgba(
                        if glint > 0.2 { p.core } else { p.shard.edge },
                        0.4 + 0.6 * glint,
                    )),
                    1.2,
                    "butt",
                    "miter",
                    "source-over",
                ),
            ],
        });
        d.commands.push(Command::Path {
            transform,
            operations,
            path: line(tri[0].map(|v| v * 0.6), tri[1].map(|v| v * 0.6)),
            paints: vec![stroke(
                solid(rgba(p.hi, 0.35 * face)),
                1.2,
                "butt",
                "miter",
                "source-over",
            )],
        });
        if glint > 0.25 {
            let gl = glint * 26.0;
            let mut path = line([x - gl, y], [x + gl, y]);
            path.extend(line([x, y - gl * 0.6], [x, y + gl * 0.6]));
            d.path(
                path,
                vec![stroke(
                    solid(rgba(p.core, glint * 0.9)),
                    1.2,
                    "butt",
                    "miter",
                    "lighter",
                )],
            );
        }
    }
}
