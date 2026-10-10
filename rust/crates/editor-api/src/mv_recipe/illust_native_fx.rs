use super::{
    model::{Fx, Gradient, color, composite, range},
    plan::{Bezier, Command},
};
use crate::mv_recipe::{
    burst::{graphics::*, math, native},
    converge::{Paint, PaintKind, Stop, Style},
    model::{Color, Role},
};
fn num(v: Option<f64>, lo: f64, hi: f64) -> bool {
    v.is_none_or(|v| range(v, lo, hi))
}
fn count(v: Option<u32>) -> bool {
    v.is_none_or(|v| v > 0 && v <= 1024)
}
fn col(v: &Option<Color>) -> bool {
    v.as_ref().is_none_or(color)
}
fn area(v: Option<[f64; 4]>) -> bool {
    v.is_none_or(|v| v.iter().all(|v| range(*v, -8192.0, 8192.0)))
}
pub fn valid(f: &Fx) -> bool {
    match f {
        Fx::Embers {
            n,
            area: a,
            color: c,
            rise,
            size,
            wind,
            alpha,
            ..
        } => {
            count(*n)
                && area(*a)
                && col(c)
                && num(*rise, 0.0, 8192.0)
                && num(*size, 0.1, 128.0)
                && num(*wind, -32.0, 32.0)
                && num(*alpha, 0.0, 1.0)
        }
        Fx::Fireflies {
            n,
            area: a,
            color: c,
            size,
            alpha,
            ..
        } => count(*n) && area(*a) && col(c) && num(*size, 0.1, 128.0) && num(*alpha, 0.0, 1.0),
        Fx::Rain {
            n,
            angle,
            speed,
            len,
            width,
            color: c,
            ..
        } => {
            count(*n)
                && num(*angle, -1.4, 1.4)
                && num(*speed, 0.0, 16384.0)
                && num(*len, 0.1, 8192.0)
                && num(*width, 0.1, 128.0)
                && col(c)
        }
        Fx::Dust { n, color: c, .. } => count(*n) && col(c),
        Fx::Feathers {
            n,
            size,
            color: c,
            line,
            ..
        } => count(*n) && num(*size, 0.01, 16.0) && col(c) && col(line),
        Fx::Rays {
            x,
            y,
            n,
            len,
            color: c,
            amount,
            ..
        } => {
            range(*x, -8192.0, 8192.0)
                && range(*y, -8192.0, 8192.0)
                && count(*n)
                && num(*len, 0.1, 8192.0)
                && col(c)
                && num(*amount, 0.0, 1.0)
        }
        Fx::Glow {
            x,
            y,
            r,
            color: c,
            amount,
            beat,
        } => {
            range(*x, -8192.0, 8192.0)
                && range(*y, -8192.0, 8192.0)
                && range(*r, 0.1, 8192.0)
                && col(c)
                && num(*amount, 0.0, 1.0)
                && num(*beat, 0.0, 1.0)
        }
        Fx::Cracks {
            x,
            y,
            n,
            reach,
            progress,
            at,
            duration,
            color: c,
            width,
            glow,
            ..
        } => {
            num(*x, -8192.0, 8192.0)
                && num(*y, -8192.0, 8192.0)
                && n.is_none_or(|v| v > 0 && v <= 64)
                && num(*reach, 1.0, 8192.0)
                && num(*progress, 0.0, 1.0)
                && num(*at, -21600.0, 21600.0)
                && num(*duration, 0.001, 21600.0)
                && col(c)
                && num(*width, 0.1, 16.0)
                && col(glow)
        }
        Fx::Grad { gradient: g } => {
            !g.stops.is_empty()
                && g.stops.len() <= 32
                && g.stops.iter().all(|(p, c)| range(*p, 0.0, 1.0) && color(c))
                && num(g.amount, 0.0, 1.0)
                && composite(g.composite.as_deref())
        }
        Fx::Fill {
            color: c,
            amount,
            composite: s,
        } => color(c) && num(*amount, 0.0, 1.0) && composite(s.as_deref()),
    }
}
pub fn work(f: &Fx) -> u32 {
    match f {
        Fx::Embers { n, .. } => n.unwrap_or(80),
        Fx::Fireflies { n, .. } => n.unwrap_or(40),
        Fx::Rain { n, .. } => n.unwrap_or(260).saturating_mul(2),
        Fx::Dust { n, .. } => n.unwrap_or(70),
        Fx::Feathers { n, .. } => n.unwrap_or(14).saturating_mul(5),
        Fx::Rays { n, .. } => n.unwrap_or(18).saturating_mul(4),
        Fx::Cracks { n, reach, .. } => n
            .unwrap_or(22)
            .saturating_mul(
                (reach.unwrap_or(1100.0).max(0.0).min(8192.0) / 30.0 + 25.0).ceil() as u32,
            )
            .saturating_mul(2),
        _ => 1,
    }
}
pub fn gradient(g: &Gradient) -> native::Command {
    let mut out = Vec::new();
    rect(
        &mut out,
        Style::Linear {
            from: [0.0, 0.0],
            to: [0.0, 1080.0],
            stops: g
                .stops
                .iter()
                .map(|(offset, color)| Stop {
                    offset: *offset,
                    color: alpha(*color, g.amount.unwrap_or(1.0)),
                })
                .collect(),
        },
        crate::mv_recipe::burst::graphics::composite(
            g.composite.as_deref().unwrap_or("source-over"),
        ),
    );
    out.remove(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_counts_do_not_overflow_budget_before_validation() {
        for kind in ["rain", "feathers", "rays", "cracks"] {
            let mut value = serde_json::json!({"type":kind,"n":u32::MAX});
            if kind == "rays" {
                value["x"] = serde_json::json!(0);
                value["y"] = serde_json::json!(0);
            }
            let fx = serde_json::from_value::<super::Fx>(value).unwrap();
            assert_eq!(super::work(&fx), u32::MAX);
            assert!(!super::valid(&fx));
        }
    }
}
fn fbm(x: f64, seed: f64) -> f64 {
    (0..3)
        .map(|o| 0.5f64.powi(o + 1) * math::noise(x * 2.0f64.powi(o), seed + o as f64 * 17.0))
        .sum()
}
fn particle(
    out: &mut Vec<native::Command>,
    xy: [f64; 2],
    r: f64,
    core: Color,
    col: Color,
    a: f64,
    offset: f64,
    mix: f64,
) {
    out.push(native::Command::Rect {
        transform: ID,
        operations: Vec::new(),
        clip: None,
        rect: [xy[0] - r, xy[1] - r, r * 2.0, r * 2.0],
        paint: paint(
            Style::Radial {
                from: [xy[0], xy[1], 0.0],
                to: [xy[0], xy[1], r],
                stops: vec![
                    Stop {
                        offset: 0.0,
                        color: alpha(core, a),
                    },
                    Stop {
                        offset,
                        color: alpha(col, a * mix),
                    },
                    Stop {
                        offset: 1.0,
                        color: alpha(col, 0.0),
                    },
                ],
            },
            "lighter",
        ),
    });
}
pub fn produce(f: &Fx, t: f64, lt: f64, pulse: f64, role: Role) -> Vec<Command> {
    let mut native = Vec::new();
    let mut out = Vec::new();
    match f {
        Fx::Embers {
            n,
            seed,
            area,
            color,
            rise,
            size,
            wind,
            alpha: a,
        } => {
            let seed = seed.unwrap_or(11) as f64;
            let [x0, y0, x1, y1] = area.unwrap_or([0.0, 0.0, 1920.0, 1080.0]);
            for i in 0..n.unwrap_or(80) {
                let i = i as f64;
                let life = 3.0 + 4.0 * math::rnd(i, seed);
                let k = ((t + math::rnd(i, seed + 1.0) * life) / life).rem_euclid(1.0);
                let x = x0
                    + (x1 - x0) * math::rnd(i, seed + 2.0)
                    + (t * (0.6 + math::rnd(i, seed + 3.0)) + i).sin() * 30.0 * k
                    + wind.unwrap_or(0.0) * k * 200.0;
                let y =
                    y1 + (y0 - y1) * math::rnd(i, seed + 4.0) - k * rise.unwrap_or(120.0) * life;
                let a = (k * std::f64::consts::PI).sin()
                    * (0.55 + 0.45 * (t * 13.0 + i * 3.1).sin())
                    * a.unwrap_or(1.0);
                let r = size.unwrap_or(3.0) * (0.5 + math::rnd(i, seed + 5.0)) * (1.0 - k * 0.5);
                if a > 0.01 {
                    particle(
                        &mut native,
                        [x, y],
                        r * 4.0,
                        c(255.0, 241.0, 208.0, 1.0),
                        color.unwrap_or(c(255.0, 165.0, 82.0, 1.0)),
                        a,
                        0.3,
                        0.8,
                    );
                }
            }
        }
        Fx::Fireflies {
            n,
            seed,
            area,
            color,
            size,
            alpha: a,
        } => {
            let seed = seed.unwrap_or(21) as f64;
            let [x0, y0, x1, y1] = area.unwrap_or([0.0, 324.0, 1920.0, 1080.0]);
            for i in 0..n.unwrap_or(40) {
                let i = i as f64;
                let x = x0 + (x1 - x0) * math::rnd(i, seed) + fbm(t * 0.25 + i, seed) * 160.0;
                let y = y0
                    + (y1 - y0) * math::rnd(i, seed + 1.0)
                    + fbm(t * 0.22 + i * 1.7, seed + 5.0) * 90.0;
                let blink = (t * (0.9 + math::rnd(i, seed + 2.0)) + i * 2.3)
                    .sin()
                    .clamp(0.0, 1.0)
                    .powi(3)
                    * a.unwrap_or(1.0);
                if blink >= 0.02 {
                    let r = size.unwrap_or(3.0) * (0.7 + math::rnd(i, seed + 3.0) * 0.8);
                    particle(
                        &mut native,
                        [x, y],
                        r * 7.0,
                        c(246.0, 255.0, 224.0, 1.0),
                        color.unwrap_or(c(221.0, 255.0, 122.0, 1.0)),
                        blink,
                        0.2,
                        0.7,
                    );
                }
            }
        }
        Fx::Rain {
            n,
            seed,
            angle,
            speed,
            len,
            width,
            color,
        } => {
            let seed = seed.unwrap_or(31) as f64;
            let ang = angle.unwrap_or(0.18);
            let len = len.unwrap_or(60.0);
            let mut path = Vec::new();
            for i in 0..n.unwrap_or(260) {
                let i = i as f64;
                let x = math::rnd(i, seed) * 2320.0 - 200.0;
                let y = (math::rnd(i, seed + 1.0)
                    + t * speed.unwrap_or(1900.0) / 1280.0
                        * (0.8 + 0.4 * math::rnd(i, seed + 2.0)))
                .rem_euclid(1.0)
                    * 1280.0
                    - 100.0;
                path.extend([
                    native::Step::MoveTo {
                        point: [x + y * ang.tan(), y],
                    },
                    native::Step::LineTo {
                        point: [x + y * ang.tan() + ang.sin() * len, y + ang.cos() * len],
                    },
                ]);
            }
            native.push(native::Command::Path {
                transform: ID,
                operations: Vec::new(),
                clip: None,
                path,
                paints: vec![Paint {
                    style: Style::Solid {
                        color: color.unwrap_or(c(200.0, 220.0, 255.0, 0.35)),
                    },
                    composite: "source-over",
                    opacity: 1.0,
                    kind: PaintKind::Stroke {
                        width: width.unwrap_or(1.4),
                        cap: "butt",
                        join: "miter",
                    },
                }],
            });
        }
        Fx::Dust { n, seed, color } => {
            let seed = seed.unwrap_or(41) as f64;
            for i in 0..n.unwrap_or(70) {
                let i = i as f64;
                let x = (math::rnd(i, seed) + t * 0.004 * (1.0 + math::rnd(i, seed + 3.0)))
                    .rem_euclid(1.0)
                    * 1920.0;
                let y = (math::rnd(i, seed + 1.0) + (t * 0.3 + i).sin() * 0.01 - t * 0.003)
                    .rem_euclid(1.0)
                    * 1080.0;
                disc(
                    &mut native,
                    [x, y],
                    0.8 + 2.2 * math::rnd(i, seed + 2.0),
                    alpha(
                        color.unwrap_or(c(255.0, 230.0, 190.0, 0.5)),
                        0.3 + 0.7 * (t * 0.7 + i).sin().abs(),
                    ),
                );
            }
        }
        Fx::Feathers {
            n,
            seed,
            size,
            color,
            line,
        } => {
            let seed = seed.unwrap_or(51) as f64;
            for i in 0..n.unwrap_or(14) {
                let i = i as f64;
                let life = 6.0 + 4.0 * math::rnd(i, seed);
                let k = ((t + math::rnd(i, seed + 1.0) * life) / life).rem_euclid(1.0);
                let x = math::rnd(i, seed + 2.0) * 1920.0 + (k * 7.0 + i).sin() * 120.0;
                let y = -80.0 + k * 1240.0;
                let rot = (k * 9.0 + i).sin() * 0.9;
                let s = (0.6 + math::rnd(i, seed + 3.0) * 0.8) * size.unwrap_or(1.0);
                let (sn, co) = rot.sin_cos();
                out.push(Command::Feather {
                    role,
                    transform: [co * s, sn * s, -sn * s, co * s, x, y],
                    color: color.unwrap_or(c(244.0, 239.0, 230.0, 0.92)),
                    line: line.unwrap_or(c(20.0, 11.0, 30.0, 0.9)),
                    body: vec![
                        Bezier::Move {
                            point: [0.0, -46.0],
                        },
                        Bezier::Cubic {
                            points: [16.0, -30.0, 18.0, 10.0, 2.0, 44.0],
                        },
                        Bezier::Cubic {
                            points: [-14.0, 16.0, -16.0, -24.0, 0.0, -46.0],
                        },
                    ],
                    spine: vec![
                        Bezier::Move {
                            point: [0.0, -40.0],
                        },
                        Bezier::Quadratic {
                            points: [3.0, 0.0, 1.0, 50.0],
                        },
                    ],
                });
            }
        }
        Fx::Rays {
            x,
            y,
            n,
            len,
            color,
            amount,
            seed,
        } => {
            let n = n.unwrap_or(18);
            let seed = seed.unwrap_or(3) as f64;
            let len = len.unwrap_or(1400.0);
            let color = color.unwrap_or(c(255.0, 165.0, 82.0, 1.0));
            for i in 0..n {
                let i = i as f64;
                let ang =
                    i / n as f64 * std::f64::consts::TAU + math::rnds(i, seed) * 0.2 + t * 0.02;
                let width = 0.02 + 0.05 * math::rnd(i, seed + 1.0);
                let al = amount.unwrap_or(0.18)
                    * (0.3 + 0.7 * math::rnd(i, seed + 2.0))
                    * (0.6 + 0.4 * (t * 0.8 + i).sin());
                native.push(native::Command::Path {
                    transform: ID,
                    operations: Vec::new(),
                    clip: None,
                    path: vec![
                        native::Step::MoveTo { point: [*x, *y] },
                        native::Step::Arc {
                            center: [*x, *y],
                            radius: len,
                            start: ang - width,
                            end: ang + width,
                            anticlockwise: false,
                        },
                        native::Step::Close,
                    ],
                    paints: vec![paint(
                        Style::Radial {
                            from: [*x, *y, 0.0],
                            to: [*x, *y, len],
                            stops: vec![
                                Stop {
                                    offset: 0.0,
                                    color: alpha(color, al),
                                },
                                Stop {
                                    offset: 1.0,
                                    color: alpha(color, 0.0),
                                },
                            ],
                        },
                        "lighter",
                    )],
                });
            }
        }
        Fx::Glow {
            x,
            y,
            r,
            color,
            amount,
            beat,
        } => glow(
            &mut native,
            [*x, *y],
            *r,
            color.unwrap_or(c(255.0, 165.0, 82.0, 1.0)),
            amount.unwrap_or(0.8) * (1.0 + beat.unwrap_or(0.0) * pulse),
        ),
        Fx::Cracks {
            seed,
            x,
            y,
            n,
            reach,
            progress,
            at,
            duration,
            color,
            width,
            glow,
        } => {
            out.extend(cracks(
                seed.unwrap_or(1),
                [x.unwrap_or(960.0), y.unwrap_or(324.0)],
                n.unwrap_or(22),
                reach.unwrap_or(1100.0),
                progress
                    .unwrap_or((lt - at.unwrap_or(0.0)) / duration.unwrap_or(1.2))
                    .clamp(0.0, 1.0),
                color.unwrap_or(c(255.0, 243.0, 214.0, 1.0)),
                glow.unwrap_or(c(255.0, 165.0, 82.0, 1.0)),
                width.unwrap_or(1.0),
                role,
            ));
        }
        Fx::Grad { gradient: g } => native.push(gradient(g)),
        Fx::Fill {
            color,
            amount,
            composite: c,
        } => fill(
            &mut native,
            alpha(*color, amount.unwrap_or(0.5)),
            crate::mv_recipe::burst::graphics::composite(c.as_deref().unwrap_or("source-over")),
        ),
    }
    out.extend(
        native
            .into_iter()
            .map(|command| Command::Native { role, command }),
    );
    out
}
fn cracks(
    seed: u32,
    xy: [f64; 2],
    n: u32,
    reach: f64,
    progress: f64,
    core: Color,
    glow: Color,
    width: f64,
    role: Role,
) -> Vec<Command> {
    let mut rng = math::Rng::new(seed as f64);
    let mut lines: Vec<(Vec<[f64; 2]>, f64, f64)> = Vec::new();
    for i in 0..n {
        let mut a = i as f64 / n as f64 * std::f64::consts::TAU - 0.12 + rng.next() * 0.24;
        let (mut x, mut y) = (xy[0], xy[1]);
        let mut pts = vec![[x, y]];
        let mut l = 0.0;
        let max_l = reach * (0.45 + rng.next() * 0.55);
        while l < max_l {
            let st = 30.0 + rng.next() * 60.0;
            a += -0.28 + rng.next() * 0.56;
            x += a.cos() * st;
            y += a.sin() * st;
            l += st;
            pts.push([x, y]);
        }
        lines.push((pts, 1.2 + rng.next() * 2.4, 0.0));
    }
    for ring in 1..=4 {
        let rr = ring as f64 * reach * (0.12 + rng.next() * 0.08);
        for i in 0..n {
            if rng.next() < 0.35 {
                continue;
            }
            let a0 = i as f64 / n as f64 * std::f64::consts::TAU;
            let a1 = (i + 1) as f64 / n as f64 * std::f64::consts::TAU;
            let mut pts = Vec::new();
            for k in 0..=4 {
                let a = a0 + (a1 - a0) * k as f64 / 4.0;
                let r = rr * (0.9 + rng.next() * 0.2);
                pts.push([xy[0] + a.cos() * r, xy[1] + a.sin() * r]);
            }
            lines.push((pts, 0.8 + rng.next() * 1.2, ring as f64 * 0.18));
        }
    }
    let progress = 1.0 - (1.0 - progress).powi(3);
    let mut out = Vec::new();
    for (color, mul, a, comp, blur) in [
        (glow, 5.0, 0.55, "lighter", 4.0),
        (core, 1.0, 1.0, "source-over", 0.0),
    ] {
        for (pts, w, d0) in &lines {
            let local = ((progress - d0) / (1.0 - d0 + 1e-6)).clamp(0.0, 1.0);
            if local <= 0.0 {
                continue;
            }
            let upto = local * (pts.len() - 1) as f64;
            let mut path = vec![native::Step::MoveTo { point: pts[0] }];
            for i in 1..pts.len() {
                if i as f64 > upto + 1.0 {
                    break;
                }
                let f = (upto - (i - 1) as f64).min(1.0);
                path.push(native::Step::LineTo {
                    point: [
                        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
                        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
                    ],
                });
            }
            out.push(Command::Path {
                role,
                path,
                color: alpha(color, a),
                width: w * mul * width,
                blur_px: blur,
                composite: comp,
            });
        }
    }
    out
}
