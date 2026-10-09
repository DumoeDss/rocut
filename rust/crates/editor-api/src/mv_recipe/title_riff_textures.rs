use super::{draw::*, ease::jsround, math::*, palette::Palette, plan::*, raster::*};
use crate::mv_recipe::model::Color;

pub(super) fn paper(out: &mut Vec<Command>) {
    let mut rng = Rng::new(77.0);
    let gray = (0..240 * 135)
        .map(|_| (118.0 + (rng.next() - 0.5) * 70.0).round_ties_even() as u8)
        .collect();
    let mut raw = Draw::new(1920.0, 1080.0);
    raw.commands.push(Command::GrayPixels {
        size: [240, 135],
        gray,
        position: [0, 0],
    });
    surface(out, "title-paper-pixels", [240, 135], raw);
    let mut texture = Draw::new(1920.0, 1080.0);
    blit(
        &mut texture,
        "title-paper-pixels",
        [240, 135],
        FRAME,
        "source-over",
        1.0,
        2.0,
        "low",
    );
    surface(out, "title-paper", [1920, 1080], texture);
    release(out, "title-paper-pixels");
}
pub(super) fn halftone(out: &mut Vec<Command>, id: &'static str, color: Color, step: f64) -> usize {
    let mut d = Draw::new(1920.0, 1080.0);
    let mut circles = Vec::new();
    let angle = 0.26f64;
    let ca = angle.cos();
    let sa = angle.sin();
    let radius = 1920.0f64.hypot(1080.0) / 2.0 + step;
    let mut v = -radius;
    while v <= radius {
        let mut u = -radius;
        while u <= radius {
            let x = 960.0 + u * ca - v * sa;
            let y = 540.0 + u * sa + v * ca;
            if x >= -step && x <= 1920.0 + step && y >= -step && y <= 1080.0 + step {
                let random =
                    f64::from(hash(&[jsround(u), jsround(v), 5.0])) / 4294967296.0 * 2.0 - 1.0;
                let f = clamp(
                    0.1 + 0.9 * (y / 1080.0) * 0.8 + 0.2 * (1.0 - x / 1920.0) + 0.08 * random,
                );
                let r = step * 0.52 * f.powf(1.4);
                if r > 0.4 {
                    circles.push([x, y, r]);
                }
            }
            u += step;
        }
        v += step;
    }
    let count = circles.len() * 2;
    d.commands.push(Command::CircleBatch {
        transform: IDENTITY,
        operations: Vec::new(),
        clip: None,
        circles,
        paints: vec![fill(solid(color), "source-over")],
    });
    surface(out, id, [1920, 1080], d);
    count
}
pub(super) fn background(
    out: &mut Vec<Command>,
    p: &Palette,
    outro: bool,
    x: f64,
    y: f64,
    r: f64,
    pulse: f64,
) {
    let mut d = Draw::new(1920.0, 1080.0);
    let colors = if outro {
        [
            (0.0, p.void),
            (0.55, p.ink),
            (1.0, super::palette::rgb(0x2a1f4a)),
        ]
    } else {
        [
            (0.0, super::palette::rgb(0x0b0612)),
            (0.6, p.ink),
            (1.0, super::palette::rgb(0x1c0d22)),
        ]
    };
    d.rect(
        FRAME,
        fill(linear([0.0, 0.0], [0.0, 1080.0], &colors), "source-over"),
    );
    d.rect(
        FRAME,
        fill(
            radial_between(
                [x, y, r * 0.5],
                [x, y, r * 4.2],
                &[
                    (
                        0.0,
                        rgba(if outro { p.sunset } else { p.verm }, 0.26 + 0.08 * pulse),
                    ),
                    (0.35, rgba(p.dusk, 0.12)),
                    (1.0, rgba(p.dusk, 0.0)),
                ],
            ),
            "source-over",
        ),
    );
    blit(
        &mut d,
        "title-paper",
        [1920, 1080],
        FRAME,
        "soft-light",
        if outro { 0.3 } else { 0.45 },
        0.0,
        "low",
    );
    surface(out, "title-background", [1920, 1080], d);
    release(out, "title-paper");
}
