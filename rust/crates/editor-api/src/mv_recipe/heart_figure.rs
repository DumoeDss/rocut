//! Original glass.js integer-row wind warp, shading, local light and directional rim.
use super::{
    draw::*,
    plan::{native, Command, HeartCommand, Operation},
};
pub struct Image<'a> {
    pub id: &'a str,
    pub width: u32,
    pub height: u32,
}
pub struct Wave {
    pub amp: f64,
    pub from: f64,
    pub speed: f64,
}
pub struct Light {
    pub position: [f64; 2],
    pub radius: f64,
    pub alpha: f64,
}
pub struct Rim {
    pub color: Color,
    pub offsets: Vec<[f64; 2]>,
    pub alpha: f64,
}
pub struct Figure {
    pub position: [f64; 2],
    pub height: f64,
    pub time: f64,
    pub breathe: f64,
    pub wave: Wave,
    pub shade: Option<(Color, f64)>,
    pub silhouette: Option<(Color, f64)>,
    pub light: Option<Light>,
    pub rim: Rim,
}
fn surface(d: &mut Draw, id: &'static str, size: [u32; 2], commands: Vec<Command>) {
    d.commands
        .push(Command::Heart(HeartCommand::Surface { id, size, commands }));
}
fn copy(d: &mut Draw, size: [u32; 2], offset: [f64; 2], composite: &'static str, alpha: f64) {
    d.blit(
        "heart-fig-a",
        size,
        [offset[0], offset[1], size[0] as f64, size[1] as f64],
        alpha,
        composite,
    );
}
pub fn draw(d: &mut Draw, image: &Image<'_>, o: &Figure) -> Result<(), String> {
    if image.width == 0
        || image.height == 0
        || ![o.height, o.time, o.position[0], o.position[1], o.wave.amp]
            .iter()
            .all(|x| x.is_finite())
        || o.height <= 0.0
    {
        return Err("Invalid Heart character dimensions or clock".into());
    }
    let br = 1.0 + o.breathe * 0.012 * (o.time * 2.1).sin();
    let w = image.width as f64 * o.height / image.height as f64;
    let hh = (o.height * br).round();
    let pad = 14.0 + o.wave.amp.ceil();
    let x0 = (o.position[0] - w / 2.0 - pad).floor();
    let y0 = (o.position[1] - hh - pad).floor();
    let cw = (w + 2.0 * pad).ceil() + 2.0;
    let ch = hh + 2.0 * pad + 2.0;
    if cw < 1.0
        || ch < 1.0
        || cw > 16384.0
        || ch > 16384.0
        || cw * ch * 40.0 > 256.0 * 1024.0 * 1024.0
    {
        return Err("Heart character scratch residency exceeds ceiling".into());
    }
    let size = [cw as u32, ch as u32];
    let dx = o.position[0] - w / 2.0 - x0;
    let dy = (o.position[1] - hh - y0).trunc();
    let mut a = Draw::new();
    let rows = hh.max(1.0) as u32;
    let band = (hh / 90.0).round().max(2.0) as u32;
    let tt = (o.time * 12.0 + 1e-6).floor() / 12.0;
    for r in (0..rows).step_by(band as usize) {
        let r1 = rows.min(r + band);
        let v = r as f64 / rows as f64;
        let k = ((v - o.wave.from) / (1.0 - o.wave.from)).clamp(0.0, 1.0);
        let off = o.wave.amp * k * k * (v * 2.2 * std::f64::consts::TAU - tt * o.wave.speed).sin()
            + o.wave.amp * 0.35 * k * (tt * 1.7 + v * 3.0).sin();
        a.commands.push(Command::Native(native::Command::Image {
            image: image.id.into(),
            source_rect: Some([
                0.0,
                v * image.height as f64,
                image.width as f64,
                (r1 - r) as f64 / rows as f64 * image.height as f64,
            ]),
            destination_rect: [dx + off, dy + r as f64, w, (r1 - r) as f64],
            transform: ID,
            operations: Vec::new(),
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "low",
        }));
    }
    surface(d, "heart-fig-a", size, a.commands);
    let mut b = Draw::new();
    copy(&mut b, size, [0.0, 0.0], "source-over", 1.0);
    if let Some((color, detail)) = o.silhouette {
        b.rect([0.0, 0.0, cw, ch], fill(solid(color), "source-in"));
        if detail != 0.0 {
            copy(&mut b, size, [0.0, 0.0], "source-atop", detail);
        }
    } else if let Some((color, alpha)) = o.shade {
        let mut paint = fill(solid(color), "multiply");
        paint.opacity = alpha;
        b.rect([0.0, 0.0, cw, ch], paint);
        copy(&mut b, size, [0.0, 0.0], "destination-in", 1.0);
    }
    surface(d, "heart-fig-b", size, b.commands);
    d.blit("heart-fig-b", size, [x0, y0, cw, ch], 1.0, "source-over");
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-fig-b",
        }));
    if let Some(light) = o.light.as_ref().filter(|l| l.alpha > 0.01) {
        let mut l = Draw::new();
        copy(&mut l, size, [0.0, 0.0], "source-over", 1.0);
        let a = light.alpha.min(1.0);
        l.rect(
            [0.0, 0.0, cw, ch],
            fill(
                radial(
                    light.position[0] - x0,
                    light.position[1] - y0,
                    light.radius,
                    &[
                        (0.0, [0.0, 0.0, 0.0, a]),
                        (0.45, [0.0, 0.0, 0.0, a * 0.45]),
                        (1.0, [0.0; 4]),
                    ],
                ),
                "destination-in",
            ),
        );
        surface(d, "heart-fig-light", size, l.commands);
        d.blit(
            "heart-fig-light",
            size,
            [x0, y0, cw, ch],
            1.0,
            "source-over",
        );
        d.commands
            .push(Command::Native(native::Command::ReleaseSurface {
                surface: "heart-fig-light",
            }));
    }
    if o.rim.alpha > 0.01 {
        let mut r = Draw::new();
        for offset in &o.rim.offsets {
            copy(&mut r, size, *offset, "source-over", 1.0);
        }
        r.rect([0.0, 0.0, cw, ch], fill(solid(o.rim.color), "source-in"));
        copy(&mut r, size, [0.0, 0.0], "destination-out", 1.0);
        surface(d, "heart-fig-rim", size, r.commands);
        d.blit(
            "heart-fig-rim",
            size,
            [x0, y0, cw, ch],
            o.rim.alpha.min(1.0),
            "lighter",
        );
        d.commands
            .push(Command::Native(native::Command::ReleaseSurface {
                surface: "heart-fig-rim",
            }));
    }
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-fig-a",
        }));
    Ok(())
}
pub struct Pose {
    pub chest: [f64; 2],
    pub hand: [f64; 2],
    pub floor: Vec<[f64; 2]>,
}
pub fn pose(path: &str, width: u32, height: u32) -> Pose {
    match path {
        "assets/char/kneel_pick.png" => Pose {
            chest: [515.0, 512.0],
            hand: [283.0, 1170.0],
            floor: vec![
                [136.0, 1090.0],
                [80.0, 1102.0],
                [123.0, 1151.0],
                [87.0, 1170.0],
                [360.0, 1150.0],
                [304.0, 1184.0],
                [488.0, 1214.0],
                [225.0, 1264.0],
                [357.0, 1267.0],
                [760.0, 1170.0],
            ],
        },
        "assets/char/alt/kneel_pick.png" => Pose {
            chest: [405.0, 580.0],
            hand: [406.0, 1188.0],
            floor: vec![
                [521.0, 1190.0],
                [619.0, 1214.0],
                [272.0, 1237.0],
                [461.0, 1257.0],
                [519.0, 1280.0],
                [365.0, 1284.0],
            ],
        },
        _ => Pose {
            chest: [width as f64 * 0.5, height as f64 * 0.4],
            hand: [width as f64 * 0.35, height as f64 * 0.85],
            floor: Vec::new(),
        },
    }
}
