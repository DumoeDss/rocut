use super::{
    canvas::{Canvas, Op, Surface},
    geometry::{Car, Geometry, G, P, R, WH},
    math::*,
    model::Image,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub const LAMPS: [(f64, f64, f64, usize); 4] = [
    (146.7, 334.3, 22.8, 0),
    (303.7, 332.7, 23.0, 1),
    (1451.75, 408.25, 15.6, 0),
    (1543.75, 408.25, 15.6, 1),
];
pub const ARM: [(f64, f64, f64, f64, usize); 2] =
    [(683.4, 657.0, 22.0, 8.0, 1), (1129.5, 651.5, 19.0, 7.0, 0)];
impl Canvas {
    pub fn arc(&mut self, x: f64, y: f64, r: f64, start: f64, end: f64) {
        self.ops.push(Op::Arc {
            center: [x, y],
            radius: r,
            start,
            end,
        });
    }
    pub fn round(&mut self, rect: [f64; 4], radius: f64) {
        self.ops.push(Op::RoundRect { rect, radius });
    }
    pub fn quad(&mut self, p: [f64; 4]) {
        self.ops.push(Op::QuadraticCurveTo { points: p });
    }
    pub fn bezier(&mut self, p: [f64; 6]) {
        self.ops.push(Op::BezierCurveTo { points: p });
    }
    pub fn stroke_rect(&mut self, rect: [f64; 4]) {
        self.ops.push(Op::StrokeRect { rect });
    }
}
pub fn stops(v: &[(f64, &str)]) -> Vec<(f64, String)> {
    v.iter().map(|(n, s)| (*n, (*s).into())).collect()
}
pub fn off_plate(img: &Image) -> Surface {
    let mut c = Canvas::new("train-off");
    c.image(
        &img.resource.id,
        None,
        [0.0, 0.0, img.width as f64, img.height as f64],
    );
    for (x, y, r, _) in LAMPS {
        let g = c.radial(
            [x - r * 0.25, y - r * 0.3, 0.0, x, y, r + 1.8],
            &stops(&[(0.0, "#4a141b"), (0.7, "#2c0b11"), (1.0, "#16060a")]),
        );
        c.fill_brush(g);
        c.begin();
        c.arc(x, y, r + 1.8, 0.0, TAU);
        c.fill();
        c.stroke_color("rgba(255,150,140,0.16)");
        c.width(r * 0.12);
        c.begin();
        c.arc(
            x,
            y,
            r * 0.72,
            std::f64::consts::PI * 1.1,
            std::f64::consts::PI * 1.5,
        );
        c.stroke();
    }
    for (x, y, w, h, _) in ARM {
        c.fill_color("#2a0c10");
        c.fill_rect([x - w / 2.0 - 1.0, y - h / 2.0 - 1.0, w + 2.0, h + 2.0]);
    }
    Surface {
        id: "train-off".into(),
        size: [img.width, img.height],
        operations: c.ops,
    }
}
pub struct Art {
    pub surfaces: Vec<Surface>,
    ids: BTreeSet<String>,
}
impl Art {
    pub fn new(img: &Image) -> Self {
        Self {
            surfaces: vec![off_plate(img)],
            ids: BTreeSet::new(),
        }
    }
    fn interior(
        &mut self,
        w: u32,
        h: u32,
        path: Option<&str>,
        crop: Option<[f64; 4]>,
        seed: f64,
        images: &BTreeMap<String, &Image>,
    ) -> String {
        let key = format!("{w}x{h}|{:?}|{crop:?}|{seed}", path);
        let id = format!("train-interior-{:x}", Sha256::digest(key.as_bytes()));
        if !self.ids.insert(id.clone()) {
            return id;
        }
        let (w, h) = (w as f64, h as f64);
        let mut c = Canvas::new(&id);
        let g = c.linear(
            [0.0, 0.0, 0.0, h],
            &stops(&[(0.0, "#FFF1D2"), (0.35, "#F7CE94"), (1.0, "#B9794A")]),
        );
        c.fill_brush(g);
        c.fill_rect([0.0, 0.0, w, h]);
        let fy0 = h * 0.2;
        let fy1 = h * 0.6;
        let mut fx = -rnd(&[seed, 1.0]) * 100.0;
        while fx < w {
            let g = c.linear(
                [0.0, fy0, 0.0, fy1],
                &stops(&[(0.0, "#1b2440"), (1.0, "#2d3858")]),
            );
            c.fill_brush(g);
            c.begin();
            c.round([fx, fy0, 84.0, fy1 - fy0], 6.0);
            c.fill();
            c.fill_color("rgba(255,220,170,0.10)");
            c.fill_rect([fx + 6.0, fy0 + 6.0, 72.0, 4.0]);
            fx += 100.0;
        }
        c.fill_color("#FFFBF0");
        c.fill_rect([0.0, h * 0.045, w, h * 0.035]);
        c.fill_color("rgba(255,245,220,0.5)");
        c.fill_rect([0.0, h * 0.02, w, h * 0.09]);
        c.stroke_color("rgba(70,40,28,0.85)");
        c.width(2.5);
        c.begin();
        c.move_to(0.0, h * 0.15);
        c.line_to(w, h * 0.15);
        c.stroke();
        let mut sx = 14.0 + rnd(&[seed, 2.0]) * 30.0;
        while sx < w {
            c.width(2.0);
            c.begin();
            c.move_to(sx, h * 0.15);
            c.line_to(sx, h * 0.25);
            c.stroke();
            c.width(3.0);
            c.begin();
            c.ellipse(sx, h * 0.285, 7.0, 9.0, 0.0, TAU);
            c.stroke();
            sx += 44.0;
        }
        c.fill_color("#5a3222");
        c.fill_rect([0.0, h * 0.74, w, h * 0.26]);
        c.fill_color("#9c6440");
        c.fill_rect([0.0, h * 0.74, w, h * 0.025]);
        if let Some(path) = path {
            let image = images[path];
            let rect = crop.unwrap_or([0.0, 0.0, image.width as f64, image.height as f64]);
            let sc = (w / rect[2]).max(h / rect[3]);
            let dw = rect[2] * sc;
            let dh = rect[3] * sc;
            c.image(path, Some(rect), [(w - dw) / 2.0, (h - dh) / 2.0, dw, dh]);
        }
        c.composite("multiply");
        c.fill_color("#FFD6A4");
        c.fill_rect([0.0, 0.0, w, h]);
        c.composite("screen");
        let g = c.linear(
            [0.0, 0.0, 0.0, h],
            &stops(&[
                (0.0, "rgba(255,236,200,0.35)"),
                (0.4, "rgba(255,236,200,0)"),
            ]),
        );
        c.fill_brush(g);
        c.fill_rect([0.0, 0.0, w, h]);
        c.composite("source-over");
        let g = c.radial(
            [
                w / 2.0,
                h * 0.45,
                w.min(h) * 0.3,
                w / 2.0,
                h * 0.5,
                w.max(h) * 0.8,
            ],
            &stops(&[(0.0, "rgba(40,14,6,0)"), (1.0, "rgba(40,14,6,0.55)")]),
        );
        c.fill_brush(g);
        c.fill_rect([0.0, 0.0, w, h]);
        self.surfaces.push(Surface {
            id: id.clone(),
            size: [w as u32, h as u32],
            operations: c.ops,
        });
        id
    }
    pub fn car(&mut self, car: &Car, plan: &Geometry, images: &BTreeMap<String, &Image>) -> String {
        let id = format!("train-car-{}", car.i);
        let top = R - 40.0;
        let height = H + 20.0 - top;
        let body = car.u1 - car.u0;
        let front = car.i == 0;
        let tail = car.i == plan.cars.len() - 1;
        let mut c = Canvas::new(&id);
        c.translate(G, -top);
        let yt = R + 110.0;
        let yb = yt + WH;
        let bot = R + 548.0;
        let skirt = R + 590.0;
        if !tail {
            c.fill_color("#06080f");
            c.fill_rect([-G + 20.0, R + 70.0, G - 40.0, 440.0]);
            c.stroke_color("rgba(80,90,120,0.35)");
            c.width(1.0);
            let mut yy = R + 80.0;
            while yy < R + 505.0 {
                c.begin();
                c.move_to(-G + 20.0, yy);
                c.line_to(-20.0, yy);
                c.stroke();
                yy += 12.0;
            }
            c.fill_color("#05060b");
            c.fill_rect([-G, R + 560.0, G, 26.0]);
        }
        c.save();
        c.begin();
        c.move_to(0.0, R + 22.0);
        c.quad([0.0, R, 22.0, R]);
        if front {
            c.line_to(body - 120.0, R);
            c.bezier([
                body - 40.0,
                R + 6.0,
                body - 12.0,
                R + 120.0,
                body - 4.0,
                R + 300.0,
            ]);
            c.line_to(body, skirt - 30.0);
            c.line_to(body - 20.0, skirt);
            c.line_to(0.0, skirt);
        } else {
            c.line_to(body - 22.0, R);
            c.quad([body, R, body, R + 22.0]);
            c.line_to(body, skirt);
            c.line_to(0.0, skirt);
        }
        c.close();
        let g = c.linear(
            [0.0, R, 0.0, skirt],
            &stops(&[
                (0.0, "#1a2033"),
                (0.08, "#121829"),
                (0.55, "#0c111f"),
                (1.0, "#06080f"),
            ]),
        );
        c.fill_brush(g);
        c.fill();
        c.clip("nonzero");
        for (color, rect) in [
            ("rgba(150,170,215,0.22)", [0.0, R + 3.0, body, 2.0]),
            ("rgba(0,0,0,0.35)", [0.0, R + 30.0, body, 3.0]),
            ("rgba(140,160,210,0.10)", [0.0, R + 33.0, body, 2.0]),
            ("#C8373A", [0.0, yb + 26.0, body, 13.0]),
            ("rgba(200,55,58,0.55)", [0.0, yt - 22.0, body, 4.0]),
            ("#05070c", [0.0, bot, body, skirt - bot]),
            ("rgba(120,140,190,0.12)", [0.0, bot, body, 2.0]),
        ] {
            c.fill_color(color);
            c.fill_rect(rect);
        }
        for e in &car.elements {
            let x1 = body - (e.u0 - car.u0);
            let x0 = body - (e.u1 - car.u0);
            let ew = x1 - x0;
            if e.kind == "win" || e.kind == "cab" {
                let interior = if let Some(wi) = e.window {
                    let content = &plan.contents[wi];
                    Some(self.interior(
                        ew.round() as u32,
                        WH as u32,
                        content.character.as_deref(),
                        content.crop,
                        content.seed,
                        images,
                    ))
                } else {
                    None
                };
                c.save();
                c.begin();
                c.round([x0, yt, ew, WH], 14.0);
                c.clip("nonzero");
                if let Some(id) = interior {
                    c.blit(&id, None, [x0, yt, ew.round(), WH]);
                } else {
                    let g = c.linear(
                        [0.0, yt, 0.0, yb],
                        &stops(&[(0.0, "#223052"), (1.0, "#0b1122")]),
                    );
                    c.fill_brush(g);
                    c.fill_rect([x0, yt, ew, WH]);
                    c.fill_color("rgba(120,255,200,0.35)");
                    c.fill_rect([x0 + 16.0, yb - 40.0, 26.0, 6.0]);
                    c.fill_color("rgba(255,190,90,0.5)");
                    c.fill_rect([x0 + 52.0, yb - 40.0, 12.0, 6.0]);
                }
                let g = c.linear(
                    [x0, yt, x0 + ew * 0.6, yb],
                    &stops(&[
                        (0.0, "rgba(150,175,230,0.16)"),
                        (0.35, "rgba(150,175,230,0.02)"),
                        (0.36, "rgba(255,255,255,0.07)"),
                        (0.5, "rgba(255,255,255,0)"),
                    ]),
                );
                c.fill_brush(g);
                c.fill_rect([x0, yt, ew, WH]);
                c.restore();
                c.stroke_color("#04060b");
                c.width(7.0);
                c.begin();
                c.round([x0, yt, ew, WH], 14.0);
                c.stroke();
                c.stroke_color("rgba(255,215,160,0.22)");
                c.width(1.5);
                c.begin();
                c.round([x0 + 5.0, yt + 5.0, ew - 10.0, WH - 10.0], 10.0);
                c.stroke();
            } else if e.kind == "door" {
                c.fill_color("#10162a");
                c.fill_rect([x0, R + 70.0, ew, bot - R - 78.0]);
                c.stroke_color("#04060b");
                c.width(4.0);
                c.stroke_rect([x0, R + 70.0, ew, bot - R - 78.0]);
                c.begin();
                c.move_to(x0 + ew / 2.0, R + 70.0);
                c.line_to(x0 + ew / 2.0, bot - 8.0);
                c.stroke();
                let dw = (ew - 54.0) / 2.0;
                for dx in [x0 + 18.0, x0 + 36.0 + dw] {
                    let id = self.interior(dw.round() as u32, 206, None, None, dx.round(), images);
                    c.save();
                    c.begin();
                    c.round([dx, R + 104.0, dw, 206.0], 10.0);
                    c.clip("nonzero");
                    c.blit(&id, None, [dx, R + 104.0, dw.round(), 206.0]);
                    c.restore();
                    c.stroke_color("#04060b");
                    c.width(5.0);
                    c.begin();
                    c.round([dx, R + 104.0, dw, 206.0], 10.0);
                    c.stroke();
                }
                c.fill_color("#C8373A");
                c.fill_rect([x0, yb + 26.0, ew, 13.0]);
            } else if e.kind == "nose" {
                c.fill_color("#0a0f1e");
                c.begin();
                c.move_to(x0 + 40.0, R + 40.0);
                c.line_to(x1 - 50.0, R + 40.0);
                c.quad([x1 - 14.0, R + 120.0, x1 - 10.0, R + 250.0]);
                c.line_to(x0 + 40.0, R + 250.0);
                c.close();
                c.fill();
                let g = c.linear(
                    [x0, R + 40.0, x1, R + 250.0],
                    &stops(&[
                        (0.0, "rgba(120,150,210,0.25)"),
                        (0.5, "rgba(120,150,210,0.02)"),
                        (1.0, "rgba(255,255,255,0.1)"),
                    ]),
                );
                c.fill_brush(g);
                c.fill();
                c.fill_color("#1c2236");
                c.fill_rect([x1 - 56.0, R + 408.0, 48.0, 30.0]);
            }
            c.fill_color("rgba(0,0,0,0.35)");
            c.fill_rect([x0 - 14.0, R + 34.0, 1.5, bot - R - 34.0]);
        }
        c.restore();
        c.fill_color("#0d1220");
        c.begin();
        c.round([body * 0.36, R - 24.0, body * 0.28, 26.0], 6.0);
        c.fill();
        c.fill_color("rgba(140,160,210,0.2)");
        c.fill_rect([body * 0.36 + 6.0, R - 22.0, body * 0.28 - 12.0, 2.0]);
        c.fill_color("#030408");
        for bf in [0.16, 0.84] {
            let bx = body * bf;
            c.fill_rect([bx - 150.0, skirt - 6.0, 300.0, 40.0]);
            for wx in [bx - 90.0, bx + 90.0] {
                c.begin();
                c.arc(wx, skirt + 40.0, 46.0, 0.0, TAU);
                c.fill();
            }
        }
        c.composite("lighter");
        for i in 0..16 {
            let i = i as f64;
            let car = car.i as f64;
            let yy = R + 36.0 + rnd(&[car, i, 5.0]) * 520.0;
            let xx = rnd(&[car, i, 6.0]) * body;
            let ll = 120.0 + 480.0 * rnd(&[car, i, 7.0]);
            c.fill_color(if rnd(&[car, i, 8.0]) < 0.35 {
                "rgba(255,190,120,0.10)"
            } else {
                "rgba(170,190,240,0.08)"
            });
            c.fill_rect([xx, yy, ll, 1.4]);
        }
        c.composite("source-over");
        self.surfaces.push(Surface {
            id: id.clone(),
            size: [P as u32, height as u32],
            operations: c.ops,
        });
        id
    }
}
