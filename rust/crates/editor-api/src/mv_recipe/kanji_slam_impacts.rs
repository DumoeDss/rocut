use super::{
    character::Character,
    clock::Clock,
    draw::*,
    math::*,
    model::{KanjiSlam, Lines, Variant},
    palette::*,
    plan::*,
    raster::*,
    state::State,
};
pub(super) fn draw(d: &mut Draw, a: &KanjiSlam, c: &Clock, s: &State, g: &Character) {
    let gl = s.glyphs.last().expect("validated nonempty word");
    let u = c.elapsed;
    d.operations = s.camera(1.0);
    if !s.rekick {
        for j in 0..2 {
            let q = clamp((u - j as f64 * 0.05) / 0.55);
            if q <= 0.0 || q >= 1.0 {
                continue;
            }
            let color = mixed(
                HI,
                GLOW,
                j as f64 * 0.6,
                (1.0 - q) * (1.0 - q) * if j == 1 { 0.5 } else { 0.8 },
            );
            d.path(
                circle(gl.x, gl.y, 160.0 + 1500.0 * out(q)),
                vec![stroke(
                    solid(color),
                    (if j == 1 { 3.0 } else { 14.0 }) * (1.0 - q) + 1.0,
                    "butt",
                    "miter",
                )],
            );
        }
    }
    d.operations.clear();
    let alpha = (if s.rekick { 0.4 } else { 0.8 }) * (-u * 5.5).exp();
    if alpha > 0.01 {
        let mut rng = Rng::new(f64::from(hash(&[frame(c.time, 12.0), c.hit as f64, 3.0])));
        let mut path = Vec::new();
        for _ in 0..120 {
            let th = rng.next() * TAU;
            let r0 = 600.0 * (0.8 + rng.next() * 0.8);
            let wd = 0.003 + rng.next() * 0.01;
            path.extend([
                Step::MoveTo {
                    point: [g.face[0] + th.cos() * r0, g.face[1] + th.sin() * r0],
                },
                Step::LineTo {
                    point: [
                        g.face[0] + (th - wd).cos() * 2300.0,
                        g.face[1] + (th - wd).sin() * 2300.0,
                    ],
                },
                Step::LineTo {
                    point: [
                        g.face[0] + (th + wd).cos() * 2300.0,
                        g.face[1] + (th + wd).sin() * 2300.0,
                    ],
                },
                Step::Close,
            ]);
        }
        let color = if a.lines == Lines::Light {
            [1.0, 220.0 / 255.0, 200.0 / 255.0, 0.9]
        } else {
            [20.0 / 255.0, 11.0 / 255.0, 30.0 / 255.0, 0.95]
        };
        d.path(
            path,
            vec![opacity(fill(solid(color), "source-over"), alpha)],
        );
    }
    if a.variant == Variant::Hand {
        let hx = g.x + (a.face[0] - 0.5) * g.image[0] as f64 * (g.h / g.image[1] as f64);
        let hy = g.y - (1.0 - a.face[1]) * g.h;
        d.operations = s.camera(1.15);
        glow(
            d,
            hx + 30.0,
            hy - 60.0,
            520.0 + 120.0 * c.pulse(6.0),
            rgb(0xffe9b8),
            0.55 + 0.3 * c.pulse(6.0),
        );
        d.operations.clear();
    }
}
pub(super) fn particles(d: &mut Draw, a: &KanjiSlam, c: &Clock, s: &State) {
    let count = if a.fire {
        170
    } else if a.night() {
        40
    } else {
        70
    };
    let color = if a.night() { rgb(0xff6a4d) } else { GLOW };
    let rise = if a.fire { 190.0 } else { 120.0 };
    let size = if a.fire { 3.6 } else { 3.0 };
    let wind = -0.6 - 0.8 * c.pulse(4.0);
    let t = c.time;
    for i in 0..count {
        let i = i as f64;
        let life = 3.0 + 4.0 * rnd(i, 311.0);
        let ph = rnd(i, 312.0) * life;
        let k = (t + ph) / life - ((t + ph) / life).floor();
        let x = lerp(0.0, 1920.0, rnd(i, 313.0))
            + (t * (0.6 + rnd(i, 314.0)) + i).sin() * 30.0 * k
            + wind * k * 200.0;
        let y = lerp(1080.0 * 1.1, 1080.0 * 0.2, rnd(i, 315.0)) - k * rise * life;
        let flick = 0.55 + 0.45 * (t * 13.0 + i * 3.1).sin();
        let alpha = (k * std::f64::consts::PI).sin() * flick * 0.9;
        let r = size * (0.5 + rnd(i, 316.0)) * (1.0 - k * 0.5);
        if alpha <= 0.01 {
            continue;
        }
        d.glow(
            x,
            y,
            r * 4.0,
            &[
                (0.0, rgba(rgb(0xfff1d0), alpha)),
                (0.3, rgba(color, alpha * 0.8)),
                (1.0, rgba(color, 0.0)),
            ],
            "lighter",
        );
    }
    if !s.rekick && c.elapsed < 0.9 {
        let gl = s.glyphs.last().expect("validated word");
        let u = c.elapsed;
        let k = c.hit as f64;
        for i in 0..if a.fire { 70 } else { 36 } {
            let i = i as f64;
            let th = random(&[i, k, 51.0]) * TAU;
            let speed = 500.0 + 1300.0 * random(&[i, k, 52.0]);
            let life = 0.35 + 0.5 * random(&[i, k, 53.0]);
            let q = u / life;
            if q >= 1.0 {
                continue;
            }
            let x = gl.x + th.cos() * speed * u;
            let y = gl.y + th.sin() * speed * u + 700.0 * u * u;
            let len = 26.0 * (1.0 - q) + 4.0;
            d.path(
                line([x, y], [x - th.cos() * len, y - th.sin() * len]),
                vec![stroke(
                    solid(rgba(
                        if i as u32 % 3 != 0 { GLOW } else { HI },
                        (1.0 - q) * 0.9,
                    )),
                    2.2 * (1.0 - q) + 0.6,
                    "butt",
                    "miter",
                )],
            );
        }
    }
}
