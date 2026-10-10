use super::{
    canvas::{Canvas, Op, Surface},
    math::*,
    model::{Image, Sample, Settings},
    prepare::asphalt,
};
pub const CX: f64 = 960.0;
pub const CY: f64 = 566.0;
pub const RX: f64 = 760.0;
pub const RY: f64 = 336.0;
pub const K: f64 = 0.6;
const LX: f64 = 1236.0;
const LY: f64 = 404.0;
const SPOTS: [[f64; 2]; 9] = [
    [-560.0, 150.0],
    [-372.0, 64.0],
    [-190.0, 124.0],
    [-8.0, 26.0],
    [172.0, 88.0],
    [352.0, -24.0],
    [522.0, 36.0],
    [640.0, -76.0],
    [-80.0, -150.0],
];
pub struct Drop {
    pub t: f64,
    pub n: usize,
    pub u: f64,
    pub v: f64,
    pub seed: f64,
}
pub fn landings(a: &Settings, s: &Sample<'_>) -> Result<Vec<Drop>, String> {
    let spots = a.spots.as_deref().unwrap_or(&SPOTS);
    Ok(s.selected_beats(a.lead.unwrap_or(0.2), 0.7)?
        .into_iter()
        .enumerate()
        .map(|(i, t)| Drop {
            t,
            n: i + 1,
            u: spots[i % spots.len()][0],
            v: spots[i % spots.len()][1],
            seed: 101.0 + i as f64,
        })
        .collect())
}
pub fn camera(p: f64) -> (f64, f64) {
    let e = in_out_sine(p);
    (lerp(-0.03, 0.012, e), lerp(1.0, 1.06, e))
}
pub fn puddle() -> Vec<[f64; 2]> {
    (0..140)
        .map(|i| {
            let th = i as f64 / 140.0 * TAU;
            let c = th.cos();
            let s = th.sin();
            let wob = 1.0
                + 0.12 * fbm(c * 1.6 + 7.0, 11.0)
                + 0.1 * fbm(s * 1.9 + 3.0, 17.0)
                + 0.035 * (th * 5.0 + 1.0).sin()
                + 0.012 * (th * 23.0).sin();
            [CX + c * RX * wob, CY + s * RY * wob]
        })
        .collect()
}
fn stops(v: &[(f64, &str)]) -> Vec<(f64, String)> {
    v.iter().map(|(n, s)| (*n, (*s).into())).collect()
}
fn world(img: &Image, surfaces: &mut Vec<Surface>) {
    const MW: f64 = 2112.0;
    const MH: f64 = 1188.0;
    const OX: f64 = 96.0;
    const OY: f64 = 54.0;
    surfaces.push(asphalt());
    let mut c = Canvas::new("count-asphalt");
    c.blit("asphalt-noise", None, [0.0, 0.0, MW, MH]);
    let g = c.radial(
        [OX + 1700.0, OY - 60.0, 0.0, OX + 1700.0, OY - 60.0, 1500.0],
        &stops(&[
            (0.0, "rgba(150,170,220,0.34)"),
            (0.5, "rgba(110,130,190,0.12)"),
            (1.0, "rgba(110,130,190,0)"),
        ]),
    );
    c.fill_brush(g);
    c.fill_rect([0.0, 0.0, MW, MH]);
    let g = c.linear(
        [0.0, 0.0, 0.0, MH],
        &stops(&[
            (0.0, "rgba(4,6,12,0.35)"),
            (0.6, "rgba(4,6,12,0)"),
            (1.0, "rgba(4,6,12,0.25)"),
        ]),
    );
    c.fill_brush(g);
    c.fill_rect([0.0, 0.0, MW, MH]);
    let pts: Vec<_> = puddle()
        .iter()
        .map(|p| [OX + CX + (p[0] - CX) * 1.12, OY + CY + (p[1] - CY) * 1.2])
        .collect();
    c.save();
    c.filter("blur(30px)");
    c.fill_color("rgba(3,4,10,0.62)");
    c.begin();
    c.trace(&pts);
    c.fill();
    c.restore();
    for (x, y, r, rot) in [
        (1790.0, 960.0, 74.0, 0.2),
        (210.0, 150.0, 58.0, -0.1),
        (1650.0, 140.0, 36.0, 0.3),
        (140.0, 930.0, 96.0, 0.1),
        (520.0, 1010.0, 30.0, 0.0),
    ] {
        c.save();
        c.translate(OX + x, OY + y);
        c.rotate(rot);
        c.fill_color("rgba(3,5,12,0.5)");
        c.filter("blur(10px)");
        c.begin();
        c.ellipse(0.0, 0.0, r * 2.0, r * 1.1, 0.0, TAU);
        c.fill();
        c.filter("none");
        let g = c.linear(
            [0.0, -r, 0.0, r],
            &stops(&[(0.0, "#16213c"), (1.0, "#070b16")]),
        );
        c.fill_brush(g);
        c.begin();
        c.ellipse(0.0, 0.0, r * 1.6, r * K, 0.0, TAU);
        c.fill();
        c.stroke_color("rgba(160,180,230,0.18)");
        c.width(1.5);
        c.begin();
        c.ellipse(
            0.0,
            0.0,
            r * 1.6,
            r * K,
            std::f64::consts::PI * 1.1,
            std::f64::consts::PI * 1.9,
        );
        c.stroke();
        c.restore();
    }
    surfaces.push(Surface {
        id: "count-asphalt".into(),
        size: [2112, 1188],
        operations: c.ops,
    });
    let mut c = Canvas::new("count-reflection");
    let g = c.linear(
        [0.0, 0.0, 0.0, MH],
        &stops(&[(0.0, "#0b1528"), (1.0, "#050a16")]),
    );
    c.fill_brush(g);
    c.fill_rect([0.0, 0.0, MW, MH]);
    let sc = (MW / 820.0).max(MH / 430.0) * 1.3;
    let lx = MW / 2.0 - (1265.0 - 852.0 - 410.0) * sc;
    let ly = MH / 2.0 + (95.0 - 215.0) * sc;
    c.save();
    c.filter("blur(4px)");
    c.alpha(0.9);
    c.translate(LX + OX - lx, LY + OY - ly);
    c.translate(MW / 2.0, MH / 2.0);
    c.scale(-1.0, 1.0);
    c.image(
        &img.resource.id,
        Some([852.0, 0.0, 820.0, 430.0]),
        [-820.0 * sc / 2.0, -430.0 * sc / 2.0, 820.0 * sc, 430.0 * sc],
    );
    c.restore();
    c.composite("multiply");
    c.fill_color("#434f78");
    c.fill_rect([0.0, 0.0, MW, MH]);
    c.composite("lighter");
    let g = c.radial(
        [LX + OX, LY + OY, 0.0, LX + OX, LY + OY, 300.0],
        &stops(&[
            (0.0, "rgba(225,235,255,0.75)"),
            (0.12, "rgba(170,190,240,0.3)"),
            (1.0, "rgba(120,140,210,0)"),
        ]),
    );
    c.fill_brush(g);
    c.fill_rect([0.0, 0.0, MW, MH]);
    c.composite("source-over");
    surfaces.push(Surface {
        id: "count-reflection".into(),
        size: [2112, 1188],
        operations: c.ops,
    });
}
fn reflection(c: &mut Canvas, s: f64, x: f64, y: f64, p: f64, rot: f64) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.translate(-x, -y);
    c.translate(CX, CY);
    c.rotate(-rot * 0.8);
    c.translate(-CX - 22.0 * p, -CY + 12.0 * p);
    c.blit("count-reflection", None, [-96.0, -54.0, 2112.0, 1188.0]);
    c.restore();
}
pub fn draw(
    a: &Settings,
    s: &Sample<'_>,
    img: &Image,
    surfaces: &mut Vec<Surface>,
    c: &mut Canvas,
) -> Result<(), String> {
    world(img, surfaces);
    let plan = landings(a, s)?;
    let t = s.time();
    let p = s.progress();
    let (rot, zoom) = camera(p);
    let nudge = plan
        .iter()
        .filter(|d| d.t <= t)
        .last()
        .map_or(0.0, |d| dec(t - d.t, 9.0));
    c.save();
    c.fill_color("#05070d");
    c.fill_rect([0.0, 0.0, W, H]);
    c.translate(CX, CY);
    c.rotate(rot);
    c.scale(zoom * (1.0 + 0.006 * nudge), zoom * (1.0 + 0.006 * nudge));
    c.translate(-CX, -CY);
    c.blit("count-asphalt", None, [-96.0, -54.0, 2112.0, 1188.0]);
    for i in 0..90 {
        let i = i as f64;
        let x = rnd(&[i, 81.0]) * (W + 160.0) - 80.0;
        let y = rnd(&[i, 82.0]) * (H + 100.0) - 50.0;
        if ((x - CX) / RX).powi(2) + ((y - CY) / RY).powi(2) < 1.25 {
            continue;
        }
        let tw = (t * (1.5 + 3.0 * rnd(&[i, 83.0])) + i * 7.1)
            .sin()
            .max(0.0)
            .powi(10);
        if tw > 0.03 {
            c.glow(x, y, 7.0, 5.0, "#C8D8FF", tw * 0.9);
        }
    }
    let pts = puddle();
    c.save();
    c.begin();
    c.trace(&pts);
    c.clip("nonzero");
    reflection(c, 1.0 + 0.02 * p, CX, CY, p, rot);
    for d in &plan {
        let age = t - d.t;
        if !(0.0..=2.3).contains(&age) {
            continue;
        }
        for (r, aa, _) in count_rings(age) {
            let bw = 12.0 + r * 0.05;
            c.save();
            c.begin();
            c.ellipse(CX + d.u, CY + d.v, r + bw, (r + bw) * K, 0.0, TAU);
            c.ellipse(
                CX + d.u,
                CY + d.v,
                (r - bw).max(1.0),
                (r - bw).max(1.0) * K,
                0.0,
                TAU,
            );
            c.clip("evenodd");
            reflection(
                c,
                (1.0 + 0.02 * p) * (1.0 + 0.06 * aa),
                CX + d.u,
                CY + d.v,
                p,
                rot,
            );
            c.restore();
        }
    }
    let g = c.radial(
        [CX, CY, RY * 0.6, CX, CY, RX * 1.15],
        &stops(&[(0.0, "rgba(0,0,6,0)"), (1.0, "rgba(0,0,6,0.6)")]),
    );
    c.fill_brush(g);
    c.fill_rect([0.0, 0.0, W, H]);
    c.width(1.1);
    for i in 0..52 {
        let i = i as f64;
        let life = 0.55 + 0.3 * rnd(&[i, 61.0]);
        let ph = rnd(&[i, 62.0]) * life;
        let cycle = ((t + ph) / life).floor();
        let age = (t + ph) / life - cycle;
        let th = rnd(&[i, cycle, 63.0]) * TAU;
        let rr = rnd(&[i, cycle, 64.0]).sqrt() * 0.95;
        let x = CX + th.cos() * RX * rr;
        let y = CY + th.sin() * RY * rr;
        let r = 3.0 + 30.0 * out_cubic(age) * (0.5 + rnd(&[i, cycle, 65.0]));
        let near = dec((x - LX).hypot((y - LY) / K) / 500.0, 1.0);
        c.stroke_color(&format!(
            "rgba(170,192,240,{})",
            (0.12 + 0.3 * near) * (1.0 - age)
        ));
        c.begin();
        c.ellipse(x, y, r, r * K, 0.0, TAU);
        c.stroke();
    }
    let beat = pulse(s.beats, t, 6.0);
    for d in &plan {
        let age = t - d.t;
        if age < 0.0 {
            continue;
        }
        let l = 0.34 + 0.6 * dec(age, 1.4) + 0.1 * beat;
        c.glow(CX + d.u, CY + d.v, 130.0, 130.0 * K, "#FF7424", l * 0.75);
        c.glow(CX + d.u, CY + d.v, 34.0, 34.0 * K, "#FFD49A", l);
    }
    let hg = c.radial(
        [LX, LY, 0.0, LX, LY, 900.0],
        &stops(&[
            (0.0, "rgba(240,246,255,0.95)"),
            (0.35, "rgba(200,215,255,0.42)"),
            (1.0, "rgba(160,180,230,0.14)"),
        ]),
    );
    c.ops.push(Op::LineCap {
        value: "round".into(),
    });
    for d in &plan {
        let age = t - d.t;
        if !(0.0..=2.4).contains(&age) {
            continue;
        }
        for (r, aa, j) in count_rings(age) {
            c.width(2.8 - j as f64 * 0.45);
            c.alpha(aa * 0.5);
            c.stroke_color("#02040c");
            c.begin();
            c.ellipse(CX + d.u, CY + d.v + 4.0, r - 3.0, (r - 3.0) * K, 0.0, TAU);
            c.stroke();
            c.alpha(aa);
            c.stroke_brush(hg.clone());
            c.begin();
            c.ellipse(CX + d.u, CY + d.v, r, r * K, 0.0, TAU);
            c.stroke();
            let warm = aa * dec(age, 1.8);
            if warm > 0.02 {
                c.alpha(warm * 0.7);
                c.stroke_color("#FFB468");
                c.begin();
                c.ellipse(
                    CX + d.u,
                    CY + d.v,
                    r,
                    r * K,
                    std::f64::consts::PI * 0.08,
                    std::f64::consts::PI * 0.92,
                );
                c.stroke();
            }
        }
    }
    c.alpha(1.0);
    c.restore();
    c.save();
    c.begin();
    c.trace(&pts);
    let g = c.linear(
        [0.0, CY - RY * 1.1, 0.0, CY + RY * 1.1],
        &stops(&[
            (0.0, "rgba(170,190,240,0.34)"),
            (0.5, "rgba(170,190,240,0.06)"),
            (1.0, "rgba(170,190,240,0.02)"),
        ]),
    );
    c.stroke_brush(g);
    c.width(2.0);
    c.stroke();
    c.restore();
    c.save();
    c.stroke_color("rgba(255,190,120,0.32)");
    c.width(1.3);
    c.ops.push(Op::LineDash {
        values: vec![2.0, 7.0],
    });
    for i in 1..plan.len() {
        let d = &plan[i];
        let age = t - d.t;
        if age < 0.0 {
            continue;
        }
        let q = out_cubic(sat(age / 0.3));
        c.begin();
        c.move_to(CX + plan[i - 1].u, CY + plan[i - 1].v);
        c.line_to(
            lerp(CX + plan[i - 1].u, CX + d.u, q),
            lerp(CY + plan[i - 1].v, CY + d.v, q),
        );
        c.stroke();
    }
    c.restore();
    for d in &plan {
        let age = t - d.t;
        let x = CX + d.u;
        let y = CY + d.v;
        if age < 0.0 && age > -0.46 {
            let u = (1.0 + age / 0.46).powi(2);
            let sx = lerp(x + (x - CX) * 0.55, x, u);
            let sy = lerp(y - 760.0, y, u);
            let size = lerp(3.4, 1.0, u);
            c.glow(sx, sy, 34.0 * size, 42.5 * size, "#FF9A40", 0.55 + 0.45 * u);
            c.glow(sx, sy, 9.0 * size, 12.0 * size, "#FFF2DC", 0.9);
            let ms = lerp(0.45, 1.0, u);
            c.glow(
                x,
                lerp(y + 240.0, y, u),
                22.0 * ms,
                17.6 * ms,
                "#FF9A40",
                0.35 * u,
            );
        }
        if (0.0..0.6).contains(&age) {
            let f = dec(age, 11.0);
            c.glow(x, y, 170.0, 170.0 * K, "#FFC98C", f * 0.9);
            c.glow(x, y, 34.0, 34.0 * K, "#FFFFFF", f);
            c.glow(x, y, 560.0, 9.0, "#FFC27A", dec(age, 6.0) * 0.45);
            for i in 0..12 {
                let i = i as f64;
                let k = age / (0.42 * (0.7 + 0.3 * rnd(&[i, d.seed])));
                if k >= 1.0 {
                    continue;
                }
                let th = i / 12.0 * TAU + rnds(&[i, d.seed, 1.0]) * 0.25;
                let out = 40.0 + 70.0 * rnd(&[i, d.seed, 2.0]);
                let up = 30.0 + 60.0 * rnd(&[i, d.seed, 3.0]);
                c.glow(
                    x + th.cos() * out * out_cubic(k),
                    y + th.sin() * out * K * out_cubic(k) - up * 4.0 * k * (1.0 - k),
                    9.0,
                    9.0,
                    "#FFCB8C",
                    (1.0 - k) * 0.9,
                );
            }
        }
    }
    c.restore();
    c.save();
    c.stroke_color("rgba(175,195,240,0.10)");
    c.width(1.4);
    c.begin();
    for i in 0..44 {
        let i = i as f64;
        let life = 0.32;
        let ph = rnd(&[i, 71.0]) * life;
        let cycle = ((t + ph) / life).floor();
        let k = (t + ph) / life - cycle;
        let x0 = rnd(&[i, cycle, 72.0]) * W;
        let y0 = rnd(&[i, cycle, 73.0]) * H * 0.9;
        let dx = (x0 - W / 2.0) * 0.06;
        let len = 70.0 * (1.0 - k);
        let x = x0 + dx * k * 3.0;
        let y = y0 + 160.0 * k;
        c.move_to(x, y);
        c.line_to(x + dx * len / 70.0, y + len);
    }
    c.stroke();
    c.restore();
    c.vignette(0.62, 0.34, "2,3,8");
    super::hud::draw(a, s, &plan, c);
    Ok(())
}
