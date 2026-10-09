use super::{clock::Clock, draw::*, math::*, model::Thread, plan::*, raster::*, state::State};

pub(super) fn main(d: &mut Draw, a: &Thread, c: &Clock, s: &State, end: [f64; 2]) {
    let [lx, ly] = a.light;
    for i in 0..18 {
        let i = i as f64;
        let k = fract(c.time * (0.35 + 0.25 * rnd(i, 401.0)) + rnd(i, 402.0));
        let x =
            lerp(end[0], lx, k * 0.55) + rnds(i, 403.0) * 80.0 * k + (c.time * 2.0 + i).sin() * 8.0;
        let y = lerp(end[1], ly, k * 0.55) + rnds(i, 404.0) * 60.0 * k;
        let alpha = (std::f64::consts::PI * k).sin() * (0.35 + 0.65 * s.arrival) * 0.85;
        let r = 1.1 + 1.5 * rnd(i, 405.0);
        d.glow(
            x,
            y,
            r * 3.0,
            &[
                (0.0, rgb(255, 195, 154, alpha)),
                (1.0, rgb(255, 120, 80, 0.0)),
            ],
            "lighter",
        );
    }
    let lp = s.light_pulse;
    let cr = 2.4 + 2.6 * lp;
    d.glow(
        lx,
        ly,
        cr * 6.0,
        &[
            (0.0, rgb(255, 251, 240, 1.0)),
            (0.18, rgb(255, 227, 176, 0.9)),
            (1.0, rgb(255, 165, 82, 0.0)),
        ],
        "lighter",
    );
    let sw = 160.0 + 340.0 * lp;
    let gradient = linear(
        [lx - sw, 0.0],
        [lx + sw, 0.0],
        &[
            (0.0, rgb(255, 150, 110, 0.0)),
            (0.5, rgb(255, 210, 176, (0.3 * lp).clamp(0.0, 0.6))),
            (1.0, rgb(255, 150, 110, 0.0)),
        ],
    );
    d.rect(
        [lx - sw, ly - 1.1, 2.0 * sw, 2.2],
        fill(gradient, "lighter"),
    );
    let vh = 40.0 + 90.0 * lp;
    let gradient = linear(
        [0.0, ly - vh],
        [0.0, ly + vh],
        &[
            (0.0, rgb(255, 200, 160, 0.0)),
            (0.5, rgb(255, 227, 176, (0.22 * lp).clamp(0.0, 0.5))),
            (1.0, rgb(255, 200, 160, 0.0)),
        ],
    );
    d.rect(
        [lx - 0.8, ly - vh, 1.6, 2.0 * vh],
        fill(gradient, "lighter"),
    );
}
pub(super) fn foreground(d: &mut Draw, c: &Clock, s: &State) {
    d.operations = s.camera(1.5);
    for i in 0..5 {
        let i = i as f64;
        let x = lerp(-100.0, 2020.0, rnd(i, 501.0)) + c.time * (6.0 + 8.0 * rnd(i, 502.0));
        let y = lerp(80.0, 1020.0, rnd(i, 503.0)) - c.time * 5.0;
        let r = 50.0 + 70.0 * rnd(i, 504.0);
        let alpha = 0.035 + 0.03 * rnd(i, 505.0);
        let style = Style::Radial {
            from: [x, y, r * 0.6],
            to: [x, y, r],
            stops: stops(&[
                (0.0, rgb(176, 112, 192, alpha)),
                (0.92, rgb(200, 138, 208, alpha * 1.4)),
                (1.0, rgb(200, 138, 208, 0.0)),
            ]),
        };
        d.path(circle(x, y, r), vec![fill(style, "lighter")]);
    }
    d.operations.clear();
    d.rect(
        FRAME,
        fill(
            Style::Radial {
                from: [960.0, 540.0, 1080.0 * 0.32],
                to: [960.0, 540.0, 1080.0 * 1.05],
                stops: stops(&[(0.0, rgb(5, 2, 9, 0.0)), (1.0, rgb(5, 2, 9, 0.6))]),
            },
            "source-over",
        ),
    );
}
