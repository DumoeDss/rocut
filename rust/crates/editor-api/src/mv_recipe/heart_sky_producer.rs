//! Complete original drawSkyShatter layer ordering, including foreground-after-character.
use super::{
    draw::*,
    figure::{self, Figure, Image, Rim, Wave},
    plan::Operation,
    rebirth_draw::*,
    sky::{self, Args, Session},
    sky_plan::{self, Plan},
    BackgroundFact, Sample,
};
fn camera(d: &mut Draw, par: f64, shake: [f64; 2], zoom: f64, p: f64) {
    d.operations = vec![
        Operation::Translate {
            offset: [
                960.0 + shake[0] * par,
                520.0 + shake[1] * par + 18.0 * p * par,
            ],
        },
        Operation::Scale {
            factors: [1.0 + (zoom - 1.0) * par; 2],
        },
        Operation::Translate {
            offset: [-1100.0, -660.0],
        },
    ];
}
pub fn frame(
    session: &Session,
    a: &Args,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Plan, String> {
    let clock = super::sky_validation::inspect(session, a, s, character)?;
    let bands = a.bands.unwrap_or(5) as usize;
    let release = a.release_beat.unwrap_or(1) as usize;
    if bands == 0 || bands > 64 || release > 21600 {
        return Err("Sky release bands or beat exceed limits".into());
    }
    let i0 = super::timing::beat_index(&clock.beats, clock.t0) + release;
    let band_times: Vec<f64> = (0..bands)
        .map(|i| {
            super::timing::beat_time(&clock.beats, i0 + i, clock.spb)
                .ok_or("Missing sky release beat")
        })
        .collect::<Result<_, _>>()?;
    let releases: Vec<f64> = session
        .pieces
        .iter()
        .map(|p| super::sky_motion::release(p.near, p.jitter, p.angle, bands, &band_times))
        .collect();
    let reveal =
        releases.iter().filter(|tr| clock.t >= **tr).count() as f64 / session.pieces.len() as f64;
    let jolt = band_times
        .iter()
        .enumerate()
        .map(|(b, tr)| {
            if clock.t >= *tr {
                decay(clock.t - tr, 9.0) * if b == 0 { 1.4 } else { 1.0 }
            } else {
                0.0
            }
        })
        .sum::<f64>();
    let q = (clock.t * 24.0).floor();
    let amp = 1.0 + 7.0 * jolt;
    let shake = [
        super::seeded::rnds(q, 5.0) * amp,
        super::seeded::rnds(q, 12.0) * amp,
    ];
    let zoom = 1.0 + 0.06 * in_out_sine(clock.progress) + 0.008 * jolt;
    let mut commands = vec![
        super::sky_background::texture(&a.bg, session.dimensions[0], session.dimensions[1]),
        super::sky_background::night(&session.night, session.night_color),
        super::sky_background::ground(),
    ];
    let mut d = Draw::new();
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(solid(session.night_color), "source-over"),
    );
    camera(&mut d, 0.35, shake, zoom, clock.progress);
    d.blit(
        "sky-night",
        [2200, 1360],
        [0.0, 0.0, 2200.0, 1360.0],
        1.0,
        "source-over",
    );
    for st in &session.night.twinkles {
        let tw = 0.45 + 0.55 * (clock.t * st.frequency + st.phase).sin().powi(2);
        d.sparkle_color(
            st.position[0],
            st.position[1],
            st.radius * (0.7 + 0.3 * tw),
            0.25 + 0.6 * tw * reveal + 0.15,
            if st.cool {
                rgb(191.0, 212.0, 255.0, 1.0)
            } else {
                rgb(255.0, 232.0, 207.0, 1.0)
            },
            0.0,
            true,
        );
    }
    camera(&mut d, 1.0, shake, zoom, clock.progress);
    let crack = 0.55 + 0.3 * pulse(&clock.beats, clock.t, 6.0);
    let mut falling = Vec::new();
    let mut foreground = Vec::new();
    for (p, tr) in session.pieces.iter().zip(&releases) {
        let tau = clock.t - tr;
        if tau < 0.0 {
            super::sky_layers::waiting(&mut d, p, clock.t, *tr, crack);
        } else if p.foreground {
            foreground.push((p, tau));
        } else {
            falling.push((p, tau));
        }
    }
    falling.sort_by(|a, b| a.1.total_cmp(&b.1));
    for (p, tau) in falling {
        super::sky_layers::falling(&mut d, p, tau);
    }
    super::sky_layers::debris(&mut d, session, &releases, clock.t);
    d.blit(
        "sky-ground",
        [2200, 1560],
        [0.0, 0.0, 2200.0, 1560.0],
        1.0,
        "source-over",
    );
    let x = a.char_x.unwrap_or(1070.0) + 140.0;
    let h = a.char_h.unwrap_or(400.0);
    super::rebirth_contract::geometry(&[x, h])?;
    if h <= 0.0 {
        return Err("Sky character height must be positive".into());
    }
    let cool = smooth(0.35, 0.8, reveal);
    figure::draw(
        &mut d,
        &Image {
            id: &a.char,
            width: character.width,
            height: character.height,
        },
        &Figure {
            position: [x, super::sky_geometry::ground(x) + 5.0],
            height: h,
            time: clock.tq,
            breathe: 0.5,
            wave: Wave {
                amp: 8.0,
                from: 0.12,
                speed: 3.4,
            },
            shade: None,
            silhouette: Some((rgb(11.0, 7.0, 20.0, 1.0), 0.14)),
            light: None,
            rim: Rim {
                color: if cool < 0.5 {
                    rgb(255.0, 176.0, 112.0, 1.0)
                } else {
                    rgb(169.0, 204.0, 255.0, 1.0)
                },
                offsets: vec![[3.0, -3.0], [-2.0, -3.0]],
                alpha: 0.95,
            },
        },
    )?;
    foreground.sort_by(|a, b| a.1.total_cmp(&b.1));
    for (p, tau) in foreground {
        super::sky_layers::falling(&mut d, p, tau);
    }
    d.operations.clear();
    vgrad(
        &mut d,
        &[
            (0.0, rgb(7.0, 11.0, 28.0, 0.35)),
            (0.4, rgb(7.0, 11.0, 28.0, 0.0)),
            (1.0, rgb(7.0, 11.0, 28.0, 0.0)),
        ],
        reveal,
    );
    vignette(&mut d, 0.5, rgb(5.0, 6.0, 16.0, 1.0));
    commands.extend(sky_plan::heart(d.commands));
    for id in ["sky-texture", "sky-night", "sky-ground"] {
        commands.push(sky_plan::release(id));
    }
    let mut plan = Plan {
        commands,
        raster_budget_bytes: 0,
    };
    plan.raster_budget_bytes = super::sky_budget::validate(&plan, session, character)?;
    Ok(plan)
}
