use super::{
    fx,
    model::*,
    plan::{self, Command},
    sprite,
};
use crate::mv_recipe::{
    burst::{Character, graphics::*, native},
    converge::Stop,
    ember::Sample,
    model::Role,
};
fn view(v: Option<&crate::mv_recipe::burst::View>, d: [f64; 4]) -> [f64; 4] {
    v.map_or(d, |v| {
        [
            v.zoom.unwrap_or(d[0]),
            v.x.unwrap_or(d[1]),
            v.y.unwrap_or(d[2]),
            v.rot.unwrap_or(d[3]),
        ]
    })
}
pub(in crate::mv_recipe) fn plan(
    a: &Args,
    bpm: f64,
    s: &Sample<'_>,
    resources: &[crate::programmatic_resources::Resource],
) -> Result<plan::Plan, String> {
    if !super::valid(a, resources)
        || !bpm.is_finite()
        || !(1.0..=1000.0).contains(&bpm)
        || s.width != 1920.0
        || s.height != 1080.0
    {
        return Err("IllustNative requires valid author/BPM/exact1920x1080".into());
    }
    let data = crate::mv_recipe::heart_recipe::runtime_ready(
        s.analysis,
        s.shot_start_ticks,
        s.shot_end_ticks,
    )?;
    if s.song_ticks < s.shot_start_ticks || s.song_ticks > s.shot_end_ticks {
        return Err("IllustNative mapped song clock outside shot".into());
    }
    let t = s.song_ticks as f64 / 120000.0;
    let t0 = s.shot_start_ticks as f64 / 120000.0;
    let t1 = s.shot_end_ticks as f64 / 120000.0;
    let p = ((t - t0) / (t1 - t0)).clamp(0.0, 1.0);
    let beat = data.beats.partition_point(|b| *b <= s.song_ticks);
    let pulse = if beat == 0 {
        0.0
    } else {
        (-8.0 * (t - data.beats[beat - 1] as f64 / 120000.0)).exp()
    };
    let pulse10 = if beat == 0 {
        0.0
    } else {
        (-10.0 * (t - data.beats[beat - 1] as f64 / 120000.0)).exp()
    };
    let images = s.images;
    let mut commands = Vec::new();
    let mut back = Vec::new();
    if let Some(id) = &a.bg {
        let img = images
            .ok_or("IllustNative missing background dimensions")?
            .image(id)?;
        let k = sprite::ease(p, a.bg_ease);
        let from = view(a.bg_from.as_ref(), [1.06, 0.0, 0.0, 0.0]);
        let to = view(
            a.bg_to.as_ref(),
            a.bg_from.as_ref().map_or([1.12, 0.0, 0.0, 0.0], |_| from),
        );
        let mut v = [0.0; 4];
        for i in 0..4 {
            v[i] = from[i] + (to[i] - from[i]) * k;
        }
        v[0] *= 1.0 + a.beat_zoom.unwrap_or(0.0) * pulse;
        if let Some(shake) = a.shake {
            let q = (t * 24.0).floor();
            v[1] += crate::mv_recipe::burst::math::rnds(q, 1.0) * shake / 400.0;
            v[2] += crate::mv_recipe::burst::math::rnds(q, 8.0) * shake / 300.0;
        }
        let scale = (1920.0 / img.width as f64).max(1080.0 / img.height as f64) * v[0];
        let dw = img.width as f64 * scale;
        let dh = img.height as f64 * scale;
        let (sn, co) = v[3].sin_cos();
        back.push(native::Command::Image {
            image: id.clone(),
            source_rect: None,
            destination_rect: [-dw / 2.0, -dh / 2.0, dw, dh],
            transform: [
                co,
                sn,
                -sn,
                co,
                960.0 + v[1] * ((dw - 1920.0) / 2.0).max(0.0),
                540.0 + v[2] * ((dh - 1080.0) / 2.0).max(0.0),
            ],
            operations: Vec::new(),
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "high",
        });
    } else if let Some(g) = &a.grad {
        back.push(fx::gradient(g));
    } else {
        fill(
            &mut back,
            a.color.unwrap_or(c(20.0, 11.0, 30.0, 1.0)),
            "source-over",
        );
    }
    for tint in &a.tint {
        fill(
            &mut back,
            alpha(tint.color, tint.amount),
            crate::mv_recipe::burst::graphics::composite(&tint.composite),
        );
    }
    if let Some(g) = &a.overlay_grad {
        back.push(fx::gradient(g));
    }
    commands.extend(back.into_iter().map(|command| Command::Native {
        role: Role::Background,
        command,
    }));
    for l in &a.layers {
        let img = images
            .ok_or("IllustNative missing layer dimensions")?
            .image(&l.image)?;
        let k = sprite::ease(p, l.easing);
        let to = l.to.unwrap_or(l.from);
        let xyz: [f64; 3] = std::array::from_fn(|i| l.from[i] + (to[i] - l.from[i]) * k);
        let ch = Character {
            image: l.image.clone(),
            x: None,
            y: None,
            h: None,
            flip: false,
            anchor: Some(l.anchor.unwrap_or([0.5, 0.5])),
            rot: l.rotation,
            sway: Some(0.0),
            breathe: Some(0.0),
            phase: None,
            alpha: None,
            wave: None,
            disable_wave: true,
        };
        commands.push(Command::Sprite {
            role: l.role.unwrap_or(Role::Background),
            sprite: sprite::base(&ch, xyz[0], xyz[1], xyz[2], t, l.alpha.unwrap_or(1.0), img),
            tint: None,
            offset: [0.0, 0.0],
            blur_px: 0.0,
            composite: "source-over",
        });
    }
    for f in &a.fx_back {
        commands.extend(fx::produce(f, t, t - t0, pulse10, Role::Background));
    }
    for actor in &a.chars {
        let img = images
            .ok_or("IllustNative missing character dimensions")?
            .image(&actor.sprite.image)?;
        commands.extend(sprite::actor(actor, t, t0, t1, pulse10, img));
    }
    for f in &a.fx {
        commands.extend(fx::produce(f, t, t - t0, pulse10, Role::Graphics));
    }
    if let Some(v) = a.vignette.filter(|v| *v > 0.0) {
        let mut vignette = Vec::new();
        radial(
            &mut vignette,
            [960.0, 540.0],
            324.0,
            1080.0,
            vec![
                Stop {
                    offset: 0.0,
                    color: c(0.0, 0.0, 0.0, 0.0),
                },
                Stop {
                    offset: 1.0,
                    color: c(8.0, 4.0, 14.0, v),
                },
            ],
        );
        commands.extend(vignette.into_iter().map(|command| Command::Native {
            role: Role::Graphics,
            command,
        }));
    }
    let result = plan::Plan {
        commands,
        allocation_bytes: super::scratch_pixels(a, images)?
            .checked_mul(4)
            .ok_or("IllustNative budget overflow")?,
    };
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len() as u64
        > super::plan_bytes_bound(a)
    {
        return Err("IllustNative frame exceeds transport ceiling".into());
    }
    Ok(result)
}
