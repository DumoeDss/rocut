use super::{
    graphics::*,
    model::*,
    plan::{self, native::*},
};
use crate::mv_recipe::converge::Stop;
use crate::{mv_recipe::ember::Sample, programmatic_resources::Resource};
fn out_expo(t: f64) -> f64 {
    if t >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * t)
    }
}
fn out_cubic(t: f64) -> f64 {
    1.0 - (1.0 - t).powi(3)
}
fn mix(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}
fn camera(v: Option<&View>, default: [f64; 4]) -> [f64; 4] {
    v.map_or(default, |v| {
        [
            v.zoom.unwrap_or(default[0]),
            v.x.unwrap_or(default[1]),
            v.y.unwrap_or(default[2]),
            v.rot.unwrap_or(default[3]),
        ]
    })
}
fn flash(a: &Args, k: usize) -> bool {
    match &a.flash {
        Some(Flash::Enabled(false)) => false,
        Some(Flash::Mode(s)) if s == "none" => false,
        Some(Flash::Mode(s)) if s == "all" => true,
        Some(Flash::Cuts(v)) => v.contains(&(k as u32)),
        _ => k % 2 == 1,
    }
}
pub(in crate::mv_recipe) fn plan(
    a: &Args,
    bpm: f64,
    s: &Sample<'_>,
    resources: &[Resource],
) -> Result<plan::Plan, String> {
    if !super::valid(a, resources)
        || !bpm.is_finite()
        || !(1.0..=1000.0).contains(&bpm)
        || s.width != 1920.0
        || s.height != 1080.0
    {
        return Err("Burst requires valid authors/BPM and exact1920x1080 native surface".into());
    }
    let data = crate::mv_recipe::heart_recipe::runtime_ready(
        s.analysis,
        s.shot_start_ticks,
        s.shot_end_ticks,
    )?;
    if let Some(font) = &a.hud_font {
        let facts = s
            .fonts
            .ok_or("Burst HUD requires admitted physical font glyph facts")?;
        for text in "CUT /0123456789".chars() {
            facts.glyph(font, &text.to_string())?;
        }
    }
    if s.song_ticks < s.shot_start_ticks || s.song_ticks > s.shot_end_ticks {
        return Err("Burst mapped song clock outside shot".into());
    }
    let beats: Vec<f64> = data.beats.iter().map(|v| *v as f64 / 120000.0).collect();
    let t = s.song_ticks as f64 / 120000.0;
    let t0 = s.shot_start_ticks as f64 / 120000.0;
    let t1 = s.shot_end_ticks as f64 / 120000.0;
    let lead = a.lead.unwrap_or(1.0 / 30.0);
    let every = a.every.unwrap_or(1) as usize;
    let index = |t: f64| beats.partition_point(|b| *b <= t).saturating_sub(1);
    let i0 = index(t0 + lead + 0.005);
    let i = index(t + lead).max(i0);
    let k = (i - i0) / every;
    let cs = if k == 0 {
        t0
    } else {
        beats[i0 + k * every] - lead
    };
    let ce = beats
        .get(i0 + (k + 1) * every)
        .map_or(cs + 60.0 / bpm * every as f64, |b| *b - lead);
    let lc = (t - cs).max(0.0);
    let cd = (ce - cs).max(0.1);
    let u = (lc / cd).clamp(0.0, 1.0);
    let f = (lc * 30.0 + 1e-6).floor() as u32;
    let ncuts = beats
        .iter()
        .skip(i0)
        .step_by(every)
        .take_while(|b| **b - lead < t1 - 0.05)
        .count();
    let cut = &a.cuts[k % a.cuts.len()];
    let pass = k / a.cuts.len();
    let dir = cut
        .dir
        .map_or(if (k + pass) % 2 == 0 { 1.0 } else { -1.0 }, |v| v as f64);
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut overlay = Vec::new();
    if let Some(id) = &cut.bg {
        let img = s
            .images
            .ok_or("Burst missing admitted image dimensions")?
            .image(id)?;
        let v0 = camera(cut.view.as_ref(), [1.24, -0.55 * dir, 0.05, 0.0]);
        let v1 = camera(
            cut.view_to.as_ref(),
            [v0[0] * 1.075, v0[1] + 0.3 * dir, v0[2], v0[3]],
        );
        let mut v = [0.0; 4];
        for j in 0..4 {
            v[j] = mix(v0[j], v1[j], 1.0 - (1.0 - u).powi(4));
        }
        v[0] *= 1.0 + 0.035 * (1.0 - out_expo((lc / 0.2).clamp(0.0, 1.0)));
        let scale = (1920.0 / img.width as f64).max(1080.0 / img.height as f64) * v[0];
        let dw = img.width as f64 * scale;
        let dh = img.height as f64 * scale;
        let mx = ((dw - 1920.0) / 2.0).max(0.0);
        let my = ((dh - 1080.0) / 2.0).max(0.0);
        let (sn, co) = v[3].sin_cos();
        before.push(Command::Image {
            image: id.clone(),
            source_rect: None,
            destination_rect: [-dw / 2.0, -dh / 2.0, dw, dh],
            transform: [co, sn, -sn, co, 960.0 + v[1] * mx, 540.0 + v[2] * my],
            operations: Vec::new(),
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "high",
        });
        if let Some(l) = &cut.lamps {
            let signed_index = beats.partition_point(|b| *b <= t) as i32 - 1;
            let pulse = if signed_index < 0 {
                0.0
            } else {
                (-5.0 * (t - beats[signed_index as usize])).exp()
            };
            let downbeat = data
                .downbeats
                .first()
                .map_or(0, |tick| data.beats.partition_point(|b| *b < *tick) as i32);
            let on = (signed_index - downbeat).rem_euclid(2) as usize;
            for (gi, points) in [&l.a, &l.b].into_iter().enumerate() {
                for xy in points {
                    let x = (xy[0] - img.width as f64 / 2.0) * scale;
                    let y = (xy[1] - img.height as f64 / 2.0) * scale;
                    let xy = [
                        960.0 + v[1] * mx + x * co - y * sn,
                        540.0 + v[2] * my + x * sn + y * co,
                    ];
                    let r = l.radius * scale;
                    if gi == on {
                        glow(
                            &mut before,
                            xy,
                            r * 7.0,
                            c(255.0, 59.0, 46.0, 1.0),
                            0.55 + 0.35 * pulse,
                        );
                        disc(&mut before, xy, r * 0.95, c(255.0, 106.0, 85.0, 1.0));
                        glow(&mut before, xy, r * 1.3, c(255.0, 224.0, 208.0, 1.0), 0.9);
                    } else {
                        disc(&mut before, xy, r * 1.04, c(28.0, 7.0, 9.0, 0.9));
                    }
                }
            }
        }
    } else {
        fill(
            &mut before,
            cut.color.unwrap_or(c(20.0, 11.0, 30.0, 1.0)),
            "source-over",
        );
    }
    let g = if a.grade.as_deref() == Some("night2dawn") {
        Some(if ncuts > 1 {
            ((k as f64 + 0.35 * u) / (ncuts - 1) as f64).clamp(0.0, 1.0)
        } else {
            ((t - t0) / (t1 - t0)).clamp(0.0, 1.0)
        })
    } else {
        None
    };
    if let Some(g) = g {
        grade(&mut before, g, 1.0);
    }
    if a.speed.unwrap_or(true) {
        let sa = 1.0 - (lc / (cd * 0.7)).clamp(0.0, 1.0);
        if sa > 0.0 {
            speed(
                &mut before,
                t,
                k,
                dir,
                cut.line_color.unwrap_or(c(255.0, 244.0, 220.0, 1.0)),
                0.34 * sa * sa,
            );
        }
    }
    let character = cut
        .character
        .as_ref()
        .map(|ch| -> Result<_, String> {
            let img = s
                .images
                .ok_or("Burst missing native character dimensions")?
                .image(&ch.image)?;
            let lq = ((t * 12.0 + 1e-6).floor() / 12.0 - cs).max(0.0);
            let pop = out_expo((lq / 0.24).clamp(0.0, 1.0));
            let x = ch.x.unwrap_or(1920.0 * (0.5 + 0.17 * dir)) - dir * 150.0 * (1.0 - pop);
            let y = ch.y.unwrap_or(1110.0);
            let h = ch.h.unwrap_or(1080.0) * mix(0.93, 1.0, pop) * (1.0 + 0.03 * out_cubic(u));
            let w = h * img.width as f64 / img.height as f64;
            let phase = ch.phase.unwrap_or(0.0);
            let rotation =
                ch.rot.unwrap_or(0.0) + ch.sway.unwrap_or(0.006) * (t * 1.3 + phase).sin();
            let (sn, co) = rotation.sin_cos();
            let br = 1.0 + ch.breathe.unwrap_or(1.0) * 0.012 * (t * 2.1 + phase).sin();
            let flip = if ch.flip { -1.0 } else { 1.0 };
            let anchor = ch.anchor.unwrap_or([0.5, 1.0]);
            let x0 = -w * anchor[0];
            let y0 = -h * anchor[1];
            let mut strips = Vec::new();
            if ch.disable_wave || ch.wave.as_ref().is_some_and(|w| w.amp == 0.0) {
                strips.push(plan::Strip {
                    source: [0.0, 0.0, img.width as f64, img.height as f64],
                    destination: [x0, y0, w, h],
                });
            } else {
                let wave = ch.wave.clone().unwrap_or(Wave {
                    amp: 9.0,
                    from: 0.35,
                    freq: 2.2,
                    speed: 3.2,
                    drawing_fps: 12,
                });
                let tt = (t * wave.drawing_fps as f64 + 1e-6).floor() / wave.drawing_fps as f64;
                for i in 0..90 {
                    let v = i as f64 / 90.0;
                    let end = (i + 1) as f64 / 90.0;
                    let q = ((v - wave.from) / (1.0 - wave.from)).clamp(0.0, 1.0);
                    let dx = wave.amp
                        * q
                        * q
                        * (v * wave.freq * std::f64::consts::TAU - tt * wave.speed).sin()
                        + wave.amp * 0.35 * q * (tt * 1.7 + v * 3.0).sin();
                    strips.push(plan::Strip {
                        source: [
                            0.0,
                            v * img.height as f64,
                            img.width as f64,
                            (end - v) * img.height as f64 + 1.0,
                        ],
                        destination: [x0 + dx, y0 + v * h, w, (end - v) * h + 1.0],
                    });
                }
            }
            let rim = if cut.disable_rim || a.disable_rim {
                None
            } else {
                Some(cut.rim.or(a.rim).unwrap_or_else(|| {
                    g.map_or(c(255.0, 165.0, 82.0, 1.0), |g| {
                        let g = (g * 4.0).round() / 4.0;
                        c(
                            mix(127.0, 255.0, g).round(),
                            mix(168.0, 179.0, g).round(),
                            mix(255.0, 138.0, g).round(),
                            1.0,
                        )
                    })
                }))
            };
            Ok(plan::Sprite {
                image: ch.image.clone(),
                transform: [co * flip, sn * flip, -sn * br, co * br, x, y],
                strips,
                opacity: ch.alpha.unwrap_or(1.0),
                rim,
                rim_offset: [10.0 * cut.rim_dir.map_or(-dir, |v| v as f64), -6.0],
                rim_opacity: cut.rim_a.unwrap_or(0.9),
            })
        })
        .transpose()?;
    for tint in &cut.tint {
        fill(
            &mut after,
            alpha(tint.color, tint.amount),
            composite(&tint.composite),
        );
    }
    if let Some(g) = g {
        grade(&mut after, g, 0.35);
    }
    radial(
        &mut after,
        [960.0, 540.0],
        1080.0 * 0.35,
        1080.0 * 1.05,
        vec![
            Stop {
                offset: 0.0,
                color: c(8.0, 4.0, 14.0, 0.0),
            },
            Stop {
                offset: 1.0,
                color: c(8.0, 4.0, 14.0, 0.55),
            },
        ],
    );
    let roll = dir * a.roll.unwrap_or(0.018) * (1.0 - 0.4 * out_cubic(u));
    let (sn, co) = roll.sin_cos();
    let offsets: Vec<(f64, f64)> = if k > 0 && f == 0 {
        vec![(dir * 90.0, 1.0), (dir * 45.0, 0.55), (0.0, 0.5)]
    } else if k > 0 && f == 1 {
        vec![(dir * 22.0, 1.0), (0.0, 0.6)]
    } else {
        vec![(0.0, 1.0)]
    };
    let placements = offsets
        .into_iter()
        .map(|(dx, opacity)| plan::Placement {
            transform: [
                co * 1.045,
                sn * 1.045,
                -sn * 1.045,
                co * 1.045,
                960.0 + dx,
                540.0,
            ],
            opacity,
        })
        .collect();
    if k > 0 && flash(a, k) && f < 2 {
        fill(
            &mut overlay,
            alpha(
                a.flash_color.unwrap_or(c(255.0, 244.0, 220.0, 1.0)),
                if f == 0 { 0.88 } else { 0.3 },
            ),
            "source-over",
        );
    }
    if let Some(font) = &a.hud_font {
        overlay.push(Command::Text {
            font: font.clone(),
            text: format!("CUT {:02}/{:02}", k + 1, ncuts),
            font_size: 22.0,
            tracking: 0.0,
            position: [64.0, 1028.0],
            transform: ID,
            operations: Vec::new(),
            fill: TextFill::Color {
                color: c(244.0, 239.0, 230.0, 0.75),
            },
            opacity: 1.0,
            composite: "source-over",
            align: "left",
            baseline: "alphabetic",
        });
    }
    let sprite_bytes = character.as_ref().map_or(0, |ch| {
        s.images
            .unwrap()
            .image(&ch.image)
            .map(|i| u64::from(i.width) * u64::from(i.height) * 4)
            .unwrap_or(0)
    });
    let result = plan::Plan {
        before: Plan { commands: before },
        character,
        after: Plan { commands: after },
        placements,
        overlay: Plan { commands: overlay },
        cut_index: k as u32,
        cut_start_ticks: cs * 120000.0,
        cut_end_ticks: ce * 120000.0,
        allocation_bytes: 1920 * 1080 * 4 + sprite_bytes,
    };
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len() as u64
        > super::plan_bytes_bound(a)
    {
        return Err("Burst expanded frame plan exceeds transport ceiling".into());
    }
    Ok(result)
}
