use super::{clock::Clock, draw::*, math::*, model::Thread, plan::*, raster::*, state::State};
pub(super) const COVER: [f64; 4] = [-2400.0, -2400.0, 6720.0, 5880.0];

pub(super) fn prepare(out: &mut Vec<Command>) {
    let mut d = Draw::new(1920.0, 1080.0);
    let mut rng = Rng::new(5.0);
    for _ in 0..70 {
        let x = rng.next() * 480.0;
        let y = rng.next() * 270.0;
        let r = lerp(30.0, 150.0, rng.next() * rng.next());
        let a = lerp(0.04, 0.16, rng.next());
        for ox in [-480.0, 0.0, 480.0] {
            for oy in [-270.0, 0.0, 270.0] {
                if x + ox + r < 0.0 || x + ox - r > 480.0 || y + oy + r < 0.0 || y + oy - r > 270.0
                {
                    continue;
                }
                d.glow(
                    x + ox,
                    y + oy,
                    r,
                    &[(0.0, rgb(255, 255, 255, a)), (1.0, rgb(255, 255, 255, 0.0))],
                    "source-over",
                );
            }
        }
    }
    surface(out, "th-neb", [480, 270], d);
    for (id, color) in [
        ("th-neb-v", rgb(140, 60, 140, 1.0)),
        ("th-neb-r", rgb(192, 80, 106, 1.0)),
    ] {
        let mut tint = Draw::new(1920.0, 1080.0);
        all(
            &mut tint,
            "th-neb",
            [480, 270],
            [0.0, 0.0, 480.0, 270.0],
            "source-over",
            1.0,
            0.0,
        );
        tint.rect([0.0, 0.0, 480.0, 270.0], fill(solid(color), "source-in"));
        surface(out, id, [480, 270], tint);
    }
    release(out, "th-neb");
}
fn scroll(d: &mut Draw, id: &'static str, offset: [f64; 2], size: [f64; 2], alpha: f64) {
    let [w, h] = size;
    // JS remainder twice, not an independently rounded tile phase.
    let x0 = ((offset[0] % w) + w) % w - w;
    let mut y = ((offset[1] % h) + h) % h - h;
    while y < 1080.0 {
        let mut x = x0;
        while x < 1920.0 {
            all(d, id, [480, 270], [x, y, w, h], "lighter", alpha, 0.0);
            x += w;
        }
        y += h;
    }
}
pub(super) fn draw(d: &mut Draw, a: &Thread, c: &Clock, s: &State) {
    d.operations = s.camera(0.35);
    d.rect(COVER, fill(solid(rgb(10, 5, 17, 1.0)), "source-over"));
    d.rect(
        COVER,
        fill(
            radial(
                a.light[0],
                a.light[1],
                1700.0,
                &[
                    (0.0, rgb(78, 31, 86, 1.0)),
                    (0.15, rgb(49, 20, 60, 1.0)),
                    (0.45, rgb(27, 12, 38, 1.0)),
                    (1.0, rgb(10, 5, 17, 0.0)),
                ],
            ),
            "source-over",
        ),
    );
    d.rect(
        COVER,
        fill(
            radial(
                260.0,
                980.0,
                1000.0,
                &[(0.0, rgb(58, 34, 96, 0.55)), (1.0, rgb(58, 34, 96, 0.0))],
            ),
            "source-over",
        ),
    );
    d.operations.clear();
    scroll(
        d,
        "th-neb-v",
        [-c.time * 9.0, c.time * 4.0],
        [2400.0, 1350.0],
        0.22,
    );
    scroll(
        d,
        "th-neb-r",
        [c.time * 14.0 + 700.0, -c.time * 6.0 + 300.0],
        [1900.0, 1070.0],
        0.14,
    );
    d.operations = s.camera(0.6);
    for i in 0..80 {
        let i = i as f64;
        let x = fract(rnd(i, 301.0) + c.time * 0.004 * (0.5 + rnd(i, 302.0))) * 2120.0 - 100.0;
        let y = fract(rnd(i, 303.0) - c.time * 0.006 * (0.5 + rnd(i, 304.0))) * 1280.0 - 100.0;
        let r = 0.7 + 1.5 * rnd(i, 307.0);
        let alpha = (0.15 + 0.4 * rnd(i, 308.0))
            * (0.55 + 0.45 * (c.time * (0.7 + rnd(i, 309.0)) + i).sin());
        d.glow(
            x,
            y,
            r * 2.2,
            &[
                (0.0, rgb(230, 182, 232, alpha)),
                (1.0, rgb(230, 182, 232, 0.0)),
            ],
            "lighter",
        );
    }
    d.operations = s.camera(1.0);
    let [x, y] = a.light;
    let lp = s.light_pulse;
    glow(
        d,
        x,
        y,
        420.0 * (0.75 + 0.5 * lp),
        rgb(122, 35, 80, 1.0),
        0.32 * lp,
    );
    glow(
        d,
        x,
        y,
        160.0 * (0.8 + 0.6 * lp),
        rgb(240, 102, 58, 1.0),
        0.32 * lp,
    );
}
