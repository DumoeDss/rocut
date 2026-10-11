use super::{
    canvas::{Canvas, Op, Surface},
    math::*,
    model::{Image, Sample, Settings, View},
    prepare::{ReflectionMask, mask_surfaces},
};
use sha2::{Digest, Sha256};
const SPOTS: [[f64; 2]; 7] = [
    [430.0, 700.0],
    [1290.0, 640.0],
    [1030.0, 568.0],
    [250.0, 610.0],
    [1010.0, 880.0],
    [1450.0, 770.0],
    [720.0, 604.0],
];
pub struct Landing {
    pub t: f64,
    pub word: String,
    pub bx: f64,
    pub by: f64,
    pub hero: bool,
    pub seed: f64,
}
pub struct Geo {
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub ratio: f64,
    pub tf: f64,
    pub dist: f64,
}
struct Map {
    s: f64,
    ox: f64,
    oy: f64,
    dw: f64,
    dh: f64,
}
impl Map {
    fn x(&self, x: f64) -> f64 {
        self.ox + x * self.s
    }
    fn y(&self, y: f64) -> f64 {
        self.oy + y * self.s
    }
}
pub fn landings(a: &Settings, s: &Sample<'_>) -> Result<Vec<Landing>, String> {
    let bs = s.selected_beats(a.lead.unwrap_or(0.25), 0.02)?;
    let hero_at = a
        .hero_at
        .unwrap_or(s.start() + (s.end() - s.start()) * 0.66);
    let mut hi = None;
    let mut best = 1e9;
    for (i, b) in bs.iter().enumerate() {
        let d = (*b - hero_at).abs();
        if down(s.beats, a.downbeat_index0, *b) && d < best {
            best = d;
            hi = Some(i);
        }
    }
    let rest = if a.words.len() > 2 {
        &a.words[2..]
    } else if a.words.len() > 1 {
        &a.words[1..]
    } else {
        &a.words[..]
    };
    let n_non = bs.len() - usize::from(hi.is_some());
    let mut n = 0;
    let spots = a.spots.as_deref().unwrap_or(&SPOTS);
    let hs = a.hero_spot.unwrap_or([846.0, 812.0]);
    Ok(bs
        .into_iter()
        .enumerate()
        .map(|(i, t)| {
            let hero = hi == Some(i);
            let (word, sp) = if hero {
                (a.words[0].clone(), hs)
            } else {
                let sp = spots[n % spots.len()];
                let w = if n == n_non - 1 && a.words.len() > 1 {
                    a.words[1].clone()
                } else {
                    rest[n % rest.len()].clone()
                };
                n += 1;
                (w, sp)
            };
            Landing {
                t,
                word,
                bx: sp[0],
                by: sp[1],
                hero,
                seed: (i + 1) as f64,
            }
        })
        .collect())
}
fn geo(l: &Landing, m: &Map) -> Geo {
    let near = sat((l.by - 518.0) / (941.0 - 518.0));
    let k = m.s / 1.15;
    let hero = if l.hero { 1.12 } else { 1.0 };
    Geo {
        x: m.x(l.bx),
        y: m.y(l.by),
        size: (34.0 + 118.0 * near.powf(0.9)) * if l.hero { 1.3 } else { 1.0 } * k,
        ratio: 0.1 + 0.3 * near,
        tf: (0.5 + 0.55 * (1.0 - near)) * hero,
        dist: (360.0 + 1050.0 * near) * k * hero,
    }
}
fn word_id(word: &str) -> String {
    format!("word-{:x}", Sha256::digest(word.as_bytes()))
}
fn word_surface(word: &str) -> Surface {
    let id = word_id(word);
    let mut c = Canvas::new(&id);
    let chars: Vec<_> = word.chars().collect();
    let w = 396.0;
    let h = 180.0 * chars.len() as f64 + 216.0;
    c.font("mincho800", 180.0);
    c.align("center");
    c.baseline("middle");
    for (color, shadow, blur, repeats) in [
        ("#FF9440", "rgba(255,110,30,0.95)", 99.0, 2),
        ("#FFCF8A", "rgba(255,205,140,1)", 25.2, 1),
        ("#FFF4E2", "rgba(255,205,140,1)", 0.0, 1),
    ] {
        c.shadow(shadow, blur);
        c.fill_color(color);
        for _ in 0..repeats {
            for (i, ch) in chars.iter().enumerate() {
                let small = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ".contains(*ch);
                let x = w / 2.0 + if small { 18.0 } else { 0.0 };
                let y = 108.0 + 180.0 * (i as f64 + 0.5) - if small { 18.0 } else { 0.0 };
                c.text(&ch.to_string(), x, y);
            }
        }
    }
    Surface {
        id,
        size: [w as u32, h as u32],
        operations: c.ops,
    }
}
fn draw_word(c: &mut Canvas, l: &Landing, g: &Geo, t: f64, surfaces: &mut Vec<Surface>) {
    let age = t - l.t;
    if age < -g.tf || age > 0.6 {
        return;
    }
    let id = word_id(&l.word);
    if !surfaces.iter().any(|s| s.id == id) {
        surfaces.push(word_surface(&l.word));
    }
    let n = l.word.chars().count() as f64;
    let sw = 396.0;
    let sh = n * 180.0 + 216.0;
    let sc = g.size / 180.0;
    let (yb, vel) = if age < 0.0 {
        let u = 1.0 + age / g.tf;
        (
            g.y - g.dist * (1.0 - (0.4 * u + 0.6 * u * u)),
            g.dist * (0.4 + 1.2 * u) / g.tf,
        )
    } else {
        let v = g.dist * 1.6 / g.tf * 0.42;
        (g.y + v * age, v)
    };
    let a = sat((age + g.tf) / 0.14)
        * if age < 0.0 {
            0.8 + 0.2 * sat(1.0 + age / 0.25)
        } else {
            1.0
        };
    let dw = sw * sc;
    let dh = sh * sc;
    let x0 = g.x - dw / 2.0;
    let y0 = yb + 108.0 * sc - dh;
    let top = yb - n * 180.0 * sc;
    c.save();
    c.begin();
    c.rect([0.0, 0.0, W, g.y]);
    c.clip("nonzero");
    if age < 0.0 {
        let len = (vel * 0.08).min(g.size * 2.2);
        let grad = c.linear(
            [0.0, top - len, 0.0, top + g.size * 0.3],
            &[
                (0.0, "rgba(255,170,90,0)".into()),
                (1.0, format!("rgba(255,205,150,{})", 0.42 * a)),
            ],
        );
        c.composite("lighter");
        c.fill_brush(grad);
        c.fill_rect([
            g.x - g.size * 0.03,
            top - len,
            g.size * 0.06,
            len + g.size * 0.3,
        ]);
        for k in 1..=2 {
            c.alpha(a * 0.16 / k as f64);
            c.blit(&id, None, [x0, y0 - vel * k as f64 / 55.0, dw, dh]);
        }
        c.composite("source-over");
    }
    c.alpha(a);
    c.blit(&id, None, [x0, y0, dw, dh]);
    c.restore();
    c.save();
    c.begin();
    c.rect([0.0, g.y, W, H - g.y]);
    c.clip("nonzero");
    c.translate(0.0, 2.0 * g.y);
    c.scale(1.0, -1.0);
    c.alpha(a * 0.38);
    for i in 0..14 {
        let sy = i as f64 / 14.0 * sh;
        let shh = sh / 14.0;
        let k = 1.0 - i as f64 / 14.0;
        let dx = (i as f64 * 1.7 + t * 11.0 + l.seed).sin() * g.size * 0.05 * (0.4 + k);
        c.blit(
            &id,
            Some([0.0, sy, sw, shh]),
            [x0 + dx, y0 + sy * sc, dw, shh * sc + 0.6],
        );
    }
    c.restore();
}
fn impact(c: &mut Canvas, l: &Landing, g: &Geo, t: f64) {
    let age = t - l.t;
    if age < 0.0 || age > 4.0 {
        return;
    }
    let (x, y, size, ratio) = (g.x, g.y, g.size, g.ratio);
    let hero = if l.hero { 1.0 } else { 0.0 };
    let lin = (0.3 * dec(age, 1.4) + 0.11) * sat(1.0 - (age - 2.6) / 1.2);
    c.glow(
        x,
        y + size * 0.04,
        size * 1.5,
        size * 1.5 * ratio * 1.4,
        "#FF8A3A",
        lin * 1.3,
    );
    c.glow(
        x,
        y + size * 0.6,
        size * 0.35,
        size * 1.2,
        "#FF9A4A",
        lin * 0.7,
    );
    let rings = fall_rings(age, size, l.hero);
    for (r, a, _) in &rings {
        let bw = size * 0.09 + r * 0.035;
        let ry = r * ratio;
        c.save();
        c.begin();
        c.ellipse(x, y, r + bw, (r + bw) * ratio, 0.0, TAU);
        c.ellipse(
            x,
            y,
            (r - bw).max(1.0),
            ((r - bw) * ratio).max(0.5),
            0.0,
            TAU,
        );
        c.clip("evenodd");
        c.translate(x, y);
        c.scale(1.0 + 0.07 * a, 1.0 + 0.16 * a);
        c.translate(-x, -y - ry * 0.02);
        c.blit("plate", None, [0.0, 0.0, W, H]);
        c.restore();
    }
    c.save();
    c.ops.push(Op::LineCap {
        value: "round".into(),
    });
    for (r, a, j) in &rings {
        let ry = r * ratio;
        c.width((size * 0.028 * (1.0 - 0.15 * (*j as f64))).max(1.0));
        for (color, px, py, rx, ry, start, end) in [
            (
                format!("rgba(4,7,18,{})", a * 0.35),
                x,
                y + ry * 0.1,
                r * 0.965,
                ry * 0.965,
                0.0,
                TAU,
            ),
            (
                format!("rgba(190,208,255,{})", a * 0.22),
                x,
                y,
                *r,
                ry,
                0.0,
                TAU,
            ),
            (
                format!("rgba(232,240,255,{})", a * 0.4),
                x,
                y,
                *r,
                ry,
                std::f64::consts::PI * 1.15,
                std::f64::consts::PI * 1.85,
            ),
        ] {
            c.stroke_color(&color);
            c.begin();
            c.ellipse(px, py, rx, ry, start, end);
            c.stroke();
        }
        let warm = a * dec(age, 1.5);
        if warm > 0.02 {
            c.stroke_color(&format!("rgba(255,186,105,{})", warm * 0.55));
            c.begin();
            c.ellipse(
                x,
                y,
                *r,
                ry,
                std::f64::consts::PI * 0.05,
                std::f64::consts::PI * 0.95,
            );
            c.stroke();
        }
    }
    c.restore();
    if age < 0.5 {
        c.save();
        c.composite("lighter");
        if age < 0.34 {
            let jh = size * (0.9 + 0.5 * hero) * (std::f64::consts::PI * age / 0.34).sin();
            let jw = size * 0.06;
            let grad = c.linear(
                [0.0, y - jh, 0.0, y],
                &[
                    (0.0, "rgba(255,240,215,0.95)".into()),
                    (1.0, "rgba(255,160,80,0.2)".into()),
                ],
            );
            c.fill_brush(grad);
            c.begin();
            c.ellipse(
                x,
                y - jh / 2.0,
                jw * (1.0 - 0.5 * age / 0.34),
                jh / 2.0,
                0.0,
                TAU,
            );
            c.fill();
            c.glow(x, y - jh, jw * 2.2, jw * 2.2, "#FFE8C8", 0.8);
        }
        let nd = 11 + if l.hero { 5 } else { 0 };
        for i in 0..nd {
            let i = i as f64;
            let k = age / (0.46 * (0.7 + 0.3 * rnd(&[i, l.seed, 3.0])));
            if k >= 1.0 {
                continue;
            }
            let th = i / nd as f64 * TAU + rnds(&[i, l.seed]) * 0.3;
            let out = size * (0.5 + 0.9 * rnd(&[i, l.seed, 1.0]));
            let up = size * (0.45 + 0.8 * rnd(&[i, l.seed, 2.0]));
            let px = x + th.cos() * out * out_cubic(k);
            let py = y + th.sin() * out * ratio * out_cubic(k) - up * 4.0 * k * (1.0 - k);
            let rr = size * 0.035 * (1.0 - k * 0.6);
            c.glow(px, py, rr * 3.5, rr * 3.5, "#FFC98A", (1.0 - k) * 0.9);
        }
        c.restore();
    }
    let f = dec(age, 12.0);
    c.glow(
        x,
        y,
        size * (1.1 + 0.5 * hero),
        size * (0.7 + 0.3 * hero),
        "#FFC990",
        f * 0.75,
    );
    c.glow(x, y, size * 0.28, size * 0.2, "#FFFFFF", f * 0.9);
    c.glow(
        x,
        y,
        size * (5.0 + 5.0 * hero),
        size * 0.07,
        "#FFC27A",
        dec(age, 5.0) * (0.55 + 0.35 * hero),
    );
    c.glow(
        x,
        y + size * 1.4,
        size * 0.22,
        size * 1.6,
        "#FFB067",
        dec(age, 4.0) * 0.4,
    );
}
fn rain(
    c: &mut Canvas,
    t: f64,
    n: usize,
    seed: f64,
    angle: f64,
    speed: f64,
    len: f64,
    width: f64,
    color: &str,
) {
    c.save();
    c.stroke_color(color);
    c.width(width);
    c.begin();
    for i in 0..n {
        let i = i as f64;
        let x = rnd(&[i, seed]) * (W + 400.0) - 200.0;
        let ph = rnd(&[i, seed + 1.0]);
        let k = ph + t * speed / (H + 200.0) * (0.8 + 0.4 * rnd(&[i, seed + 2.0]));
        let y = (k - k.floor()) * (H + 200.0) - 100.0;
        c.move_to(x + y * angle.tan(), y);
        c.line_to(
            x + y * angle.tan() + angle.sin() * len,
            y + angle.cos() * len,
        );
    }
    c.stroke();
    c.restore();
}
pub fn draw(
    a: &Settings,
    s: &Sample<'_>,
    image: &Image,
    mask: &ReflectionMask,
) -> Result<(Vec<Surface>, Vec<Op>), String> {
    let t = s.time();
    let plan = landings(a, s)?;
    let hero = plan.iter().find(|l| l.hero);
    let p = in_out_sine(s.progress());
    let from = a.from.unwrap_or(View {
        zoom: 1.1,
        x: 0.12,
        y: 0.25,
        rot: 0.0,
    });
    let to = a.to.unwrap_or(View {
        zoom: 1.2,
        x: -0.04,
        y: -0.55,
        rot: 0.0,
    });
    let kick = hero.map_or(0.0, |h| dec(t - h.t, 6.5));
    let zoom = lerp(from.zoom, to.zoom, p) * (1.0 + 0.014 * kick);
    let scale = (W / image.width as f64).max(H / image.height as f64) * zoom;
    let dw = image.width as f64 * scale;
    let dh = image.height as f64 * scale;
    let m = Map {
        s: scale,
        dw,
        dh,
        ox: W / 2.0 + lerp(from.x, to.x, p) * ((dw - W) / 2.0).max(0.0) - dw / 2.0
            + fbm(t * 0.35, 3.0) * 6.0,
        oy: H / 2.0 + lerp(from.y, to.y, p) * ((dh - H) / 2.0).max(0.0) - dh / 2.0
            + fbm(t * 0.3, 9.0) * 5.0
            + ((t - hero.map_or(1e9, |h| h.t)).max(0.0) * 34.0).sin() * 7.0 * kick,
    };
    let mut surfaces = mask_surfaces(mask);
    let mut plate = Canvas::new("plate");
    plate.fill_color("#000");
    plate.fill_rect([0.0, 0.0, W, H]);
    plate.image(&a.bg, None, [m.ox, m.oy, m.dw, m.dh]);
    surfaces.push(Surface {
        id: "plate".into(),
        size: [1920, 1080],
        operations: plate.ops,
    });
    let mut c = Canvas::new("fall");
    c.blit("plate", None, [0.0, 0.0, W, H]);
    let hy = m.y(518.0).floor().max(0.0);
    if hy < H {
        let mut sh = Canvas::new("shimmer");
        let mut y = hy;
        while y < H {
            let k = (y - hy) / (H - hy);
            let dx = a.shimmer.unwrap_or(1.0)
                * (1.0 + 7.0 * k)
                * (0.62 * (y * 0.105 - t * 6.1).sin()
                    + 0.38 * (y * 0.031 + t * 2.3 + noise(y * 0.02, 5.0) * 3.0).sin());
            sh.blit("plate", Some([0.0, y, W, 3.0]), [dx, y, W, 3.0]);
            y += 3.0;
        }
        sh.composite("destination-in");
        sh.blit("reflection-mask", None, [m.ox, m.oy, m.dw, m.dh]);
        sh.composite("source-over");
        surfaces.push(Surface {
            id: "shimmer".into(),
            size: [1920, 1080],
            operations: sh.ops,
        });
        c.blit("shimmer", None, [0.0, 0.0, W, H]);
    }
    let hz = m.y(518.0);
    c.gradient_rect(
        [0.0, 0.0, W, hz],
        &[
            (0.0, "rgba(6,8,22,0.55)".into()),
            (0.45, "rgba(6,8,22,0)".into()),
            (1.0, "rgba(6,8,22,0)".into()),
        ],
    );
    c.glow(m.x(880.0), hz, 1100.0, 90.0, "#3F6284", 0.35);
    rain(
        &mut c,
        t,
        260,
        31.0,
        0.07,
        1500.0,
        36.0,
        1.0,
        "rgba(170,190,235,0.26)",
    );
    rain(
        &mut c,
        t,
        90,
        43.0,
        0.075,
        1900.0,
        70.0,
        1.4,
        "rgba(190,205,245,0.2)",
    );
    c.save();
    c.width(1.2);
    for i in 0..120 {
        let i = i as f64;
        let life = 0.42 + 0.25 * rnd(&[i, 7.0]);
        let ph = rnd(&[i, 8.0]) * life;
        let cycle = ((t + ph) / life).floor();
        let age = (t + ph) / life - cycle;
        let bx = rnd(&[i, cycle, 9.0]) * 1672.0;
        let by = 518.0 + 8.0 + (941.0 - 518.0 - 8.0) * rnd(&[i, cycle, 10.0]).powf(0.6);
        let x = m.x(bx);
        let y = m.y(by);
        if y < hz || y > H + 20.0 || x < -30.0 || x > W + 30.0 {
            continue;
        }
        let near = sat((by - 518.0) / (941.0 - 518.0));
        let r = (2.0 + 26.0 * near) * m.s / 1.15 * (0.15 + out_cubic(age));
        let alpha = 0.55 * (1.0 - age) * (0.4 + 0.6 * near);
        c.stroke_color(&format!("rgba(190,210,255,{alpha})"));
        c.begin();
        c.ellipse(x, y, r, r * (0.1 + 0.3 * near), 0.0, TAU);
        c.stroke();
        if age < 0.12 {
            c.stroke_color(&format!(
                "rgba(220,232,255,{})",
                0.55 * 0.8 * (1.0 - age / 0.12)
            ));
            c.begin();
            c.move_to(x, y);
            c.line_to(x, y - 10.0 * near * m.s);
            c.stroke();
        }
    }
    c.restore();
    let geos: Vec<_> = plan.iter().map(|l| geo(l, &m)).collect();
    for (l, g) in plan.iter().zip(&geos) {
        impact(&mut c, l, g, t);
    }
    for (l, g) in plan.iter().zip(&geos) {
        draw_word(&mut c, l, g, t, &mut surfaces);
    }
    rain(
        &mut c,
        t,
        30,
        77.0,
        0.08,
        2600.0,
        160.0,
        2.4,
        "rgba(205,220,255,0.16)",
    );
    rain(
        &mut c,
        t,
        8,
        91.0,
        0.08,
        2400.0,
        190.0,
        2.2,
        "rgba(255,214,160,0.22)",
    );
    c.vignette(0.55, 0.32, "4,6,14");
    Ok((surfaces, c.ops))
}
