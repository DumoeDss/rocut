use super::{
    draw::*,
    plan::{native, Command, HeartCommand, Operation},
    timing::Timing,
    Session,
};
pub fn measuring_ring(d: &mut Draw, impact: [f64; 2], tq: f64, c: &Timing, burn: bool) {
    let k = if c.broken {
        out_cubic(inv(0.0, 0.8, c.tau))
    } else {
        0.0
    };
    let radius = 372.0 + 900.0 * k;
    let a = if c.broken { 0.3 * (1.0 - k) } else { 0.22 } * if burn { 0.8 } else { 1.0 };
    if a <= 0.005 {
        return;
    }
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate { offset: impact });
    d.operations.push(Operation::Rotate { radians: tq * 0.12 });
    let col = alpha(
        if burn {
            rgb(255.0, 138.0, 90.0, 1.0)
        } else {
            rgb(233.0, 184.0, 230.0, 1.0)
        },
        a,
    );
    d.path(
        vec![arc([0.0, 0.0], radius, 0.08, std::f64::consts::TAU - 0.08)],
        vec![stroke(col, 1.4, "lighter", "butt", "miter")],
    );
    for offset in [0.0, 1.0] {
        d.path(
            vec![arc(
                [0.0, 0.0],
                radius + 14.0,
                std::f64::consts::PI * (offset + 0.1),
                std::f64::consts::PI * (offset + 0.62),
            )],
            vec![stroke(col, 1.4, "lighter", "butt", "miter")],
        );
    }
    let mut path = Vec::with_capacity(144);
    for i in 0..72 {
        let a = i as f64 / 72.0 * std::f64::consts::TAU;
        let len = if i % 6 == 0 { 14.0 } else { 6.0 };
        path.push(mv([a.cos() * (radius - 4.0), a.sin() * (radius - 4.0)]));
        path.push(ln([
            a.cos() * (radius - 4.0 - len),
            a.sin() * (radius - 4.0 - len),
        ]));
    }
    d.path(path, vec![stroke(col, 1.4, "lighter", "butt", "miter")]);
    d.operations = saved;
}
pub fn chips(
    d: &mut Draw,
    session: &Session,
    offset: [f64; 2],
    impact: [f64; 2],
    tq: f64,
    c: &Timing,
) {
    for (k, (chip, image)) in session
        .body
        .chips
        .iter()
        .zip(&session.chip_images)
        .enumerate()
    {
        let phase = k as f64 * 1.9;
        let mut x = offset[0] + chip.center[0] + 6.0 * (tq * 1.3 + phase).sin();
        let mut y = offset[1] + chip.center[1] + 7.0 * (tq * 1.1 + phase).cos();
        let mut rotation = 0.2 * (tq * 0.9 + phase).sin();
        if c.broken {
            let dx = x - impact[0];
            let dy = y - impact[1];
            let dd = dx.hypot(dy);
            let dd = if dd == 0.0 { 1.0 } else { dd };
            let r = 160.0 * burst(c.tau, 0.1) + 90.0 * c.tau;
            x += dx / dd * r;
            y += dy / dd * r + 20.0 * c.tau * c.tau;
            rotation += 2.0 * burst(c.tau, 0.2) * if k % 2 != 0 { 1.0 } else { -1.0 };
        }
        let size = [chip.display_size[0] as u32, chip.display_size[1] as u32];
        d.commands.push(Command::Heart(HeartCommand::Surface {
            id: "heart-chip",
            size,
            commands: vec![Command::Heart(HeartCommand::PreparedImage {
                image: image.clone(),
                source_rect: None,
                destination_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
                transform: ID,
                operations: Vec::new(),
                clip: None,
                composite: "source-over",
                opacity: 1.0,
                smoothing: true,
                smoothing_quality: "low",
            })],
        }));
        let saved = d.operations.clone();
        d.operations.push(Operation::Translate { offset: [x, y] });
        d.operations.push(Operation::Rotate { radians: rotation });
        d.blit(
            "heart-chip",
            size,
            [
                -(size[0] as f64) / 2.0,
                -(size[1] as f64) / 2.0,
                size[0] as f64,
                size[1] as f64,
            ],
            1.0,
            "source-over",
        );
        d.operations = saved;
        d.commands
            .push(Command::Native(native::Command::ReleaseSurface {
                surface: "heart-chip",
            }));
    }
}
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
    d.commands
        .push(super::cracks::build(session, c.crack, c.heat, burn));
    d.blit(
        "heart-cracks",
        [size[0] + 40, size[1] + 40],
        [-20.0, -20.0, (size[0] + 40) as f64, (size[1] + 40) as f64],
        1.0,
        "lighter",
    );
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-cracks",
        }));
    if burn {
        for (k, [fx, fy]) in session.body.top.iter().enumerate() {
            d.tongues(
                *fx,
                *fy,
                40.0 + 50.0 * c.crack + 20.0 * super::seeded::rnd(k as f64, 5.0),
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
            let angle = super::seeded::rnd(i, tt * 100.0) * std::f64::consts::TAU;
            let speed =
                180.0 + 420.0 * super::seeded::hash(&[i, 7.0, tt * 100.0]) as f64 / 4_294_967_296.0;
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
pub fn broken(
    d: &mut Draw,
    session: &Session,
    offset: [f64; 2],
    impact: [f64; 2],
    t: f64,
    c: &Timing,
    pulse: f64,
    tq: f64,
    burn: bool,
) -> Result<(), String> {
    d.rays_color(
        impact[0],
        impact[1],
        0.34 * decay(c.tau, 2.2) + 0.06 + 0.05 * pulse,
        t,
        if burn {
            rgb(255.0, 122.0, 58.0, 1.0)
        } else {
            GLOW
        },
    );
    d.glow(
        impact[0],
        impact[1],
        240.0 + 1100.0 * burst(c.tau, 0.16),
        HOT,
        0.95 * decay(c.tau, 4.5),
    );
    let k = inv(0.0, 0.75, c.tau);
    d.ring(
        impact[0],
        impact[1],
        50.0 + 1250.0 * out_cubic(k),
        16.0 * (1.0 - k) + 1.0,
        if burn {
            rgb(255.0, 176.0, 112.0, 1.0)
        } else {
            HI
        },
        0.75 * (1.0 - k).powf(1.5),
    );
    let k = inv(0.05, 0.9, c.tau);
    d.ring(
        impact[0],
        impact[1],
        30.0 + 700.0 * out_cubic(k),
        3.0,
        HOT,
        0.5 * (1.0 - k),
    );
    let body_size = [
        session.body.display_size[0] as u32,
        session.body.display_size[1] as u32,
    ];
    for shard in &session.glass.shards {
        let pose = if burn {
            super::motion::burn(
                shard,
                c.tau,
                pulse,
                t,
                tq,
                c.break_at,
                session.glass.distance_max,
            )
        } else {
            super::motion::shatter(shard, c.tau, pulse)
        }
        .map_err(str::to_owned)?;
        let polygon = &session.glass.fracture.cells[shard.cell].polygon;
        let piece_count = pose.pieces.len();
        for (index, piece) in pose.pieces.into_iter().enumerate() {
            // Original tongues are between flame and the final additive glow.
            if index + 1 == piece_count {
                if let Some(fire) = &pose.fire {
                    d.tongues(
                        offset[0] + fire.position[0],
                        offset[1] + fire.position[1],
                        fire.size,
                        tq,
                        fire.seed,
                        fire.alpha,
                        fire.count,
                    );
                }
            }
            if piece.alpha <= 0.004 {
                continue;
            }
            let variant = match piece.variant {
                "char" => super::sprites::Variant::Char,
                "base" => super::sprites::Variant::Base,
                "flame" => super::sprites::Variant::Flame,
                _ => super::sprites::Variant::Glow,
            };
            let sprite =
                super::sprites::shard(polygon, body_size, variant).map_err(str::to_owned)?;
            d.commands.push(Command::Heart(HeartCommand::Surface {
                id: "heart-piece",
                size: sprite.size,
                commands: sprite.commands,
            }));
            let saved = d.operations.clone();
            d.operations.push(Operation::Translate {
                offset: [offset[0] + piece.position[0], offset[1] + piece.position[1]],
            });
            d.operations.push(Operation::Rotate {
                radians: piece.axis,
            });
            d.operations.push(Operation::Scale {
                factors: super::motion::flip_scale(piece.flip, piece.scale),
            });
            d.operations.push(Operation::Rotate {
                radians: piece.spin - piece.axis,
            });
            d.blit(
                "heart-piece",
                sprite.size,
                [
                    sprite.origin[0] - shard.pivot[0],
                    sprite.origin[1] - shard.pivot[1],
                    sprite.size[0] as f64,
                    sprite.size[1] as f64,
                ],
                piece.alpha.min(1.0),
                piece.composite,
            );
            d.operations = saved;
            d.commands
                .push(Command::Native(native::Command::ReleaseSurface {
                    surface: "heart-piece",
                }));
        }
        if let Some((pos, radius)) = pose.sparkle {
            d.sparkle(
                offset[0] + pos[0],
                offset[1] + pos[1],
                radius,
                pose.glint,
                0.3,
                true,
            );
        }
        for ember in pose.embers {
            let color = if ember.color == "#FFD08A" {
                rgb(255.0, 208.0, 138.0, 1.0)
            } else {
                rgb(255.0, 106.0, 42.0, 1.0)
            };
            d.glow(
                offset[0] + ember.position[0],
                offset[1] + ember.position[1],
                ember.radius,
                color,
                ember.alpha,
            );
        }
    }
    for glitter in super::glitter::glass_dust(t, c.tau, impact, burn).map_err(str::to_owned)? {
        let color = if glitter.color == "#FFFFFF" {
            rgb(255.0, 255.0, 255.0, glitter.alpha)
        } else if glitter.color == "#FFB060" {
            rgb(255.0, 176.0, 96.0, glitter.alpha)
        } else if glitter.color == "#FF6A2A" {
            rgb(255.0, 106.0, 42.0, glitter.alpha)
        } else {
            alpha(HI, glitter.alpha)
        };
        d.rect(glitter.rect, fill(solid(color), "lighter"));
        if let Some(radius) = glitter.sparkle_radius {
            d.sparkle(
                glitter.rect[0] + glitter.rect[2] / 2.0,
                glitter.rect[1] + glitter.rect[3] / 2.0,
                radius,
                glitter.alpha,
                0.0,
                false,
            );
        }
    }
    let orb = 1.0 - 0.35 * decay(c.tau, 3.0);
    d.glow(
        impact[0],
        impact[1],
        (110.0 + 50.0 * pulse) * orb,
        if burn {
            rgb(255.0, 138.0, 58.0, 1.0)
        } else {
            HI
        },
        0.7,
    );
    d.glow(impact[0], impact[1], 34.0 + 12.0 * pulse, HOT, 0.9);
    d.sparkle(
        impact[0],
        impact[1],
        70.0 + 60.0 * pulse + 200.0 * decay(c.tau, 3.0),
        0.7 + 0.3 * pulse,
        0.785 * (c.tau * 2.0).min(1.0),
        true,
    );
    Ok(())
}
