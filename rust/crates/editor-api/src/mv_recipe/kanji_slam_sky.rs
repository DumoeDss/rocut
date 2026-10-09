use super::{
    clock::Clock,
    draw::*,
    math::*,
    model::{KanjiSlam, Sky},
    palette::*,
    plan::*,
    raster::*,
    state::State,
};
use crate::mv_image_dimensions::Context;
pub(super) fn draw(
    d: &mut Draw,
    a: &KanjiSlam,
    c: &Clock,
    s: &State,
    images: &Context,
) -> Result<(), String> {
    d.operations = s.camera(0.35);
    if let Some(id) = &a.bg {
        let image_size = images.image(id)?;
        let iw = image_size.width as f64;
        let ih = image_size.height as f64;
        let scale = (1920.0 / iw).max(1080.0 / ih) * (1.12 + 0.02 * c.hit as f64);
        let w = iw * scale;
        let h = ih * scale;
        d.operations.push(Operation::Translate {
            offset: [
                960.0 + (-0.3 + 0.1 * (c.hit % 3) as f64) * ((w - 1920.0) / 2.0).max(0.0),
                540.0 + (if a.night() { -0.2 } else { 0.35 }) * ((h - 1080.0) / 2.0).max(0.0),
            ],
        });
        image(d, id, None, [-w / 2.0, -h / 2.0, w, h], "high");
        d.operations.pop();
    } else if a.sky == Sky::Day {
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    a.sky_grad
                        .as_ref()
                        .ok_or("Explicit day sky gradient missing")?,
                ),
                "source-over",
            ),
        );
    } else {
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.0, rgb(0x1a0e2a)),
                        (0.6, rgb(0x5a1a3a)),
                        (1.0, rgb(0xe0603a)),
                    ],
                ),
                "source-over",
            ),
        );
    }
    if a.night() {
        // D.fill resets CTM, but subsequent vgrad/stars retain the camera.
        d.operations.clear();
        d.rect(FRAME, fill(solid(rgb(0x0e2346)), "color"));
        d.operations = s.camera(0.35);
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.0, rgba(rgb(0x030610), 0.92)),
                        (0.55, rgba(rgb(0x081028), 0.55)),
                        (1.0, rgba(rgb(0x281432), 0.25)),
                    ],
                ),
                "multiply",
            ),
        );
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.55, rgba(rgb(0xc8373a), 0.0)),
                        (1.0, rgba(rgb(0xc8373a), 0.35)),
                    ],
                ),
                "lighter",
            ),
        );
        let tq = quant(c.time, 12.0);
        for i in 0..90 {
            let i = i as f64;
            let x = rnd(i, 71.0) * 1920.0;
            let y = rnd(i, 72.0) * 1080.0 * 0.6;
            let alpha = 0.25 + 0.75 * (tq * (1.0 + rnd(i, 73.0) * 3.0) + i).sin().abs();
            let r = 0.7 + 1.6 * rnd(i, 75.0);
            d.rect(
                [x - r / 2.0, y - r / 2.0, r, r],
                opacity(
                    fill(solid(rgb(0xe8f0ff)), "source-over"),
                    alpha * (0.4 + 0.6 * rnd(i, 74.0)),
                ),
            );
        }
    } else if a.fire {
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.0, rgba(rgb(0x0a0308), 0.9)),
                        (0.5, rgba(rgb(0x28060c), 0.6)),
                        (1.0, rgba(rgb(0x5a140a), 0.2)),
                    ],
                ),
                "multiply",
            ),
        );
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.45, rgba(rgb(0xc8373a), 0.0)),
                        (1.0, rgba(rgb(0xf05a28), 0.5)),
                    ],
                ),
                "screen",
            ),
        );
    } else if a.sky != Sky::Day {
        d.rect(
            FRAME,
            fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 1080.0],
                    &[
                        (0.0, rgba(INK, 0.6)),
                        (0.45, rgba(rgb(0x3a1745), 0.2)),
                        (1.0, [0.0; 4]),
                    ],
                ),
                "multiply",
            ),
        );
        glow(d, 1920.0 * 0.74, 1080.0 * 0.92, 760.0, rgb(0xffb070), 0.32);
    }
    d.operations.clear();
    Ok(())
}
