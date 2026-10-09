use super::{clock::Clock, draw::*, math::*, model::Fall, plan::*, raster::*};
pub(super) const COVER: [f64; 4] = [-2400.0, -2400.0, 6720.0, 5880.0];
pub(super) fn prepare(out: &mut Vec<Command>, a: &Fall, c: &Clock) {
    let [x, y] = a.vp;
    let mut d = Draw::new(480.0, 270.0);
    d.operations = c.camera();
    d.operations.push(Operation::CopyTransform);
    let shade = linear(
        [x, y],
        [x, y + 1050.0],
        &[
            (0.0, rgb(255, 176, 112, 0.2 + 0.3 * c.pulse)),
            (0.35, rgb(138, 106, 128, 0.08 + 0.07 * c.pulse)),
            (1.0, rgb(60, 70, 100, 0.0)),
        ],
    );
    d.path(
        vec![
            Step::MoveTo {
                point: [x - 12.0, y],
            },
            Step::LineTo {
                point: [x + 12.0, y],
            },
            Step::LineTo {
                point: [x + 380.0, y + 1100.0],
            },
            Step::LineTo {
                point: [x - 380.0, y + 1100.0],
            },
            Step::Close,
        ],
        vec![fill(shade, "source-over")],
    );
    surface(out, "fa-cone-a", [480, 270], d);
    let mut d = Draw::new(1920.0, 1080.0);
    all(
        &mut d,
        "fa-cone-a",
        [480, 270],
        [0.0, 0.0, 480.0, 270.0],
        "source-over",
        1.0,
        10.0,
    );
    surface(out, "fa-cone", [480, 270], d);
    release(out, "fa-cone-a");
}
pub(super) fn draw(d: &mut Draw, a: &Fall, c: &Clock) {
    let [x, y] = a.vp;
    d.operations = c.camera();
    d.rect(COVER, fill(solid(rgb(3, 7, 13, 1.0)), "source-over"));
    d.rect(
        COVER,
        fill(
            radial(
                x,
                y,
                1400.0,
                &[
                    (0.0, rgb(26, 58, 86, 1.0)),
                    (0.2, rgb(13, 33, 53, 1.0)),
                    (0.55, rgb(6, 18, 32, 1.0)),
                    (1.0, rgb(3, 7, 13, 0.0)),
                ],
            ),
            "source-over",
        ),
    );
    d.operations.clear();
    all(d, "fa-cone", [480, 270], FRAME, "lighter", 1.0, 0.0);
    d.operations = c.camera();
    let square = lerp(22.0, 14.0, c.progress) * (1.0 + 0.9 * c.pulse) * (1.0 + 0.08 * c.beat);
    glow(
        d,
        x,
        y,
        420.0 + 380.0 * c.pulse,
        rgb(240, 102, 58, 1.0),
        0.1 + 0.22 * c.pulse,
    );
    glow(
        d,
        x,
        y,
        80.0 + 150.0 * c.pulse,
        rgb(255, 165, 82, 1.0),
        0.55 + 0.4 * c.pulse,
    );
    d.rect(
        [
            x - square / 2.0 - 1.5,
            y - square / 2.0 - 1.5,
            square + 3.0,
            square + 3.0,
        ],
        fill(solid(rgb(255, 227, 176, 0.9)), "lighter"),
    );
    d.rect(
        [x - square / 2.0, y - square / 2.0, square, square],
        fill(solid(rgb(255, 251, 240, 1.0)), "lighter"),
    );
    for pt in &c.pulses {
        for (lag, amp) in [(0.0, 1.0), (0.12, 0.5)] {
            let k = inv(pt + lag, pt + lag + 1.1, c.time);
            if k <= 0.0 || k >= 1.0 {
                continue;
            }
            let r = 14.0 + 900.0 * (1.0 - (1.0 - k).powi(3));
            d.rect(
                [x - r, y - r, 2.0 * r, 2.0 * r],
                stroke(
                    solid(rgb(255, 227, 176, amp * 0.6 * (1.0 - k).powf(1.6))),
                    1.0 + 3.5 * (1.0 - k),
                    "butt",
                    "miter",
                ),
            );
        }
    }
}
