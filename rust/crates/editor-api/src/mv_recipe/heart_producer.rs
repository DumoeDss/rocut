use super::{
    HeartShatter, Plan, Sample, Session,
    draw::*,
    plan::{Command, Operation},
};
fn pulse(beats: &[f64], t: f64, k: f64) -> f64 {
    let count = beats.partition_point(|v| *v <= t);
    let since = if count == 0 {
        1e9
    } else {
        t - beats[count - 1]
    };
    (-k * since).exp()
}
pub fn frame(session: &Session, a: &HeartShatter, s: &Sample<'_>) -> Result<Plan, String> {
    break_frame(session, a, s, false)
}
pub fn break_frame(
    session: &Session,
    a: &HeartShatter,
    s: &Sample<'_>,
    burn: bool,
) -> Result<Plan, String> {
    if let Some(issue) = crate::programmatic_resources::validate(s.resources).first() {
        return Err(issue.message.clone());
    }
    let resource = s
        .resources
        .iter()
        .find(|r| r.id == a.heart)
        .ok_or("Heart requires an explicit source image")?;
    if resource != &session.binding.source {
        return Err("Heart prepared session source descriptor mismatch".into());
    }
    if s.beats.is_empty()
        || s.beats.len() > 21600
        || s.beats.windows(2).any(|p| p[0] >= p[1])
        || s.beats.iter().any(|v| *v > 2_592_000_000)
        || !s.bpm.is_finite()
        || !(1.0..=1000.0).contains(&s.bpm)
        || s.shot_start_ticks >= s.shot_end_ticks
        || s.song_ticks < s.shot_start_ticks
        || s.song_ticks > s.shot_end_ticks
        || s.shot_end_ticks > 2_592_000_000
        || ![a.x, a.y]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 8192.0)
        || a.break_beat > 21600
    {
        return Err(
            "Heart requires bounded whole-song beats, finite geometry and a valid shot clock"
                .into(),
        );
    }
    match (&a.bg, &s.background) {
        (None, None) => {}
        (Some(id), Some(fact)) => {
            let declared = s
                .resources
                .iter()
                .find(|r| &r.id == id)
                .ok_or("Heart background resource is missing")?;
            if declared != fact.resource || declared.kind != "image" {
                return Err("Heart background dimensions descriptor mismatch".into());
            }
            crate::image_sequence::decoded_image_bytes(fact.width, fact.height)?;
        }
        _ => {
            return Err(
                "Heart background dimensions must match the explicit background binding".into(),
            );
        }
    }
    let beats: Vec<f64> = s.beats.iter().map(|v| *v as f64 / 120000.0).collect();
    let t = s.song_ticks as f64 / 120000.0;
    let t0 = s.shot_start_ticks as f64 / 120000.0;
    let end = s.shot_end_ticks as f64 / 120000.0;
    let tq = (t * 12.0 + 1e-6).floor() / 12.0;
    let c = super::timing::break_clock(
        super::timing::Input {
            beats: &beats,
            seconds_per_beat: 60.0 / s.bpm,
            shot_start: t0,
            time: t,
            progress: (t - t0) / (end - t0),
            break_beat: a.break_beat as usize,
            break_at: a.break_at,
        },
        burn,
    )
    .map_err(str::to_owned)?;
    let width = session.body.display_size[0] as u32;
    let height = session.body.display_size[1] as u32;
    let offset = [a.x - width as f64 / 2.0, a.y - height as f64 / 2.0];
    let impact = [
        offset[0] + session.glass.impact[0],
        offset[1] + session.glass.impact[1],
    ];
    let mut d = Draw::new();
    d.commands.push(
        super::sprites::body(session.body_image.clone(), [width, height]).map_err(str::to_owned)?,
    );
    if burn && !c.broken {
        d.commands.push(super::sprites::hot_body([width, height]));
    }
    super::background::background(
        &mut d,
        a.x,
        a.y,
        if c.broken { decay(c.tau, 2.6) } else { 0.0 },
        s.background.as_ref(),
        burn,
    );
    if burn {
        super::embers::draw(
            &mut d,
            t,
            super::embers::Embers {
                count: 70,
                seed: 53.0,
                area: [0.0, 1080.0 * 0.2, 1920.0, 1140.0],
                color: rgb(255.0, 122.0, 42.0, 1.0),
                rise: 90.0,
                size: 2.4,
                alpha: 0.7,
                wind: 0.0,
            },
        );
    }
    d.operations = vec![
        Operation::Translate {
            offset: [a.x + c.shake[0], a.y + c.shake[1]],
        },
        Operation::Scale {
            factors: [c.zoom, c.zoom],
        },
        Operation::Translate {
            offset: [-a.x, -a.y],
        },
    ];
    d.glow(
        impact[0],
        impact[1],
        560.0 + 220.0 * c.heat,
        if burn {
            rgb(200.0, 55.0, 58.0, 1.0)
        } else {
            DUSK
        },
        0.28 + 0.3 * c.heat,
    );
    super::layers::measuring_ring(&mut d, impact, tq, &c, burn);
    super::layers::chips(&mut d, session, offset, impact, tq, &c);
    if c.broken {
        super::layers::broken(
            &mut d,
            session,
            offset,
            impact,
            t,
            &c,
            pulse(&beats, t, 7.0),
            tq,
            burn,
        )?;
    } else {
        super::layers::intact(
            &mut d,
            session,
            impact,
            t,
            tq,
            t0,
            &c,
            pulse(&beats, t, 9.0),
            burn,
        );
    }
    d.operations.clear();
    if c.broken {
        let mut paint = fill(
            solid(if burn {
                rgb(255.0, 154.0, 90.0, 1.0)
            } else {
                rgb(255.0, 217.0, 176.0, 1.0)
            }),
            "lighter",
        );
        paint.opacity = if c.impact { 0.5 } else { 0.3 } * decay(c.tau, 9.0);
        d.rect([0.0, 0.0, 1920.0, 1080.0], paint);
    }
    super::background::dust(&mut d, t, burn);
    if burn {
        super::embers::draw(
            &mut d,
            t,
            super::embers::Embers {
                count: 40,
                seed: 57.0,
                area: [0.0, 1080.0 * 0.5, 1920.0, 1160.0],
                color: rgb(255.0, 90.0, 31.0, 1.0),
                rise: 140.0,
                size: 3.2,
                alpha: 0.8,
                wind: 0.2,
            },
        );
    }
    super::background::vignette(&mut d);
    if burn && !c.broken {
        d.commands.push(Command::Native(
            super::plan::native::Command::ReleaseSurface {
                surface: "heart-hot-body",
            },
        ));
    }
    d.commands.push(Command::Native(
        super::plan::native::Command::ReleaseSurface {
            surface: "heart-body",
        },
    ));
    let mut plan = Plan {
        commands: d.commands,
        raster_budget_bytes: 0,
    };
    plan.raster_budget_bytes = super::budget::validate(&plan, session, s.background.as_ref())?;
    Ok(plan)
}
