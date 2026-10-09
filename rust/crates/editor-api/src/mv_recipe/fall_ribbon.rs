use super::{
    clock::Clock,
    draw::*,
    geometry::{Point, normals},
    math::*,
    plan::*,
    raster::*,
};
pub(super) struct Ribbon {
    body: Vec<Point>,
    widths: Vec<f64>,
    fibres: Vec<Vec<Point>>,
}
fn polyline(p: &[Point]) -> Vec<Step> {
    std::iter::once(Step::MoveTo { point: p[0] })
        .chain(p.iter().skip(1).map(|v| Step::LineTo { point: *v }))
        .collect()
}
fn paint(color: [f64; 4], width: f64, alpha: f64) -> Paint {
    let mut p = stroke(solid(color), width, "round", "round");
    p.composite = "source-over";
    p.opacity = alpha;
    p
}
impl Ribbon {
    pub fn new(p: &[Point], time: f64) -> Self {
        let nf = ((p.len() as f64 * 0.26).round() as usize).max(3);
        let nb = p.len() - nf + 1;
        let widths = (0..nb)
            .map(|i| lerp(1.4, 7.0, (1.0 - i as f64 / (nb - 1) as f64).powf(2.0)))
            .collect();
        let n = normals(p);
        let fibres = (0..9)
            .map(|j| {
                let j = j as f64;
                let spread = rnds(j, 71.0) * 22.0;
                let reach = 0.45 + 0.55 * rnd(j, 72.0);
                let curve = rnds(j, 73.0);
                let m = ((nf as f64 * reach).round() as usize).max(3);
                (0..m)
                    .map(|i| {
                        let k = nb - 1 + i;
                        let v = i as f64 / (nf - 1) as f64;
                        let off = spread * v.powf(1.35)
                            + curve * 7.0 * (v * 7.0 + time * 2.5 + j).sin() * v;
                        [p[k][0] + n[k][0] * off, p[k][1] + n[k][1] * off]
                    })
                    .collect()
            })
            .collect();
        Self {
            body: p[..nb].to_vec(),
            widths,
            fibres,
        }
    }
    pub fn prepare(&self, out: &mut Vec<Command>, c: &Clock) {
        for (a, b, scale, blur, mul) in [
            ("fa-wide-a", "fa-wide", 0.25, 9.0, 2.2),
            ("fa-near-a", "fa-near", 0.5, 3.0, 1.0),
        ] {
            let size = [(1920.0 * scale) as u32, (1080.0 * scale) as u32];
            let mut d = Draw::new(size[0] as f64, size[1] as f64);
            d.operations = c.camera();
            d.operations.push(Operation::CopyTransform);
            d.path(
                polyline(&self.body),
                vec![paint(rgb(255, 74, 48, 1.0), 8.0 * mul, 1.0)],
            );
            let mut fibre_path = vec![];
            for f in &self.fibres {
                fibre_path.extend(polyline(f));
            }
            d.path(
                fibre_path,
                vec![paint(rgb(255, 74, 48, 1.0), 8.0 * mul * 0.45, 1.0)],
            );
            surface(out, a, size, d);
            let mut blur_draw = Draw::new(1920.0, 1080.0);
            all(
                &mut blur_draw,
                a,
                size,
                [0.0, 0.0, size[0] as f64, size[1] as f64],
                "source-over",
                1.0,
                blur,
            );
            surface(out, b, size, blur_draw);
            release(out, a);
        }
    }
    pub fn draw(&self, d: &mut Draw) {
        let camera = d.operations.clone();
        d.operations.clear();
        all(d, "fa-wide", [480, 270], FRAME, "lighter", 0.55 * 0.55, 0.0);
        all(d, "fa-near", [960, 540], FRAME, "lighter", 0.55, 0.0);
        d.operations = camera;
        let n = normals(&self.body);
        let mut path = vec![];
        for i in 0..self.body.len() {
            let p = [
                self.body[i][0] + n[i][0] * self.widths[i] / 2.0,
                self.body[i][1] + n[i][1] * self.widths[i] / 2.0,
            ];
            path.push(if i == 0 {
                Step::MoveTo { point: p }
            } else {
                Step::LineTo { point: p }
            });
        }
        for i in (0..self.body.len()).rev() {
            path.push(Step::LineTo {
                point: [
                    self.body[i][0] - n[i][0] * self.widths[i] / 2.0,
                    self.body[i][1] - n[i][1] * self.widths[i] / 2.0,
                ],
            });
        }
        path.push(Step::Close);
        d.path(
            path,
            vec![fill(solid(rgb(200, 55, 58, 1.0)), "source-over")],
        );
        d.path(
            polyline(&self.body[..(self.body.len() - 1).max(2)]),
            vec![paint(
                rgb(255, 154, 120, 1.0),
                (1.4_f64 * 0.55).max(0.7),
                0.75,
            )],
        );
        for f in &self.fibres {
            for seg in 0..3 {
                let i0 = seg * (f.len() - 1) / 3;
                let i1 = (seg + 1) * (f.len() - 1) / 3;
                if i1 > i0 {
                    d.path(
                        polyline(&f[i0..=i1]),
                        vec![paint(
                            rgb(255, 154, 120, 1.0),
                            1.0,
                            0.9 * (1.0 - seg as f64 / 3.2),
                        )],
                    );
                }
            }
        }
    }
}
