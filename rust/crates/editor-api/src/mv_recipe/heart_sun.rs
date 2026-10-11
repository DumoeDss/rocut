//! Complete original drawSun ordered native plan. Explicit images, no bundled fallback.
use super::{
    BackgroundFact, Plan, Sample, Session,
    draw::*,
    figure::{self, Figure, Image, Light, Rim, Wave},
    plan::{Command, Operation, native},
    rebirth_contract::{self, Sun},
    rebirth_draw::*,
};
pub fn frame(
    session: &Session,
    a: &Sun,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Plan, String> {
    let c = rebirth_contract::inspect(session, &a.heart, &a.char, None, s, character)?;
    let offset = a.fuse_beat.unwrap_or(2) as usize;
    if offset > 21600 {
        return Err("Heart fuse beat exceeds limits".into());
    }
    let tf = match a.fuse_at {
        Some(t) => t,
        None => super::timing::beat_time(
            &c.beats,
            super::timing::beat_index(&c.beats, c.t0) + offset,
            c.spb,
        )
        .ok_or("Missing Heart fusion beat")?,
    };
    let center = [a.sun_x.unwrap_or(960.0), a.sun_y.unwrap_or(300.0)];
    let rs = a.sun_r.unwrap_or(128.0);
    let h = a.char_h.unwrap_or(580.0);
    let cx = a.char_x.unwrap_or(960.0);
    let cy = a.char_y.unwrap_or(1100.0);
    rebirth_contract::geometry(&[center[0], center[1], rs, h, cx, cy])?;
    if !tf.is_finite() || tf.abs() > 21600.0 {
        return Err("Heart fusion time exceeds whole-song limits".into());
    }
    if rs <= 0.0 || h <= 0.0 {
        return Err("Heart sun and character sizes must be positive".into());
    }
    let tau = c.t - tf;
    let born = tau >= 0.0;
    let born_k = if born {
        out_back((tau / 0.3).clamp(0.0, 1.0), 1.6)
    } else {
        0.0
    };
    let gather = if born {
        1.0
    } else {
        inv(c.t0 - 0.25, tf, c.t).powi(3)
    };
    let pul = pulse(&c.beats, c.t, 7.0);
    let flood = if born {
        out_cubic((tau / 0.5).clamp(0.0, 1.0))
    } else {
        0.18 * gather
    };
    let mut d = Draw::new();
    super::sun_background::background(&mut d, center[0], center[1], flood);
    let zoom = 1.0
        + 0.035 * in_out_sine(c.progress)
        + if born {
            0.03 * decay(tau, 4.0)
        } else {
            0.015 * gather
        };
    let amp = if born {
        8.0 * decay(tau, 6.0)
    } else {
        1.0 + 3.0 * gather * gather
    };
    let q = (c.t * 24.0).floor();
    let shake = [
        super::seeded::rnds(q, 9.0) * amp,
        super::seeded::rnds(q, 16.0) * amp,
    ];
    d.operations = vec![
        Operation::Translate {
            offset: [center[0] + shake[0], center[1] + shake[1] + 150.0],
        },
        Operation::Scale {
            factors: [zoom, zoom],
        },
        Operation::Translate {
            offset: [-center[0], -center[1] - 150.0],
        },
    ];
    super::sun_background::core(
        &mut d, center, rs, c.t, tau, gather, born, born_k, flood, pul,
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
    super::sun_layers::particles(&mut d, session, c.t, c.tq, c.t0, tf, tau, center, rs)?;
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-body",
        }));
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
            breathe: 0.6,
            wave: Wave {
                amp: if born { 12.0 } else { 5.0 },
                from: 0.35,
                speed: 3.0,
            },
            shade: Some((
                if born {
                    rgb(106.0, 36.0, 64.0, 1.0)
                } else {
                    rgb(42.0, 14.0, 30.0, 1.0)
                },
                if born { 0.62 } else { 0.88 },
            )),
            silhouette: None,
            light: Some(Light {
                position: [center[0], center[1] + 60.0],
                radius: 1000.0,
                alpha: if born {
                    0.2 + 0.55 * flood
                } else {
                    0.25 * gather
                },
            }),
            rim: Rim {
                color: if born {
                    rgb(255.0, 224.0, 168.0, 1.0)
                } else {
                    rgb(255.0, 154.0, 90.0, 1.0)
                },
                offsets: vec![[0.0, -4.0], [-3.0, -3.0], [3.0, -3.0]],
                alpha: if born { 1.0 } else { 0.2 + 0.6 * gather },
            },
        },
    )?;
    d.operations.clear();
    if born {
        let mut p = fill(solid(rgb(255.0, 231.0, 196.0, 1.0)), "lighter");
        p.opacity = 0.55 * decay(tau, 8.0);
        d.rect([0.0, 0.0, 1920.0, 1080.0], p);
    }
    super::embers::draw(
        &mut d,
        c.t,
        super::embers::Embers {
            count: 70,
            seed: 58.0,
            area: [0.0, 324.0, 1920.0, 1160.0],
            color: rgb(255.0, 122.0, 42.0, 1.0),
            rise: 120.0,
            size: 2.8,
            alpha: if born { 0.9 } else { 0.5 },
            wind: 0.1,
        },
    );
    vignette(
        &mut d,
        if born { 0.45 } else { 0.6 },
        rgb(14.0, 4.0, 8.0, 1.0),
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
