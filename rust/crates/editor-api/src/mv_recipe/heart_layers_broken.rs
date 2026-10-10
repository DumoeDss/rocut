use super::*;
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
            super::super::motion::burn(
                shard,
                c.tau,
                pulse,
                t,
                tq,
                c.break_at,
                session.glass.distance_max,
            )
        } else {
            super::super::motion::shatter(shard, c.tau, pulse)
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
                "char" => super::super::sprites::Variant::Char,
                "base" => super::super::sprites::Variant::Base,
                "flame" => super::super::sprites::Variant::Flame,
                _ => super::super::sprites::Variant::Glow,
            };
            let sprite =
                super::super::sprites::shard(polygon, body_size, variant).map_err(str::to_owned)?;
            let id = d.surface_id("heart-piece");
            d.commands.push(Command::Heart(HeartCommand::OwnedSurface {
                id: id.clone(),
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
                factors: super::super::motion::flip_scale(piece.flip, piece.scale),
            });
            d.operations.push(Operation::Rotate {
                radians: piece.spin - piece.axis,
            });
            d.blit_owned(
                &id,
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
                .push(Command::Heart(HeartCommand::OwnedReleaseSurface {
                    surface: id,
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
    for glitter in
        super::super::glitter::glass_dust(t, c.tau, impact, burn).map_err(str::to_owned)?
    {
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
