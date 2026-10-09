use super::{
    clock::Clock,
    draw::*,
    geometry::{Point, normals},
    math::*,
    plan::*,
    raster::*,
    state::State,
};
pub(super) struct Ribbon {
    body: Vec<Point>,
    widths: Vec<f64>,
    fibres: Vec<Vec<Point>>,
}
fn polyline(p: &[Point]) -> Vec<Step> {
    std::iter::once(Step::MoveTo { point: p[0] })
        .chain(p.iter().skip(1).map(|p| Step::LineTo { point: *p }))
        .collect()
}
fn stroke_paint(color: [f64; 4], width: f64, alpha: f64) -> Paint {
    let mut p = stroke(solid(color), width, "round", "round");
    p.composite = "source-over";
    p.opacity = alpha;
    p
}
impl Ribbon {
    pub fn new(p: &[Point], c: &Clock) -> Self {
        let nf = ((p.len() as f64 * 0.2).round() as usize).max(3);
        let nb = p.len() - nf + 1;
        let body = p[..nb].to_vec();
        let widths = (0..nb)
            .map(|i| lerp(1.7, 7.5, (1.0 - i as f64 / (nb - 1) as f64).powf(3.2)))
            .collect();
        let normal = normals(p);
        let fibres = (0..12)
            .map(|j| {
                let jf = j as f64;
                let spread = rnds(jf, 71.0) * 34.0;
                let reach = 0.45 + 0.55 * rnd(jf, 72.0);
                let curve = rnds(jf, 73.0);
                let m = ((nf as f64 * reach).round() as usize).max(3);
                (0..m)
                    .map(|i| {
                        let k = nb - 1 + i;
                        let v = i as f64 / (nf - 1) as f64;
                        let offset = spread * v.powf(1.35)
                            + curve * 7.0 * (v * 7.0 + c.quantized * 2.5 + jf).sin() * v;
                        [
                            p[k][0] + normal[k][0] * offset,
                            p[k][1] + normal[k][1] * offset,
                        ]
                    })
                    .collect()
            })
            .collect();
        Self {
            body,
            widths,
            fibres,
        }
    }
    pub fn prepare(&self, out: &mut Vec<Command>, s: &State) {
        for (a, b, scale, blur, mul) in [
            ("th-wide-a", "th-wide", 0.25, 9.0, 2.2),
            ("th-near-a", "th-near", 0.5, 3.0, 1.0),
        ] {
            let size = [(1920.0 * scale) as u32, (1080.0 * scale) as u32];
            let mut d = Draw::new(size[0] as f64, size[1] as f64);
            d.operations = s.camera(1.0);
            d.operations.push(Operation::CopyTransform);
            d.path(
                polyline(&self.body),
                vec![stroke_paint(rgb(255, 74, 48, 1.0), 9.0 * mul, 1.0)],
            );
            let mut fibres = vec![];
            for f in &self.fibres {
                fibres.extend(polyline(f));
            }
            d.path(
                fibres,
                vec![stroke_paint(rgb(255, 74, 48, 1.0), 9.0 * mul * 0.45, 1.0)],
            );
            surface(out, a, size, d);
            let mut blurred = Draw::new(1920.0, 1080.0);
            all(
                &mut blurred,
                a,
                size,
                [0.0, 0.0, size[0] as f64, size[1] as f64],
                "source-over",
                1.0,
                blur,
            );
            surface(out, b, size, blurred);
            release(out, a);
        }
    }
    pub fn draw(&self, d: &mut Draw, s: &State) {
        let camera = d.operations.clone();
        d.operations.clear();
        all(
            d,
            "th-wide",
            [480, 270],
            FRAME,
            "lighter",
            (0.8 + 0.35 * s.arrival) * 0.55,
            0.0,
        );
        // Canvas ignores an invalid globalAlpha assignment. soft() starts at
        // caller alpha=1; the reference's near glow can exceed one at arrival.
        let alpha = 0.8 + 0.35 * s.arrival;
        all(
            d,
            "th-near",
            [960, 540],
            FRAME,
            "lighter",
            if alpha > 1.0 { 1.0 } else { alpha },
            0.0,
        );
        d.operations = camera;
        let n = normals(&self.body);
        let mut path = Vec::new();
        for i in 0..self.body.len() {
            let point = [
                self.body[i][0] + n[i][0] * self.widths[i] / 2.0,
                self.body[i][1] + n[i][1] * self.widths[i] / 2.0,
            ];
            path.push(if i == 0 {
                Step::MoveTo { point }
            } else {
                Step::LineTo { point }
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
        let nb = self.body.len();
        d.path(
            polyline(&self.body[..(nb - 1).max(2)]),
            vec![stroke_paint(rgb(255, 154, 120, 1.0), 1.7 * 0.55, 0.75)],
        );
        for f in &self.fibres {
            for seg in 0..3 {
                let i0 = seg * (f.len() - 1) / 3;
                let i1 = (seg + 1) * (f.len() - 1) / 3;
                if i1 > i0 {
                    d.path(
                        polyline(&f[i0..=i1]),
                        vec![stroke_paint(
                            rgb(255, 154, 120, 1.0),
                            1.1,
                            0.9 * (1.0 - seg as f64 / 3.2),
                        )],
                    );
                }
            }
        }
    }
}
