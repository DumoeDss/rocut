use super::{draw::*, math::*, model::Fall, plan::*, raster::*};
pub(super) fn prepare(out: &mut Vec<Command>) {
    // Exact original 64x512 sprite: gradient fillRect directly under blur10.
    out.push(Command::Surface {
        id: "fa-streak",
        size: [64, 512],
        commands: vec![Command::FilteredRect {
            transform: I,
            operations: vec![],
            clip: None,
            rect: [22.0, 20.0, 20.0, 472.0],
            blur_px: 10.0,
            paint: fill(
                linear(
                    [0.0, 0.0],
                    [0.0, 512.0],
                    &[
                        (0.0, rgb(255, 255, 255, 0.0)),
                        (0.18, rgb(255, 255, 255, 1.0)),
                        (1.0, rgb(255, 255, 255, 0.0)),
                    ],
                ),
                "source-over",
            ),
        }],
    });
}
pub(super) fn draw(d: &mut Draw, a: &Fall, dist: f64, v: f64) {
    for i in 0..60 {
        let i = i as f64;
        let k = fract(rnd(i, 81.0) + dist * (0.9 + 0.8 * rnd(i, 82.0)));
        let x = lerp(-100.0, 2020.0, rnd(i, 83.0));
        let y = lerp(1160.0, -80.0, k);
        let len = 10.0 + 40.0 * v * rnd(i, 84.0);
        let alpha = 0.25 * rnd(i, 85.0) * smooth(0.0, 0.1, k) * (1.0 - smooth(0.85, 1.0, k));
        d.path(
            line([x, y], [x, y + len]),
            vec![stroke(
                solid(rgb(191, 216, 240, alpha)),
                1.0 + rnd(i, 86.0),
                "round",
                "miter",
            )],
        );
    }
    // Canvas ignores out-of-range globalAlpha assignments and retains the
    // preceding accepted value within this original save/restore scope.
    let mut inherited_alpha = 1.0;
    for i in 0..7 {
        let i = i as f64;
        let k = fract(rnd(i, 51.0) + dist * (0.55 + 0.35 * rnd(i, 52.0)));
        let x0 = lerp(120.0, 1800.0, rnd(i, 53.0));
        let x = lerp(x0, a.vp[0], 0.25 * k);
        let y = lerp(1780.0, -900.0, k);
        let scale = 1.6 + 2.2 * rnd(i, 54.0);
        let alpha = (0.07 + 0.1 * rnd(i, 55.0))
            * smooth(0.0, 0.15, k)
            * (1.0 - smooth(0.8, 1.0, k))
            * (0.6 + 0.5 * v);
        if (0.0..=1.0).contains(&alpha) {
            inherited_alpha = alpha;
        }
        all(
            d,
            "fa-streak",
            [64, 512],
            [
                x - 32.0 * scale,
                y,
                64.0 * scale,
                512.0 * scale * (0.8 + 0.5 * v),
            ],
            "lighter",
            inherited_alpha,
            0.0,
        );
    }
    d.operations.clear();
    d.rect(
        FRAME,
        fill(
            Style::Radial {
                from: [960.0, 540.0, 1080.0 * 0.3],
                to: [960.0, 540.0, 1080.0 * 1.05],
                stops: stops(&[(0.0, rgb(2, 5, 10, 0.0)), (1.0, rgb(2, 5, 10, 0.7))]),
            },
            "source-over",
        ),
    );
    // Fall's actual original body contains no grain call.
}
