use super::{
    Sample,
    clock::seconds,
    draw::*,
    ease::*,
    grain, keys, light,
    math::*,
    model::Collapse,
    particles,
    plan::{Clip, Command, Operation},
};

pub(super) fn draw(d: &mut Draw, a: &Collapse, s: &Sample<'_>) -> Result<(), String> {
    let dimensions = s
        .images
        .ok_or("Ember collapse requires decoded image dimensions")?
        .image(&a.image)?;
    let keys = keys::resolve(a, s)?;
    let t = seconds(s.song_ticks);
    let start = seconds(s.shot_start_ticks);
    let end = seconds(a.end_ticks);
    let p = &a.palette;
    d.background(p.background);
    let mut f = keys[0].factor;
    for pair in keys.windows(2) {
        if t >= pair[0].time {
            f = lerp(
                pair[0].factor,
                pair[1].factor,
                ease(
                    seg(t, pair[0].time, pair[1].time - pair[0].time),
                    pair[1].easing,
                ),
            );
        }
    }
    if t >= end {
        f = 0.0
    }
    if !f.is_finite() || !(0.0..=1.0).contains(&f) {
        return Err("Ember collapse easing produced an invalid iris factor".into());
    }
    let u = clamp((t - start) / (end - start));
    let r = 1150.0 * f;
    let hits: Vec<_> = keys.iter().filter(|k| k.hit).map(|k| k.time).collect();
    let hf = hits
        .iter()
        .map(|h| hit(t, *h, 10.0))
        .fold(0.0_f64, f64::max);
    let k = ease(clamp(u / 0.7), super::model::Easing::Io);
    let fx = a.focus[0].abs() * k;
    let fy = a.focus[1].abs() * k;
    let need = (r.min(960.0) / (960.0 - fx).max(1.0)).max(r.min(540.0) / (540.0 - fy).max(1.0));
    let image_scale = f.max(1e-4).powf(0.55).max(need);
    let phase = clamp((t - keys[2].time) / (end - keys[2].time));
    let twist = 2.6 * (phase * phase);
    if r > 1.5 {
        let n = if twist > 0.02 { 9 } else { 1 };
        let cover =
            (1920.0 / f64::from(dimensions.width)).max(1080.0 / f64::from(dimensions.height));
        let dw = f64::from(dimensions.width) * cover;
        let dh = f64::from(dimensions.height) * cover;
        for j in 0..n {
            let inner = r * j as f64 / n as f64;
            let outer = if j == n - 1 {
                r + 2.0
            } else {
                r * (j + 1) as f64 / n as f64 + 1.0
            };
            let rot = twist * (1.0 - (j as f64 + 0.5) / n as f64).powi(2);
            let mut path = circle(960.0, 540.0, outer);
            if inner > 0.0 {
                path.push(arc(960.0, 540.0, inner, 0.0, TAU, true));
            }
            d.commands.push(Command::Image {
                image: a.image.clone(),
                source_rect: None,
                destination_rect: [-dw / 2.0, -dh / 2.0, dw, dh],
                transform: d.identity(),
                operations: vec![
                    Operation::Translate {
                        offset: [960.0, 540.0],
                    },
                    Operation::Rotate { radians: rot },
                    Operation::Scale {
                        factors: [image_scale, image_scale],
                    },
                    Operation::Translate {
                        offset: [-960.0 - a.focus[0] * k, -540.0 - a.focus[1] * k],
                    },
                    Operation::Translate {
                        offset: [960.0, 540.0],
                    },
                ],
                clip: Some(Clip {
                    transform: d.identity(),
                    operations: Vec::new(),
                    path,
                }),
                composite: "source-over",
                opacity: 1.0,
                smoothing: true,
                smoothing_quality: "high",
            });
        }
        let burn = (1.0 - f).powf(1.6) * 0.85 + 0.35 * hf;
        d.clip = Some(d.clip_circle(r + 1.0));
        d.rect(
            [
                960.0 - r - 2.0,
                540.0 - r - 2.0,
                2.0 * r + 4.0,
                2.0 * r + 4.0,
            ],
            fill(
                radial(
                    960.0,
                    540.0,
                    r.max(2.0),
                    &[
                        (0.0, rgba(p.core, burn * 1.1)),
                        (0.6, rgba(p.glow, burn * 0.55)),
                        (1.0, rgba(p.sunset, burn * 0.35)),
                    ],
                ),
                "lighter",
            ),
        );
        d.clip = None;
    }
    let amount = sine(inv(0.12, 0.5, u)) * (1.0 - inv(0.965, 0.99, u)) * (1.1 + 1.4 * hf);
    particles::inward(d, t, r, amount, twist, 0.8 + 2.2 * u, 0.7 + 1.1 * u, p);
    for h in hits {
        let dt = t - h;
        if (0.0..0.35).contains(&dt) {
            let e = out(dt / 0.35);
            d.path(
                circle(960.0, 540.0, r + 30.0 + 500.0 * (1.0 - e)),
                vec![stroke(
                    solid(rgba(p.hi, 0.6 * (1.0 - e))),
                    2.0 + 6.0 * (1.0 - e),
                    "butt",
                    "miter",
                )],
            );
        }
    }
    let rim = clamp(inv(0.95, 0.75, f)) * (0.45 + 0.6 * (1.0 - f)) + 0.8 * hf;
    if r > 14.0 {
        light::fire_ring(d, 960.0, 540.0, r, rim, t, p, 0.55 + 0.6 * (1.0 - f), 1.0);
    }
    let land = keys.last().expect("validated collapse keys").time;
    let intensity = clamp(inv(0.2, 0.01, f)) * 0.5
        + 0.9 * hit(t, land, 9.0) * if t >= land { 1.0 } else { 0.0 };
    if intensity > 0.01 {
        light::ember(
            d,
            960.0,
            540.0,
            intensity,
            t,
            90.0 + 900.0 * hit(t, land, 7.0) * if t >= land { 1.0 } else { 0.0 },
            p,
        );
    }
    grain::draw(d, t, a.grain);
    Ok(())
}
