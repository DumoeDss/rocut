use super::{draw::*, math::*, model::Palette};

pub(super) struct Sparks {
    pub x: f64,
    pub y: f64,
    pub n: usize,
    pub seed: f64,
    pub spread: f64,
    pub alpha: f64,
    pub rise: f64,
}
pub(super) fn sparks(d: &mut Draw, t: f64, o: Sparks, p: &Palette) {
    for index in 0..o.n {
        let i = index as f64;
        let life = lerp(1.3, 3.0, rnd(i, o.seed));
        let ph = rnd(i, o.seed + 1.0) * life;
        let cyc = ((t + ph) / life).floor();
        let age = t + ph - cyc * life;
        let k = age / life;
        let rand = |j: f64| f64::from(hash(&[i, cyc, o.seed + j])) / 4_294_967_296.0;
        let vx = (rand(2.0) - 0.5) * 50.0;
        let vy = -o.rise * (26.0 + 70.0 * rand(3.0));
        let curl = 6.0 + 20.0 * rand(4.0);
        let w = 2.0 + 3.0 * rand(5.0);
        let sx = (rand(6.0) - 0.5) * o.spread;
        let pos = |a: f64| {
            [
                o.x + sx + vx * a + (a * w + rand(7.0) * 6.0).sin() * curl * a,
                o.y + vy * a - 9.0 * a * a,
            ]
        };
        let alpha = (std::f64::consts::PI * k).sin().powf(0.7)
            * (0.55 + 0.45 * (t * 23.0 + i * 5.0).sin())
            * o.alpha;
        if alpha < 0.02 {
            continue;
        }
        d.path(
            line(pos((age - 0.06).max(0.0)), pos(age)),
            vec![
                stroke(solid(rgba(p.glow, 0.18 * alpha)), 5.0, "round", "miter"),
                stroke(solid(rgba(p.hi, alpha)), 1.3, "round", "miter"),
            ],
        );
    }
}
pub(super) struct Burst {
    pub x: f64,
    pub y: f64,
    pub n: usize,
    pub seed: f64,
    pub life: f64,
    pub ring: f64,
    pub speed: f64,
    pub gravity: f64,
    pub drag: f64,
}
pub(super) fn burst(d: &mut Draw, t: f64, start: f64, o: Burst, p: &Palette) {
    let dt = t - start;
    if dt < 0.0 || dt > o.life {
        return;
    }
    for index in 0..o.n {
        let i = index as f64;
        let a = i / o.n as f64 * TAU + rnds(i, o.seed) * 0.4;
        let speed = o.speed * (0.35 + 0.65 * rnd(i, o.seed + 1.0));
        let life = o.life * (0.5 + 0.5 * rnd(i, o.seed + 2.0));
        if dt > life {
            continue;
        }
        let r0 = o.ring * (1.0 + 0.04 * rnds(i, o.seed + 3.0));
        let radius = |s: f64| r0 + speed * (1.0 - (-o.drag * s).exp()) / o.drag;
        let pos = |s: f64| {
            [
                o.x + a.cos() * radius(s),
                o.y + a.sin() * radius(s) + o.gravity * s * s,
            ]
        };
        let alpha = (1.0 - dt / life).powf(1.4);
        d.path(
            line(pos((dt - 0.045).max(0.0)), pos(dt)),
            vec![
                stroke(solid(rgba(p.glow, 0.3 * alpha)), 4.0, "round", "miter"),
                stroke(solid(rgba(p.core, alpha)), 1.4, "round", "miter"),
            ],
        );
    }
}
pub(super) fn inward(
    d: &mut Draw,
    t: f64,
    r: f64,
    amount: f64,
    twist: f64,
    speed: f64,
    length: f64,
    p: &Palette,
) {
    if amount <= 0.01 {
        return;
    }
    for index in 0..160 {
        let i = index as f64;
        let th = rnd(i, 3.0) * TAU + twist * 0.35 + t * 0.15;
        let rate = (0.9 + 1.6 * rnd(i, 4.0)) * speed;
        let ft = t * rate + rnd(i, 5.0);
        let fi = ft - ft.floor();
        let rmax = 1250.0 + 250.0 * rnd(i, 6.0);
        let rh = lerp(rmax, r + 6.0, cube(fi));
        let len = (30.0 + 260.0 * fi) * (0.5 + rnd(i, 7.0)) * length;
        let alpha = amount * (std::f64::consts::PI * fi).sin() * (0.25 + 0.6 * rnd(i, 8.0));
        let rt = rh + len;
        let dth = 0.05 + 0.1 * twist / 2.6;
        d.path(
            line(
                [960.0 + th.cos() * rh, 540.0 + th.sin() * rh],
                [960.0 + (th - dth).cos() * rt, 540.0 + (th - dth).sin() * rt],
            ),
            vec![stroke(
                solid(rgba(if index % 3 != 0 { p.glow } else { p.hi }, alpha)),
                0.8 + 1.8 * rnd(i, 9.0),
                "round",
                "miter",
            )],
        );
    }
}
