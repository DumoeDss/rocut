//! Complete original drawGather ordered plan, using retained Rust Heart preparation.
use super::{
    BackgroundFact, Plan, Sample, Session,
    draw::*,
    figure::{self, Figure, Image, Light, Rim, Wave},
    plan::{Command, Operation, native},
    rebirth_contract::{self, Gather},
    rebirth_draw::*,
};
pub fn frame(
    session: &Session,
    a: &Gather,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Plan, String> {
    let c = rebirth_contract::inspect(session, &a.heart, &a.char, a.bg.as_deref(), s, character)?;
    let ff = a
        .firefly
        .unwrap_or_else(|| a.bg.as_ref().is_some_and(|bg| bg.contains("firefl")));
    let h = a
        .char_h
        .unwrap_or(if a.bg.is_some() { 900.0 } else { 1000.0 });
    let cx = a.char_x.unwrap_or(960.0);
    let cy = a
        .char_y
        .unwrap_or(if a.bg.is_some() { 1090.0 } else { 1062.0 });
    rebirth_contract::geometry(&[h, cx, cy])?;
    if h <= 0.0 {
        return Err("Heart character height must be positive".into());
    }
    let pose = figure::pose(&a.char, character.width, character.height);
    let sc = h / character.height as f64;
    let screen = |p: [f64; 2]| {
        [
            cx + (p[0] - character.width as f64 / 2.0) * sc,
            cy - (character.height as f64 - p[1]) * sc,
        ]
    };
    let chest = a.target.unwrap_or_else(|| screen(pose.chest));
    let hand = screen(pose.hand);
    rebirth_contract::geometry(&chest)?;
    let candidates: Vec<_> = session
        .glass
        .shards
        .iter()
        .enumerate()
        .map(|(index, s)| super::gather_motion::Candidate {
            index,
            coverage: s.coverage,
        })
        .collect();
    let arrivals = super::gather_motion::plan(
        &candidates,
        a.n.unwrap_or(24) as usize,
        &c.beats,
        c.spb,
        c.t0,
        c.end,
    )
    .map_err(str::to_owned)?;
    let landed = arrivals
        .iter()
        .map(|q| smooth(q.at, q.at + 0.25, c.t))
        .sum::<f64>()
        / arrivals.len() as f64;
    let land_pulse = arrivals
        .iter()
        .map(|q| {
            if c.t >= q.at {
                decay(c.t - q.at, 6.0) * if q.k < 5 { 1.0 } else { 0.5 }
            } else {
                0.0
            }
        })
        .fold(0.0, f64::max);
    let mut d = Draw::new();
    if let Some(bg) = s.background.as_ref() {
        let scale = (1920.0 / bg.width as f64).max(1080.0 / bg.height as f64)
            * (1.06 + 0.03 * in_out_sine(c.progress));
        let w = bg.width as f64 * scale;
        let hh = bg.height as f64 * scale;
        // D.cover y=.15 pans positively within half the spare vertical margin.
        d.commands.push(Command::Native(native::Command::Image {
            image: bg.resource.id.clone(),
            source_rect: None,
            destination_rect: [-w / 2.0, -hh / 2.0, w, hh],
            transform: ID,
            operations: vec![Operation::Translate {
                offset: [960.0, 540.0 + ((hh - 1080.0) / 2.0).max(0.0) * 0.15],
            }],
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "high",
        }));
        let mut p = fill(
            solid(if ff {
                rgb(27.0, 36.0, 72.0, 1.0)
            } else {
                rgb(42.0, 18.0, 56.0, 1.0)
            }),
            "multiply",
        );
        p.opacity = 0.45;
        d.rect([0.0, 0.0, 1920.0, 1080.0], p);
        vgrad(
            &mut d,
            &[
                (0.0, rgb(8.0, 10.0, 24.0, 0.0)),
                (0.6, rgb(8.0, 10.0, 24.0, 0.12)),
                (1.0, rgb(8.0, 10.0, 24.0, 0.6)),
            ],
            1.0,
        );
    } else {
        super::background::background(&mut d, chest[0], chest[1], 0.0, None, false);
    }
    if ff {
        fireflies(&mut d, c.t);
    }
    let zoom = 1.0 + 0.065 * in_out_sine(c.progress) + 0.006 * pulse(&c.beats, c.t, 8.0);
    d.operations = vec![
        Operation::Translate { offset: chest },
        Operation::Scale {
            factors: [zoom, zoom],
        },
        Operation::Translate {
            offset: [-chest[0], -chest[1]],
        },
    ];
    if a.bg.is_none() {
        let saved = d.operations.clone();
        d.operations.push(Operation::Translate {
            offset: [cx, cy - 30.0],
        });
        d.operations.push(Operation::Scale {
            factors: [1.0, 0.16],
        });
        d.rect(
            [-620.0, -620.0, 1240.0, 1240.0],
            fill(
                radial(
                    0.0,
                    0.0,
                    620.0,
                    &[
                        (0.0, rgb(255.0, 165.0, 82.0, 0.28)),
                        (0.5, rgb(122.0, 35.0, 80.0, 0.18)),
                        (1.0, rgb(122.0, 35.0, 80.0, 0.0)),
                    ],
                ),
                "source-over",
            ),
        );
        d.operations = saved;
    }
    d.glow(
        chest[0],
        chest[1],
        420.0 + 380.0 * landed,
        if ff {
            rgb(111.0, 168.0, 106.0, 1.0)
        } else {
            DUSK
        },
        0.22 + 0.3 * landed,
    );
    figure::draw(
        &mut d,
        &Image {
            id: &a.char,
            width: character.width,
            height: character.height,
        },
        &Figure {
            position: [cx, cy],
            height: h,
            time: c.tq,
            breathe: 0.8,
            wave: Wave {
                amp: 6.0,
                from: 0.35,
                speed: 2.2,
            },
            shade: Some((
                if ff {
                    rgb(26.0, 38.0, 88.0, 1.0)
                } else {
                    rgb(42.0, 24.0, 66.0, 1.0)
                },
                if ff { 0.72 } else { 0.66 },
            )),
            silhouette: None,
            light: Some(Light {
                position: chest,
                radius: 330.0 + 330.0 * landed,
                alpha: 0.4 + 0.55 * landed,
            }),
            rim: Rim {
                color: if ff {
                    rgb(255.0, 154.0, 106.0, 1.0)
                } else {
                    rgb(217.0, 162.0, 232.0, 1.0)
                },
                offsets: if ff {
                    vec![[-2.0, -3.0], [2.0, -3.0]]
                } else {
                    vec![[0.0, -3.0]]
                },
                alpha: if ff { 0.55 } else { 0.35 },
            },
        },
    )?;
    for (i, p) in pose.floor.into_iter().enumerate() {
        let [x, y] = screen(p);
        let i = i as f64;
        let tw = (c.t * (1.3 + 0.4 * super::seeded::rnd(i, 3.0)) + i * 1.7)
            .sin()
            .abs()
            .powi(14);
        d.sparkle_color(
            x,
            y,
            6.0 + 16.0 * tw,
            0.2 + 0.7 * tw,
            if ff { FF_CORE } else { HOT },
            0.2,
            true,
        );
    }
    d.glow(
        chest[0],
        chest[1],
        110.0 + 240.0 * landed + 60.0 * land_pulse,
        if ff {
            rgb(232.0, 255.0, 154.0, 1.0)
        } else {
            GLOW
        },
        0.3 + 0.5 * landed,
    );
    d.glow(
        chest[0],
        chest[1],
        24.0 + 36.0 * landed + 30.0 * land_pulse,
        HOT,
        0.45 + 0.45 * landed,
    );
    d.commands.push(
        super::sprites::body(
            session.body_image.clone(),
            [
                session.body.display_size[0] as u32,
                session.body.display_size[1] as u32,
            ],
        )
        .map_err(str::to_owned)?,
    );
    super::gather_layers::shards(&mut d, session, &arrivals, c.t, chest, hand, ff)?;
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-body",
        }));
    d.operations.clear();
    dust(
        &mut d,
        c.t,
        40,
        45.0,
        if ff {
            rgb(220.0, 255.0, 170.0, 0.25)
        } else {
            rgb(255.0, 214.0, 190.0, 0.25)
        },
    );
    vignette(
        &mut d,
        0.5,
        if ff {
            rgb(4.0, 8.0, 18.0, 1.0)
        } else {
            rgb(8.0, 4.0, 14.0, 1.0)
        },
    );
    rebirth_contract::finish(
        Plan {
            commands: d.commands,
            raster_budget_bytes: 0,
        },
        session,
        s,
        character,
    )
}
