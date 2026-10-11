use super::{
    Session,
    draw::*,
    plan::{Command, MemoryCommand, Operation, Plan},
};
pub fn print(s: &Session, slot: usize) -> Result<Plan, String> {
    let p = s.photos.get(slot).ok_or("Memories photo slot missing")?;
    let graded = p
        .graded
        .as_ref()
        .ok_or("Memories graded composite is not admitted")?;
    let mut g = Draw::new();
    g.prepared(graded, [0.0, 0.0, 1040.0, 650.0], 1.0, "source-over", "low");
    let mut r = super::math::Rng::new(p.seed + 11.0);
    for _ in 0..3 {
        let x = r.range(0.1, 0.9) * 1040.0;
        let y = r.range(0.1, 0.9) * 650.0;
        let radius = r.range(40.0, 140.0);
        g.rect(
            [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
            fill(
                radial(
                    [x, y, 0.0],
                    [x, y, radius],
                    &[
                        (0.0, color(183.0, 156.0, 139.0, 0.0)),
                        (0.8, color(160.0, 120.0, 95.0, 0.1)),
                        (1.0, color(183.0, 156.0, 139.0, 0.0)),
                    ],
                ),
                "multiply",
            ),
        );
    }
    for _ in 0..7 {
        let a = r.range(0.06, 0.2);
        let width = r.range(0.8, 1.8);
        let x = r.range(0.0, 1040.0);
        let y = r.range(0.0, 650.0);
        let len = r.range(40.0, 260.0);
        let angle = r.range(-0.4, 0.4)
            + if r.next() < 0.5 {
                std::f64::consts::FRAC_PI_2
            } else {
                0.0
            };
        let control = [
            x + angle.cos() * len * 0.5 + r.range(-20.0, 20.0),
            y + angle.sin() * len * 0.5 + r.range(-20.0, 20.0),
        ];
        g.path(
            vec![
                mv([x, y]),
                quad(control, [x + angle.cos() * len, y + angle.sin() * len]),
            ],
            vec![stroke(
                color(239.0, 230.0, 214.0, a),
                width,
                "screen",
                "round",
            )],
        );
    }
    for _ in 0..40 {
        let c = if r.next() < 0.6 {
            color(239.0, 230.0, 214.0, 0.35)
        } else {
            color(36.0, 28.0, 26.0, 0.35)
        };
        let xy = [r.range(0.0, 1040.0), r.range(0.0, 650.0)];
        let radius = r.range(0.6, 2.2);
        g.path(vec![arc(xy, radius)], vec![fill(solid(c), "source-over")]);
    }
    let mut d = Draw::new();
    d.surface("memories-grade", [1040, 650], g.commands);
    d.operations.push(Operation::Scale {
        factors: [2.0, 2.0],
    });
    d.commands.push(Command::Memories(MemoryCommand::RoundRect {
        transform: ID,
        operations: d.operations.clone(),
        rect: [0.0, 0.0, 560.0, 431.0],
        radius: 3.5,
        paint: fill(
            linear(
                [0.0, 0.0],
                [560.0, 431.0],
                &[
                    (0.0, color(241.0, 233.0, 218.0, 1.0)),
                    (0.55, color(236.0, 226.0, 207.0, 1.0)),
                    (1.0, color(226.0, 213.0, 189.0, 1.0)),
                ],
            ),
            "source-over",
        ),
    }));
    let mut r = super::math::Rng::new(p.seed + 29.0);
    for _ in 0..5 {
        let x = r.range(0.0, 560.0);
        let y = r.range(0.0, 431.0);
        let radius = r.range(30.0, 120.0);
        d.rect(
            [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
            fill(
                radial(
                    [x, y, 0.0],
                    [x, y, radius],
                    &[
                        (0.0, color(200.0, 170.0, 130.0, 0.1)),
                        (1.0, color(200.0, 170.0, 130.0, 0.0)),
                    ],
                ),
                "source-over",
            ),
        );
    }
    d.rect(
        [0.0, 0.0, 560.0, 431.0],
        fill(
            radial(
                [280.0, 215.5, 431.0 * 0.35],
                [280.0, 215.5, 560.0 * 0.72],
                &[
                    (0.0, color(120.0, 90.0, 60.0, 0.0)),
                    (1.0, color(120.0, 90.0, 60.0, 0.16)),
                ],
            ),
            "source-over",
        ),
    );
    d.blit(
        "memories-grade",
        [1040, 650],
        [20.0, 20.0, 520.0, 325.0],
        1.0,
        "source-over",
        Some(0.55),
        "low",
    );
    d.path(
        vec![super::plan::Step::Native(
            super::plan::common::native::Step::Rect {
                rect: [20.5, 20.5, 519.0, 324.0],
            },
        )],
        vec![stroke(
            color(60.0, 45.0, 38.0, 0.35),
            1.0,
            "source-over",
            "butt",
        )],
    );
    d.rect(
        [20.0, 20.0, 520.0, 325.0],
        fill(
            linear(
                [20.0, 20.0],
                [436.0, 345.0],
                &[
                    (0.0, color(255.0, 250.0, 240.0, 0.1)),
                    (0.45, color(255.0, 250.0, 240.0, 0.0)),
                    (1.0, color(255.0, 250.0, 240.0, 0.04)),
                ],
            ),
            "source-over",
        ),
    );
    d.operations.clear();
    d.release("memories-grade");
    Ok(Plan {
        commands: d.commands,
        raster_budget_bytes: 0,
    })
}
