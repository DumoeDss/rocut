use super::{
    Sample, Session,
    draw::*,
    plan::{Frame, Operation, Plan},
};
pub fn frame(s: &Session, sample: &Sample<'_>) -> Result<Frame, String> {
    s.stage.idle()?;
    s.prepared()?;
    if sample.resources != s.resources
        || sample.beats.is_empty()
        || sample.beats.len() > 21600
        || sample.beats.windows(2).any(|b| b[0] >= b[1])
        || sample.beats.iter().any(|b| *b > 2_592_000_000)
        || !sample.bpm.is_finite()
        || !(1.0..=1000.0).contains(&sample.bpm)
        || sample.shot_start_ticks >= sample.shot_end_ticks
        || sample.shot_end_ticks > 2_592_000_000
        || sample.song_ticks < sample.shot_start_ticks
        || sample.song_ticks > sample.shot_end_ticks
    {
        return Err("Invalid Memories admitted resources or whole-song beat clock".into());
    }
    let t = sample.song_ticks as f64 / 120000.0;
    let t0 = sample.shot_start_ticks as f64 / 120000.0;
    let t1 = sample.shot_end_ticks as f64 / 120000.0;
    let progress = (t - t0) / (t1 - t0);
    let beats: Vec<_> = sample.beats.iter().map(|v| *v as f64 / 120000.0).collect();
    let defaults = [0, 2, 4, 6, 7, 8];
    let drops = s
        .args
        .drop_beats
        .as_deref()
        .unwrap_or(&defaults[..s.photos.len().min(6)]);
    let burn_defaults = [8.0, 9.0, 10.0, 11.0, 11.5, 12.0];
    let burns = s.args.burn_beats.as_deref().unwrap_or(&burn_defaults);
    if drops.is_empty()
        || burns.is_empty()
        || drops.len() > 16
        || burns.len() > 16
        || drops.iter().any(|v| *v > 21600)
        || burns
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0 || *v > 21600.0)
        || s.args
            .push_at
            .is_some_and(|v| !v.is_finite() || v.abs() > 21600.0)
    {
        return Err("Invalid Memories drop/burn schedule").map_err(str::to_owned);
    }
    let end_zoom = s.args.end_zoom.unwrap_or(1.9);
    if !end_zoom.is_finite() || !(0.01..=16.0).contains(&end_zoom) {
        return Err("Memories endZoom exceeds bounds".into());
    }
    let heroes: Vec<_> = s
        .photos
        .iter()
        .map(|p| (p.hero, p.field.face_level))
        .collect();
    let timing = super::motion::timing(
        &beats,
        60.0 / sample.bpm,
        t0,
        t1,
        drops,
        burns,
        s.args.push_at,
        &heroes,
    );
    let last = s.photos.last().ok_or("Memories photos are empty")?;
    let cam = super::motion::camera(t, &timing, last.slot, last.index, last.face, end_zoom);
    let win = 1.0
        - 0.8
            * super::math::smooth(
                timing.push - 0.2,
                timing
                    .burns
                    .get(1)
                    .map(|b| b.start + 0.5)
                    .unwrap_or(timing.push + 1.0),
                t,
            )
        - 0.15 * super::math::smooth(timing.start, timing.push, t);
    let mut d = Draw::new();
    let mut shadow = Draw::new();
    shadow.filtered_rect(
        [60.0, 60.0, 560.0, 431.0],
        fill(solid(color(8.0, 4.0, 3.0, 1.0)), "source-over"),
        14.0,
        None,
    );
    d.surface("memories-shadow", [680, 551], shadow.commands);
    d.surface("memories-window", [480, 270], super::bake::window());
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(solid(color(18.0, 13.0, 12.0, 1.0)), "source-over"),
    );
    d.operations = vec![
        Operation::Translate {
            offset: [960.0, 540.0],
        },
        Operation::Rotate {
            radians: cam.rotation,
        },
        Operation::Scale {
            factors: [cam.zoom, cam.zoom],
        },
        Operation::Translate {
            offset: [-cam.center[0], -cam.center[1]],
        },
    ];
    let camera = d.operations.clone();
    d.prepared(
        &s.desk.as_ref().unwrap().raster,
        [-160.0, -90.0, 2240.0, 1260.0],
        1.0,
        "source-over",
        "low",
    );
    let wx = super::math::lerp(-50.0, 80.0, progress);
    d.blit(
        "memories-window",
        [480, 270],
        [-180.0 + wx, -120.0, 2280.0, 1320.0],
        0.3 * win,
        "screen",
        None,
        "low",
    );
    let mut fires = Vec::new();
    let mut payloads = Vec::new();
    for (slot, p) in s.photos.iter().enumerate() {
        let Some(pose) = super::motion::pose(p.slot, p.index, timing.lands[slot], t) else {
            continue;
        };
        let burn = &timing.burns[slot];
        let b = super::motion::burn(t, burn);
        if b >= burn.to && !p.hero && b > 1.05 {
            super::particles::ash(&mut d, p, pose, burn, t);
            continue;
        }
        let lift = pose.height;
        let burnt = if b > 0.0 { b.clamp(0.0, 1.0) } else { 0.0 };
        d.operations = camera.clone();
        d.operations.extend([
            Operation::Translate {
                offset: [
                    pose.position[0] + 9.0 + 70.0 * lift,
                    pose.position[1] + 13.0 + 95.0 * lift,
                ],
            },
            Operation::Rotate {
                radians: pose.rotation,
            },
            Operation::Scale {
                factors: [pose.scale * (1.0 + 0.06 * lift); 2],
            },
        ]);
        d.blit(
            "memories-shadow",
            [680, 551],
            [-340.0, -275.5, 680.0, 551.0],
            (0.62 - 0.3 * lift) * pose.alpha * (1.0 - 0.85 * burnt),
            "source-over",
            None,
            "low",
        );
        d.operations = camera.clone();
        let cap = (((t - timing.lands[slot] - 0.12) * 12.0 + 1e-6).floor()
            / 12.0
            / (0.14 * (p.caption.chars().count() + 1) as f64))
            .clamp(0.0, 1.0);
        super::live::live(&mut d, s, p, slot, cap, b, t, &mut payloads)?;
        d.operations.extend([
            Operation::Translate {
                offset: pose.position,
            },
            Operation::Rotate {
                radians: pose.rotation,
            },
            Operation::Scale {
                factors: [pose.scale, pose.scale],
            },
            Operation::Translate {
                offset: [-280.0, -215.5],
            },
        ]);
        d.blit(
            "memories-live",
            [1120, 862],
            [0.0, 0.0, 560.0, 431.0],
            pose.alpha,
            "source-over",
            None,
            "low",
        );
        let la = t - timing.lands[slot];
        if la >= 0.0 && la < 0.3 {
            let mut paint = fill(solid(color(255.0, 227.0, 176.0, 1.0)), "lighter");
            paint.opacity = 0.16 * (-la * 14.0).exp() * win;
            d.rect([0.0, 0.0, 560.0, 431.0], paint);
        }
        if b > -0.5 {
            d.blit(
                "memories-glow",
                [320, 246],
                [0.0, 0.0, 560.0, 431.0],
                1.0,
                "lighter",
                None,
                "low",
            );
            d.blit(
                "memories-halo",
                [160, 123],
                [-11.2, -8.62, 582.4, 448.24],
                0.5,
                "lighter",
                None,
                "low",
            );
            let act = (std::f64::consts::PI
                * ((b - burn.from) / (1.05 - burn.from)).clamp(0.0, 1.0))
            .sin();
            fires.push((pose, act, slot));
        }
        d.operations = camera.clone();
        super::live::release(&mut d, b);
        super::particles::dust(&mut d, p, pose, timing.lands[slot], t, win);
        if b > -0.5 {
            super::particles::ash(&mut d, p, pose, burn, t);
        }
    }
    for (pose, act, j) in fires {
        let fl = 0.75 + 0.25 * super::math::noise(t * 9.0 + j as f64 * 3.0, 4.0);
        let [x, y] = pose.position;
        d.rect(
            [x - 600.0, y - 600.0, 1200.0, 1200.0],
            fill(
                radial(
                    [x, y, 10.0],
                    [x, y, 520.0 * pose.scale],
                    &[
                        (0.0, color(255.0, 130.0, 50.0, 0.2 * act * fl)),
                        (0.5, color(200.0, 80.0, 30.0, 0.08 * act * fl)),
                        (1.0, color(200.0, 80.0, 30.0, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
    d.operations.clear();
    super::finish::finish(&mut d, t, &timing, win, sample);
    d.release("memories-shadow");
    d.release("memories-window");
    let mut frame = Frame {
        plan: Plan {
            commands: d.commands,
            raster_budget_bytes: 0,
        },
        payloads,
    };
    frame.plan.raster_budget_bytes = super::budget::frame(&frame, s)?;
    Ok(frame)
}
