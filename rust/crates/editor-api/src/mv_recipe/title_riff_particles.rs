use super::{
    clock::Clock,
    draw::*,
    ease::jsround,
    math::*,
    model::TitleRiff,
    palette::{Palette, rgb},
    state::State,
};
fn burst(
    d: &mut Draw,
    t: f64,
    start: f64,
    x: f64,
    y: f64,
    r: f64,
    n: usize,
    seed: f64,
    speed: f64,
    life: f64,
    gravity: f64,
    p: &Palette,
) {
    let dt = t - start;
    if dt < 0.0 || dt > life {
        return;
    }
    let seed = if seed == 0.0 { 9.0 } else { seed };
    for index in 0..n {
        let i = index as f64;
        let a = i / n as f64 * TAU + rnds(i, seed) * 0.4;
        let speed = speed * (0.35 + 0.65 * rnd(i, seed + 1.0));
        let life = life * (0.5 + 0.5 * rnd(i, seed + 2.0));
        if dt > life {
            continue;
        }
        let radius = r * (1.0 + 0.04 * rnds(i, seed + 3.0));
        let position = |v: f64| {
            let radius = radius + speed * (1.0 - (-3.2 * v).exp()) / 3.2;
            [x + a.cos() * radius, y + a.sin() * radius + gravity * v * v]
        };
        let alpha = (1.0 - dt / life).powf(1.4);
        d.path(
            line(position((dt - 0.045).max(0.0)), position(dt)),
            vec![
                stroke(solid(rgba(p.glow, 0.3 * alpha)), 4.0, "round", "miter"),
                stroke(solid(rgba(p.core, alpha)), 1.4, "round", "miter"),
            ],
        );
    }
}
pub(super) fn draw(d: &mut Draw, a: &TitleRiff, c: &Clock, s: &State, p: &Palette) {
    for cue in [a.cues.zan, a.cues.ko, a.cues.lock] {
        let start = c.at(cue);
        burst(
            d,
            c.time,
            start,
            s.x,
            s.y,
            s.radius * 1.05,
            30,
            jsround(start * 7.0),
            900.0,
            1.0,
            80.0,
            p,
        );
    }
    burst(
        d,
        c.time,
        c.at(a.cues.sun),
        s.x,
        s.y,
        s.radius,
        40,
        5.0,
        1300.0,
        1.2,
        60.0,
        p,
    );
    let seed = if a.outro() { 41.0 } else { 31.0 };
    let t = c.time;
    for index in 0..26 {
        let i = index as f64;
        let life = 3.0 + 4.0 * rnd(i, seed);
        let phase = rnd(i, seed + 1.0) * life;
        let raw = (t + phase) / life;
        let k = raw - raw.floor();
        let x = lerp(0.0, 1920.0, rnd(i, seed + 2.0))
            + (t * (0.6 + rnd(i, seed + 3.0)) + i).sin() * 30.0 * k;
        let y = lerp(1080.0 * 1.05, 1080.0 * 0.3, rnd(i, seed + 4.0)) - k * 70.0 * life;
        let flick = 0.55 + 0.45 * (t * 13.0 + i * 3.1).sin();
        let alpha = (k * std::f64::consts::PI).sin() * flick * 0.55 * (1.0 - s.exit);
        let radius = 2.2 * (0.5 + rnd(i, seed + 5.0)) * (1.0 - k * 0.5);
        if alpha <= 0.01 {
            continue;
        }
        d.glow(
            x,
            y,
            radius * 4.0,
            &[
                (0.0, rgba(rgb(0xfff1d0), alpha)),
                (0.3, rgba(p.glow, alpha * 0.8)),
                (1.0, rgba(p.glow, 0.0)),
            ],
            "lighter",
        );
    }
}
