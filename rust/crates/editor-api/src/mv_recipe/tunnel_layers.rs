use super::{
    clock::Clock,
    draw::*,
    geometry::Camera,
    math::*,
    model::{Metrics, Tunnel},
    plan::*,
};
pub(super) fn background(d: &mut Draw, c: &Clock, cam: &Camera, g: f64, rl: f64) {
    let [x, y] = cam.vp;
    let outer = (rl * 2.1).max(1350.0);
    let dark = css(mix(rgb(0x120c22), rgb(0x241634), g), 1.0);
    let items = [
        (0.0, css(rgb(0xfff8ec), 1.0)),
        (rl * 0.05 / outer, css(rgb(0xffebcb), 1.0)),
        (rl * 0.2 / outer, css(rgb(0xffcb92), 1.0)),
        (rl * 0.45 / outer, css(rgb(0xf79e84), 1.0)),
        (rl * 0.72 / outer, css(rgb(0xd97f95), 1.0)),
        (rl / outer, css(mix(rgb(0x5a3a78), rgb(0x8a5388), g), 1.0)),
        (
            rl * 1.45 / outer,
            css(mix(rgb(0x1a1030), rgb(0x43285a), g), 1.0),
        ),
        (rl * 2.1 / outer, dark),
        (1.0, dark),
    ];
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(radial(x, y, outer, &items), "source-over"),
    );
    if rl * 2.1 < 1350.0 {
        let style = Style::Radial {
            from: [x, y, rl * 2.1],
            to: [x, y, 1350.0],
            stops: stops(&[(0.0, [0.0; 4]), (1.0, css(rgb(0x07050d), 0.85))]),
        };
        d.rect([0.0, 0.0, 1920.0, 1080.0], fill(style, "source-over"));
    }
    d.glow(
        x,
        y,
        14.0 + 60.0 * g,
        &[
            (0.0, css(rgb(0xffffff), 0.9)),
            (0.25, css(rgb(0xffffff), 0.9 * 0.45)),
            (1.0, css(rgb(0xffffff), 0.0)),
        ],
        "lighter",
    );
    // D.rays parses its mixed rgba string through Z.hex (parseInt -> NaN -> 0).
    // Preserve the original black radial wedges, not the intended pink hue.
    for i in 0..26 {
        let n = i as f64;
        let t = c.lt * 3.0;
        let angle = n / 26.0 * TAU + rnds(n, 9.0) * 0.2 + t * 0.02;
        let width = 0.02 + 0.05 * rnd(n, 10.0);
        let alpha =
            (0.035 + 0.08 * g) * (0.3 + 0.7 * rnd(n, 11.0)) * (0.6 + 0.4 * (t * 0.8 + n).sin());
        d.path(
            vec![
                Step::MoveTo { point: [x, y] },
                arc(x, y, 1500.0, angle - width, angle + width, false),
                Step::Close,
            ],
            vec![fill(
                radial(
                    x,
                    y,
                    1500.0,
                    &[(0.0, [0.0, 0.0, 0.0, alpha]), (1.0, [0.0; 4])],
                ),
                "lighter",
            )],
        );
    }
}
pub(super) fn dust(d: &mut Draw, a: &Tunnel, c: &Clock, cam: &Camera, g: f64) {
    let s = travel(c.lt, c.dur, a.v0, a.v1);
    let v = if c.lt < c.dur {
        a.v0 + (a.v1 - a.v0) * (c.lt / c.dur).powi(2)
    } else {
        a.v1
    };
    let streak = 0.05 + v * 0.05;
    for i in 0..240 {
        let n = i as f64;
        let th = rnd(n, 31.0) * TAU;
        let r = 0.4 + 3.2 * rnd(n, 32.0).powf(0.7);
        let z = 0.22 + 0.1 + ((rnd(n, 33.0) * 20.0 - s) % 20.0 + 20.0) % 20.0;
        if z > 22.0 {
            continue;
        }
        let p = cam.project(th.cos() * r, th.sin() * r, z);
        let q = cam.project(th.cos() * r, th.sin() * r, z + streak);
        let alpha =
            (1.0 - smooth(4.0, 20.0, z)) * 0.65 * (0.4 + 0.6 * rnd(n, 34.0)) * (1.0 - 0.6 * g);
        if alpha < 0.02 {
            continue;
        }
        d.path(
            line([p[0], p[1]], [q[0], q[1]]),
            vec![stroke(
                solid(css(
                    mix(
                        rgb(if i % 5 != 0 { 0xb9a6f0 } else { 0xffa552 }),
                        rgb(0xffd2b0),
                        g,
                    ),
                    alpha,
                )),
                (0.8 + 5.0 / z).min(3.5),
                "round",
                "miter",
            )],
        );
    }
}
fn title_text(
    d: &mut Draw,
    text: String,
    font_stack: super::fonts::Stack,
    px: f64,
    tracking: f64,
    position: [f64; 2],
    alpha: f64,
) {
    d.commands.push(Command::StackText {
        font_stack,
        text,
        font_size: px,
        tracking,
        position,
        transform: d.identity(),
        operations: vec![],
        fill: TextFill::Color {
            color: css(rgb(0x2a1224), 1.0),
        },
        opacity: alpha,
        composite: "source-over",
        align: "center",
        baseline: "middle",
    });
}
pub(super) fn finish(d: &mut Draw, a: &Tunnel, c: &Clock, cam: &Camera, g: f64, metrics: &Metrics) {
    let [x, y] = cam.vp;
    let sw = 380.0 + 1900.0 * g;
    let h = 2.0 + 5.0 * g;
    let style = Style::Linear {
        from: [x - sw, 0.0],
        to: [x + sw, 0.0],
        stops: stops(&[
            (0.0, css(rgb(0xffbeaa), 0.0)),
            (0.5, css(rgb(0xffecd6), 0.28 + 0.3 * g)),
            (1.0, css(rgb(0xffbeaa), 0.0)),
        ]),
    };
    d.rect([x - sw, y - h / 2.0, sw * 2.0, h], fill(style, "lighter"));
    let wash = clamp((c.lt - (c.dur - 0.6)) / 0.6).powi(2);
    if wash > 0.0 {
        d.rect(
            [0.0, 0.0, 1920.0, 1080.0],
            fill(
                radial(
                    x,
                    y,
                    1400.0,
                    &[
                        (0.0, css(rgb(0xfff4e2), 0.4 * wash)),
                        (1.0, css(rgb(0xffceb4), 0.25 * wash)),
                    ],
                ),
                "source-over",
            ),
        );
    }
    let tk = clamp((c.lt - (c.dur - 1.75)) / 1.75);
    if tk > 0.0 {
        let sz = 44.0 + 236.0 * io(tk);
        title_text(
            d,
            a.words.last().unwrap().clone(),
            metrics.stack("heavy900"),
            sz.round(),
            (sz * (0.5 - 0.36 * out(tk))).round(),
            [x + sz * 0.02, y],
            soft(clamp(tk * 2.5)),
        );
        let rk = soft(clamp((tk - 0.45) / 0.4));
        if rk > 0.0 {
            title_text(
                d,
                "ZANKŌ — AFTERGLOW".into(),
                metrics.stack("dot400"),
                18.0,
                9.0,
                [x + 4.0, y + sz * 0.66 + 14.0],
                0.7 * rk,
            );
        }
    }
    let vignette = |g: f64| Style::Radial {
        from: [960.0, 540.0, 1080.0 * 0.3],
        to: [960.0, 540.0, 1080.0 * 1.05],
        stops: stops(&[(0.0, [0.0; 4]), (1.0, css(rgb(0x030206), 0.6 * (1.0 - g)))]),
    };
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(vignette(g), "source-over"),
    );
    let mut rng = Rng::new(4242.0);
    let gray = (0..65536)
        .map(|_| ((rng.next() * 0.6 + rng.next() * 0.4) * 255.0).trunc() as u8)
        .collect();
    let f = (c.t * 24.0 + 1e-6).floor();
    // filmGrain resets the target CTM, so translations and extents are physical pixels.
    d.commands.push(Command::Grain {
        transform: [
            1.0,
            0.0,
            0.0,
            1.0,
            -(rnd(f, 1.0) * 256.0).trunc(),
            -(rnd(f, 2.0) * 256.0).trunc(),
        ],
        rect: [0.0, 0.0, 2176.0, 1336.0],
        size: [256, 256],
        gray,
        opacity: 0.07,
        // Original filmGrain inherits the vignette's gradient assignment.
        // Per-command isolation must replay that history before the pattern.
        fill_history: Some(FillHistory {
            transform: d.identity(),
            style: vignette(g),
        }),
    });
    if a.fade_in > 0.0 && c.lt < a.fade_in {
        d.commands.push(Command::Rect {
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            operations: vec![],
            clip: None,
            rect: [0.0, 0.0, 1920.0, 1080.0],
            paint: fill(
                solid(css(rgb(0x000000), 1.0 - soft(c.lt / a.fade_in))),
                "source-over",
            ),
        });
    }
}
