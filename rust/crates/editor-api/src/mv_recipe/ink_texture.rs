use super::{draw::*, math::*, plan::Command, raster::*};
pub(super) fn noise_texture(
    out: &mut Vec<Command>,
    id: &'static str,
    n: usize,
    rmin: f64,
    rmax: f64,
    amin: f64,
    amax: f64,
    seed: f64,
) {
    let mut d = Draw::new(1920., 1080.);
    let mut r = Rng::new(seed);
    for _ in 0..n {
        let x = r.next() * 480.;
        let y = r.next() * 270.;
        let radius = lerp(rmin, rmax, r.next() * r.next());
        let alpha = lerp(amin, amax, r.next());
        for ox in [-480., 0., 480.] {
            for oy in [-270., 0., 270.] {
                if x + ox + radius < 0.
                    || x + ox - radius > 480.
                    || y + oy + radius < 0.
                    || y + oy - radius > 270.
                {
                    continue;
                }
                d.glow(
                    x + ox,
                    y + oy,
                    radius,
                    &[
                        (0., rgb(255, 255, 255, alpha)),
                        (1., rgb(255, 255, 255, 0.)),
                    ],
                    "source-over",
                );
            }
        }
    }
    surface(out, id, [480, 270], d);
}
pub(super) fn prepare(out: &mut Vec<Command>) {
    noise_texture(out, "ik-fog", 90, 20., 110., 0.05, 0.14, 77.);
    noise_texture(out, "ik-mot", 900, 1.5, 9., 0.2, 0.9, 12.);
    noise_texture(out, "ik-mot2", 160, 10., 60., 0.2, 0.7, 13.);
}
pub(super) fn scroll(d: &mut Draw, id: &'static str, ox: f64, oy: f64, w: f64, h: f64, alpha: f64) {
    // JS ((ox % sw)+sw)%sw-sw, including the second rounding operation.
    let mut y = ((oy % h) + h) % h - h;
    let first_x = ((ox % w) + w) % w - w;
    while y < 1080. {
        let mut x = first_x;
        while x < 1920. {
            all(d, id, [480, 270], [x, y, w, h], "source-over", alpha, 0.);
            x += w;
        }
        y += h;
    }
}
