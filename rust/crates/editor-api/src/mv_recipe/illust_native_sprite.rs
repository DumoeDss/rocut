use super::{
    model::{Actor, range},
    plan::Command,
};
use crate::mv_recipe::{
    burst::{Character, Sprite, Strip},
    model::{Ease, Role, Span},
};
pub fn ease(p: f64, e: Option<Ease>) -> f64 {
    crate::mv_recipe::evaluate::progress(
        p,
        &Span {
            start_frame: 0,
            duration_frames: 1,
        },
        e.unwrap_or(Ease::InOutSine),
    )
}
pub fn valid(a: &Actor, r: &[crate::programmatic_resources::Resource]) -> bool {
    let c = &a.sprite;
    r.iter().any(|r| r.id == c.image && r.kind == "image")
        && [c.x, c.y]
            .into_iter()
            .flatten()
            .all(|v| range(v, -8192.0, 8192.0))
        && c.h.is_none_or(|v| range(v, 1.0, 8192.0))
        && c.anchor
            .is_none_or(|v| v.iter().all(|v| range(*v, 0.0, 1.0)))
        && c.alpha.is_none_or(|v| range(v, 0.0, 1.0))
        && [c.rot, c.sway, c.breathe, c.phase]
            .into_iter()
            .flatten()
            .all(|v| range(v, -100.0, 100.0))
        && c.wave.as_ref().is_none_or(|w| {
            range(w.amp, 0.0, 256.0)
                && range(w.from, 0.0, 0.99)
                && range(w.freq, 0.0, 16.0)
                && range(w.speed, 0.0, 100.0)
                && (1..=120).contains(&w.drawing_fps)
        })
}
pub fn base(
    c: &Character,
    x: f64,
    y: f64,
    h: f64,
    t: f64,
    opacity: f64,
    img: crate::mv_image_dimensions::Dimensions,
) -> Sprite {
    let w = h * img.width as f64 / img.height as f64;
    let anchor = c.anchor.unwrap_or([0.5, 1.0]);
    let x0 = -w * anchor[0];
    let y0 = -h * anchor[1];
    let phase = c.phase.unwrap_or(0.0);
    let rot = c.rot.unwrap_or(0.0) + c.sway.unwrap_or(0.012) * (t * 1.3 + phase).sin();
    let (sn, co) = rot.sin_cos();
    let br = 1.0 + c.breathe.unwrap_or(1.0) * 0.012 * (t * 2.1 + phase).sin();
    let flip = if c.flip { -1.0 } else { 1.0 };
    let mut strips = Vec::new();
    if c.disable_wave || c.wave.as_ref().is_some_and(|w| w.amp == 0.0) {
        strips.push(Strip {
            source: [0.0, 0.0, img.width as f64, img.height as f64],
            destination: [x0, y0, w, h],
        });
    } else {
        let wave = c.wave.clone().unwrap_or(crate::mv_recipe::burst::Wave {
            amp: 10.0,
            from: 0.3,
            freq: 2.2,
            speed: 3.2,
            drawing_fps: 12,
        });
        let tt = (t * wave.drawing_fps as f64 + 1e-6).floor() / wave.drawing_fps as f64;
        for i in 0..90 {
            let v = i as f64 / 90.0;
            let v1 = (i + 1) as f64 / 90.0;
            let k = ((v - wave.from) / (1.0 - wave.from)).clamp(0.0, 1.0);
            let dx =
                wave.amp * k * k * (v * wave.freq * std::f64::consts::TAU - tt * wave.speed).sin()
                    + wave.amp * 0.35 * k * (tt * 1.7 + v * 3.0).sin();
            strips.push(Strip {
                source: [
                    0.0,
                    v * img.height as f64,
                    img.width as f64,
                    (v1 - v) * img.height as f64 + 1.0,
                ],
                destination: [x0 + dx, y0 + v * h, w, (v1 - v) * h + 1.0],
            });
        }
    }
    Sprite {
        image: c.image.clone(),
        transform: [co * flip, sn * flip, -sn * br, co * br, x, y],
        strips,
        opacity,
        rim: None,
        rim_offset: [0.0, 0.0],
        rim_opacity: 0.0,
    }
}
pub fn actor(
    a: &Actor,
    t: f64,
    t0: f64,
    t1: f64,
    pulse: f64,
    img: crate::mv_image_dimensions::Dimensions,
) -> Vec<Command> {
    let tq = a
        .drawing_fps
        .filter(|q| *q > 0)
        .map_or(t, |q| (t * q as f64 + 1e-6).floor() / q as f64);
    let lt = tq - t0;
    let k = ease((lt / (t1 - t0)).clamp(0.0, 1.0), a.easing);
    let c = &a.sprite;
    let from = [
        c.x.unwrap_or(960.0),
        c.y.unwrap_or(1110.0),
        c.h.unwrap_or(1080.0),
    ];
    let to = a.to.unwrap_or(from);
    let mut x = from[0] + (to[0] - from[0]) * k;
    let mut y = from[1] + (to[1] - from[1]) * k;
    let mut h = from[2] + (to[2] - from[2]) * k;
    let mut alpha = c.alpha.unwrap_or(1.0);
    let mut rotation = c.rot.unwrap_or(0.0);
    if let Some(e) = &a.entrance {
        let d = ((lt - e.at.unwrap_or(0.0)) / e.duration.unwrap_or(0.5)).clamp(0.0, 1.0);
        let v = ease(d, Some(e.easing.unwrap_or(Ease::OutExpo)));
        x += e.dx.unwrap_or(0.0) * (1.0 - v);
        y += e.dy.unwrap_or(0.0) * (1.0 - v);
        h *= 1.0 + e.ds.unwrap_or(0.0) * (1.0 - v);
        rotation += e.rotation.unwrap_or(0.0) * (1.0 - v);
        if e.alpha.unwrap_or(true) {
            alpha *= if d > 0.0 { (v * 1.4).min(1.0) } else { 0.0 };
        }
    }
    if let Some(e) = &a.exit {
        let d = ((lt - e.at.unwrap_or(0.0)) / e.duration.unwrap_or(0.4)).clamp(0.0, 1.0);
        let v = ease(d, Some(e.easing.unwrap_or(Ease::InExpo)));
        x += e.dx.unwrap_or(0.0) * v;
        y += e.dy.unwrap_or(0.0) * v;
        h *= 1.0 + e.ds.unwrap_or(0.0) * v;
        if e.alpha.unwrap_or(true) {
            alpha *= 1.0 - v;
        }
    }
    if alpha <= 0.001 {
        return Vec::new();
    }
    h *= 1.0 + a.beat_bump.unwrap_or(0.0) * pulse;
    let mut c = c.clone();
    c.rot = Some(rotation);
    let role = a.role.unwrap_or(Role::Subject);
    let mut out = Vec::new();
    if let Some(u) = &a.shadow {
        let opacity = alpha * u.amount.unwrap_or(0.5);
        out.push(Command::Sprite {
            role,
            sprite: base(&c, x, y, h, tq, opacity, img),
            tint: Some(
                u.color
                    .unwrap_or([20.0 / 255.0, 11.0 / 255.0, 30.0 / 255.0, 1.0]),
            ),
            offset: u.offset.unwrap_or([30.0, 0.0]),
            blur_px: 0.0,
            composite: "source-over",
        });
    }
    if let Some(u) = &a.rim {
        out.push(Command::Sprite {
            role,
            sprite: base(&c, x, y, h, tq, alpha * u.amount.unwrap_or(1.0), img),
            tint: Some(u.color.unwrap_or([1.0, 165.0 / 255.0, 82.0 / 255.0, 1.0])),
            offset: u.offset.unwrap_or([7.0, -3.0]),
            blur_px: 3.0,
            composite: "lighter",
        });
    }
    out.push(Command::Sprite {
        role,
        sprite: base(&c, x, y, h, tq, alpha, img),
        tint: a.silhouette,
        offset: [0.0, 0.0],
        blur_px: 0.0,
        composite: "source-over",
    });
    if let Some(g) = a.glow_at {
        let mut native = Vec::new();
        crate::mv_recipe::burst::graphics::glow(
            &mut native,
            [x + g[0] * h, y - g[1] * h],
            g[2] * h,
            a.glow_color
                .unwrap_or([1.0, 165.0 / 255.0, 82.0 / 255.0, 1.0]),
            a.glow_amount.unwrap_or(0.9),
        );
        out.extend(
            native
                .into_iter()
                .map(|command| Command::Native { role, command }),
        );
    }
    out
}
