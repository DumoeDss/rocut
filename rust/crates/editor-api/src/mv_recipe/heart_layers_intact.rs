use super::*;
pub fn intact(
    d: &mut Draw,
    session: &Session,
    impact: [f64; 2],
    t: f64,
    tq: f64,
    t0: f64,
    c: &Timing,
    pulse: f64,
    burn: bool,
) {
    let bob = 7.0 * (tq * 2.1).sin();
    let wobble = 0.15 * (tq * 1.6).sin();
    let scale = (1.0 + 0.02 * pulse) * (1.0 - 0.055 * c.anticipation);
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate {
        offset: [impact[0], impact[1] + bob],
    });
    d.operations.push(Operation::Scale {
        factors: [scale * wobble.cos(), scale],
    });
    d.operations.push(Operation::Translate {
        offset: [-session.glass.impact[0], -session.glass.impact[1]],
    });
    let size = [
        session.body.display_size[0] as u32,
        session.body.display_size[1] as u32,
    ];
    d.blit(
        if burn { "heart-hot-body" } else { "heart-body" },
        size,
        [0.0, 0.0, size[0] as f64, size[1] as f64],
        1.0,
        "source-over",
    );
    if burn {
        d.blit(
            "heart-body",
            size,
            [0.0, 0.0, size[0] as f64, size[1] as f64],
            0.55,
            "source-over",
        );
    }
    let cracks_id = d.surface_id("heart-cracks");
    d.commands.push(super::super::cracks::build(
        session,
        c.crack,
        c.heat,
        burn,
        cracks_id.clone(),
    ));
    d.blit_owned(
        &cracks_id,
        [size[0] + 40, size[1] + 40],
        [-20.0, -20.0, (size[0] + 40) as f64, (size[1] + 40) as f64],
        1.0,
        "lighter",
    );
    d.commands
        .push(Command::Heart(HeartCommand::OwnedReleaseSurface {
            surface: cracks_id,
        }));
    if burn {
        for (k, [fx, fy]) in session.body.top.iter().enumerate() {
            d.tongues(
                *fx,
                *fy,
                40.0 + 50.0 * c.crack + 20.0 * super::super::seeded::rnd(k as f64, 5.0),
                tq,
                k as f64 * 3.7,
                0.55 + 0.35 * c.crack,
                2,
            );
        }
    }
    d.operations = saved;
    d.glow(
        impact[0],
        impact[1] + bob,
        80.0 + 240.0 * c.heat,
        if burn {
            rgb(255.0, 122.0, 58.0, 1.0)
        } else {
            HI
        },
        0.1 + 0.4 * c.heat * c.heat,
    );
    d.glow(
        impact[0],
        impact[1] + bob,
        28.0 + 50.0 * c.anticipation,
        HOT,
        0.2 * c.heat + 0.6 * c.anticipation,
    );
    if c.anticipation > 0.02 {
        d.sparkle(
            impact[0],
            impact[1] + bob,
            60.0 + 300.0 * c.anticipation,
            0.8 * c.anticipation,
            0.2,
            true,
        );
    }
    for (tt, n) in [(t0 + 0.02, 10), (c.next_beat, 16)] {
        let dt = t - tt;
        if !(0.0..=0.6).contains(&dt) {
            continue;
        }
        for i in 0..n {
            let i = i as f64;
            let angle = super::super::seeded::rnd(i, tt * 100.0) * std::f64::consts::TAU;
            let speed = 180.0
                + 420.0 * super::super::seeded::hash(&[i, 7.0, tt * 100.0]) as f64
                    / 4_294_967_296.0;
            let radius = 60.0 + speed * burst(dt, 0.18);
            d.sparkle_color(
                impact[0] + angle.cos() * radius,
                impact[1] + angle.sin() * radius + 90.0 * dt * dt,
                12.0 * (1.0 - dt / 0.6),
                1.0 - dt / 0.6,
                if burn {
                    rgb(255.0, 176.0, 96.0, 1.0)
                } else {
                    HOT
                },
                angle,
                false,
            );
        }
    }
}
