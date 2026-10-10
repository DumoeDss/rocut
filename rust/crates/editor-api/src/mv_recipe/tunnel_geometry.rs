use super::{
    draw::*,
    math::*,
    model::Metrics,
    objects::{Kind, Object},
    plan::*,
};
pub(super) struct Camera {
    pub vp: [f64; 2],
    pub roll: f64,
    pub f: f64,
}
impl Camera {
    pub fn project(&self, x: f64, y: f64, z: f64) -> [f64; 3] {
        let (s, c) = self.roll.sin_cos();
        let k = self.f / z;
        [
            self.vp[0] + (x * c - y * s) * k,
            self.vp[1] + (x * s + y * c) * k,
            k,
        ]
    }
}
fn ring(o: &Object, z: f64, r: f64, th: f64) -> [f64; 3] {
    let x = r * th.cos();
    let y0 = r * th.sin();
    let y = y0 * o.tilt[0].cos();
    let zz = y0 * o.tilt[0].sin();
    [
        x * o.tilt[1].cos() + zz * o.tilt[1].sin(),
        y,
        z - x * o.tilt[1].sin() + zz * o.tilt[1].cos(),
    ]
}
fn projected(cam: &Camera, p: [f64; 3]) -> [f64; 2] {
    let q = cam.project(p[0], p[1], p[2]);
    [q[0], q[1]]
}
fn stroke_paint(color: [f64; 4], width: f64, comp: &'static str) -> Paint {
    let mut p = stroke(solid(color), width, "butt", "miter");
    p.composite = comp;
    p
}
pub(super) struct Light {
    pub rgb: [f64; 4],
    pub alpha: f64,
    pub silhouette: f64,
    pub passing: f64,
    pub glow: f64,
}
#[allow(clippy::too_many_arguments)]
pub(super) fn draw(
    d: &mut Draw,
    o: &Object,
    z: f64,
    lt: f64,
    cam: &Camera,
    l: &Light,
    m: &Metrics,
    visits: &mut usize,
) -> Result<(), String> {
    let comp = if l.silhouette > 0.4 {
        "source-over"
    } else {
        "lighter"
    };
    let k = cam.f / z;
    match &o.kind {
        Kind::Text(w) => text(d, o, z, lt, cam, l, m, w, false, comp, visits)?,
        Kind::Latin(w) => text(d, o, z, lt, cam, l, m, w, true, comp, visits)?,
        Kind::Circle | Kind::Dial => {
            if matches!(o.kind, Kind::Dial) {
                let mut path = vec![];
                for i in 0..120 {
                    let th = o.phase + o.spin * lt + i as f64 / 120.0 * TAU;
                    let len = if i % 10 == 0 {
                        0.17
                    } else if i % 5 == 0 {
                        0.09
                    } else {
                        0.04
                    };
                    let p = ring(o, z, o.radius.unwrap(), th);
                    let q = ring(o, z, o.radius.unwrap() + len, th);
                    if p[2] < 0.2 || q[2] < 0.2 {
                        continue;
                    }
                    path.extend(line(projected(cam, p), projected(cam, q)));
                }
                d.path(
                    path,
                    vec![stroke_paint(
                        css(l.rgb, l.alpha * (0.5 + 0.5 * l.passing)),
                        (0.009 * k).max(1.0),
                        comp,
                    )],
                );
            }
            let mut path = vec![];
            let mut first = true;
            for i in 0..=96 {
                let p = ring(o, z, o.radius.unwrap(), i as f64 / 96.0 * TAU);
                if p[2] < 0.2 {
                    first = true;
                    continue;
                }
                let point = projected(cam, p);
                path.push(if first {
                    Step::MoveTo { point }
                } else {
                    Step::LineTo { point }
                });
                first = false;
            }
            let dial = matches!(o.kind, Kind::Dial);
            d.path(
                path,
                vec![stroke_paint(
                    css(
                        l.rgb,
                        l.alpha * if dial { 0.5 + 0.5 * l.passing } else { 0.6 },
                    ),
                    (if dial { 0.005 } else { 0.01 } * k).max(1.0),
                    comp,
                )],
            );
        }
        Kind::Frame => {
            let mut path = vec![];
            for i in 0..=4 {
                let th = o.rot + i as f64 / 4.0 * TAU + std::f64::consts::FRAC_PI_4;
                let q = cam.project(
                    th.cos() * o.radius.unwrap() * 1.414,
                    th.sin() * o.radius.unwrap() * 1.414,
                    z,
                );
                let point = [q[0], q[1]];
                path.push(if i == 0 {
                    Step::MoveTo { point }
                } else {
                    Step::LineTo { point }
                });
            }
            d.path(
                path,
                vec![stroke_paint(
                    css(l.rgb, l.alpha * 0.45),
                    (0.012 * k).max(1.0),
                    comp,
                )],
            );
        }
        Kind::Cross => cross(d, o, z, cam, l),
    }
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn text(
    d: &mut Draw,
    o: &Object,
    z: f64,
    lt: f64,
    cam: &Camera,
    l: &Light,
    m: &Metrics,
    w: &str,
    latin: bool,
    comp: &'static str,
    visits: &mut usize,
) -> Result<(), String> {
    let mut chars: Vec<_> = w.chars().collect();
    if latin {
        chars.extend("   ·   ".chars());
    } else {
        chars.extend(['　', '・', '　']);
    }
    let gs = o.gs
        * if !latin && w.encode_utf16().count() <= 2 {
            1.5
        } else {
            1.0
        };
    let advs: Vec<f64> = chars
        .iter()
        .map(|ch| {
            Ok((if *ch == '　' {
                0.55
            } else if *ch == '・' {
                0.6
            } else {
                m.width(*ch, latin)? / 100.0
            }) * gs
                * if latin { 1.25 } else { 1.06 })
        })
        .collect::<Result<_, String>>()?;
    let unit: f64 = advs.iter().sum();
    let circ = TAU * o.radius.unwrap();
    let reps = (circ / unit).floor().max(1.0) as usize;
    if reps > 8192 || reps.checked_mul(chars.len()).is_none_or(|n| n > 32768) {
        return Err("tunnel glyph ring iteration budget exceeded".into());
    }
    *visits += reps * chars.len();
    if *visits > 262144 {
        return Err("tunnel total glyph visit budget exceeded".into());
    }
    let scale = circ / (reps as f64 * unit);
    let mut th = o.phase + o.spin * lt;
    let color = css(
        mix(
            l.rgb,
            if l.silhouette > 0.5 {
                l.rgb
            } else {
                rgb(0xffffff)
            },
            l.passing * 0.5,
        ),
        (l.alpha * if latin { 0.5 } else { 1.0 } * (1.0 + 0.5 * l.passing)).min(1.0),
    );
    for _ in 0..reps {
        for (ch, adv) in chars.iter().zip(&advs) {
            let dt = adv * scale / o.radius.unwrap();
            let center = th + dt / 2.0;
            th += dt;
            if *ch == '　' {
                continue;
            }
            let p = ring(o, z, o.radius.unwrap(), center);
            let q = ring(o, z, o.radius.unwrap(), center + 0.01);
            if p[2] < 0.2 {
                continue;
            }
            let p = cam.project(p[0], p[1], p[2]);
            let q = cam.project(q[0], q[1], q[2]);
            let px = gs * p[2];
            if p[0] < -px || p[0] > 1920.0 + px || p[1] < -px || p[1] > 1080.0 + px {
                continue;
            }
            d.commands.push(Command::StackText {
                font_stack: m.stack(if latin { "dot400" } else { "mincho800" }),
                text: ch.to_string(),
                font_size: 100.0,
                tracking: 0.0,
                position: [0.0, 0.0],
                transform: d.identity(),
                operations: vec![
                    Operation::Translate {
                        offset: [p[0], p[1]],
                    },
                    Operation::Rotate {
                        radians: (q[1] - p[1]).atan2(q[0] - p[0]),
                    },
                    Operation::Scale {
                        factors: [px / 100.0; 2],
                    },
                ],
                fill: TextFill::Color { color },
                opacity: 1.0,
                composite: comp,
                align: "center",
                baseline: "middle",
            });
        }
    }
    Ok(())
}
fn cross(d: &mut Draw, o: &Object, z: f64, cam: &Camera, l: &Light) {
    let p = cam.project(o.x, o.y, z);
    let len = o.size * p[2];
    let w = 0.12 * o.size * p[2];
    if len < 4.0 {
        return;
    }
    let rect = [-len / 2.0, -w / 2.0, len, w];
    for a in [std::f64::consts::FRAC_PI_4, -std::f64::consts::FRAC_PI_4] {
        d.operations = vec![
            Operation::Translate {
                offset: [p[0], p[1]],
            },
            Operation::Rotate { radians: o.rot },
            Operation::Rotate { radians: a },
        ];
        // Original rect path/fill rather than a substitute fillRect.
        d.path(
            vec![Step::Rect { rect }],
            vec![fill(
                solid(css(mix(rgb(0x120a1c), rgb(0x2a1530), l.glow), l.alpha)),
                "source-over",
            )],
        );
        d.clip = Some(Clip {
            transform: d.identity(),
            operations: d.operations.clone(),
            path: vec![Step::Rect { rect }],
        });
        let sw = w * 1.1;
        let mut xx = -len / 2.0 - w;
        while xx < len / 2.0 + w {
            d.path(
                vec![
                    Step::MoveTo {
                        point: [xx, w / 2.0],
                    },
                    Step::LineTo {
                        point: [xx + sw, w / 2.0],
                    },
                    Step::LineTo {
                        point: [xx + sw + w, -w / 2.0],
                    },
                    Step::LineTo {
                        point: [xx + w, -w / 2.0],
                    },
                    Step::Close,
                ],
                vec![fill(
                    solid(css(
                        mix(rgb(0xd9a441), rgb(0xffd9a0), l.glow),
                        l.alpha * (0.75 - 0.35 * l.silhouette),
                    )),
                    "source-over",
                )],
            );
            xx += sw * 2.0;
        }
        d.clip = None;
        d.path(
            vec![Step::Rect { rect }],
            vec![stroke_paint(
                css(
                    mix(rgb(0xffe0c0), rgb(0xfff4e0), l.glow),
                    l.alpha * (0.35 + 0.4 * l.glow),
                ),
                (w * 0.08).max(1.0),
                "source-over",
            )],
        );
    }
    d.operations.clear();
}
