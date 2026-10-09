use super::{draw::*, math::*, plan::*, raster::*};
pub(super) struct Embers {
    pub n: u32,
    pub x: f64,
    pub y: f64,
    pub spread: f64,
    pub rise: f64,
    pub life: [f64; 2],
    pub size: f64,
    pub alpha: f64,
    pub seed: f64,
    pub drift: f64,
}
pub(super) fn embers(d: &mut Draw, t: f64, o: Embers) {
    for i in 0..o.n {
        let i = i as f64;
        let life = lerp(o.life[0], o.life[1], rnd(i, o.seed));
        let cycle = t / life + rnd(i, o.seed + 1.0);
        let k = fract(cycle);
        let generation = cycle.floor();
        let age = k * life;
        let sx = o.x + signed3(i, generation, o.seed + 2.0) * o.spread;
        let sy = o.y + signed3(i, generation, o.seed + 3.0) * o.spread * 0.25;
        let x = sx
            + (age * (1.3 + rnd(i, o.seed + 4.0) * 2.2) + i).sin() * 16.0 * k
            + signed3(i, generation, o.seed + 5.0) * o.drift * k;
        let y = sy - o.rise * age - 18.0 * age * age;
        let a = o.alpha
            * (std::f64::consts::PI * (k * 1.1).min(1.0)).sin().powf(0.6)
            * (0.6 + 0.4 * (t * 17.0 + i * 2.3).sin());
        if a < 0.02 {
            continue;
        }
        let r = o.size * (0.5 + rnd(i, o.seed + 6.0)) * (1.0 - 0.55 * k);
        let color = if k < 0.3 {
            rgb(255, 208, 138, 1.0)
        } else if k < 0.6 {
            rgb(255, 165, 82, 1.0)
        } else {
            rgb(240, 102, 58, 1.0)
        };
        d.rect(
            [x - r * 4.0, y - r * 4.0, r * 8.0, r * 8.0],
            fill(
                radial(
                    x,
                    y,
                    r * 4.0,
                    &[
                        (0.0, rgb(255, 244, 218, a)),
                        (0.25, rgba(color, a * 0.8)),
                        (1.0, rgba(color, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
}
pub(super) fn rays(d: &mut Draw, x: f64, y: f64, alpha: f64, t: f64) {
    for i in 0..18 {
        let i = i as f64;
        let angle = i / 18.0 * TAU + rnds(i, 5.0) * 0.2 + t * 0.02;
        let width = 0.02 + 0.05 * rnd(i, 6.0);
        let a = alpha * (0.3 + 0.7 * rnd(i, 7.0)) * (0.6 + 0.4 * (t * 0.8 + i).sin());
        d.path(
            vec![
                Step::MoveTo { point: [x, y] },
                arc(x, y, 1600.0, angle - width, angle + width, false),
                Step::Close,
            ],
            vec![fill(
                radial(
                    x,
                    y,
                    1600.0,
                    &[(0.0, rgb(255, 165, 82, a)), (1.0, rgb(255, 165, 82, 0.0))],
                ),
                "lighter",
            )],
        );
    }
}
pub(super) fn vignette(d: &mut Draw, alpha: f64, inner: f64, color: [f64; 4]) {
    d.rect(
        FRAME,
        fill(
            Style::Radial {
                from: [960.0, 540.0, 1080.0 * inner],
                to: [960.0, 540.0, 1080.0 * 1.05],
                stops: stops(&[(0.0, rgba(color, 0.0)), (1.0, rgba(color, alpha))]),
            },
            "source-over",
        ),
    );
}
