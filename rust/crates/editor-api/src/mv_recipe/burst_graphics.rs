use super::{
    math,
    plan::native::{Command, Step},
};
use crate::mv_recipe::converge::{Paint, PaintKind, Stop, Style};
use crate::mv_recipe::model::Color;
pub const ID: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub fn c(r: f64, g: f64, b: f64, a: f64) -> Color {
    [r / 255.0, g / 255.0, b / 255.0, a]
}
pub fn alpha(mut c: Color, a: f64) -> Color {
    c[3] *= a;
    c
}
pub fn paint(style: Style, comp: &'static str) -> Paint {
    Paint {
        style,
        composite: comp,
        opacity: 1.0,
        kind: PaintKind::Fill,
    }
}
pub fn rect(out: &mut Vec<Command>, style: Style, comp: &'static str) {
    out.push(Command::Rect {
        transform: ID,
        operations: Vec::new(),
        clip: None,
        rect: [0.0, 0.0, 1920.0, 1080.0],
        paint: paint(style, comp),
    });
}
pub fn fill(out: &mut Vec<Command>, color: Color, comp: &'static str) {
    rect(out, Style::Solid { color }, comp);
}
pub fn radial(out: &mut Vec<Command>, xy: [f64; 2], r0: f64, r: f64, stops: Vec<Stop>) {
    rect(
        out,
        Style::Radial {
            from: [xy[0], xy[1], r0],
            to: [xy[0], xy[1], r],
            stops,
        },
        "source-over",
    );
}
pub fn glow(out: &mut Vec<Command>, xy: [f64; 2], r: f64, color: Color, a: f64) {
    out.push(Command::Rect {
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
                        color: alpha(color, a),
                    },
                    Stop {
                        offset: 0.25,
                        color: alpha(color, a * 0.45),
                    },
                    Stop {
                        offset: 1.0,
                        color: alpha(color, 0.0),
                    },
                ],
            },
            "lighter",
        ),
    });
}
pub fn disc(out: &mut Vec<Command>, xy: [f64; 2], r: f64, color: Color) {
    out.push(Command::Path {
        transform: ID,
        operations: Vec::new(),
        clip: None,
        path: vec![Step::Arc {
            center: xy,
            radius: r,
            start: 0.0,
            end: std::f64::consts::TAU,
            anticlockwise: false,
        }],
        paints: vec![paint(Style::Solid { color }, "source-over")],
    });
}
pub fn grade(out: &mut Vec<Command>, g: f64, k: f64) {
    let night = (1.0 - g).powf(1.1);
    let dawn = -(std::f64::consts::PI * g).cos() / 2.0 + 0.5;
    let mid = (std::f64::consts::PI * g).sin();
    if night > 0.01 {
        fill(out, c(52.0, 66.0, 122.0, 0.55 * night * k), "multiply");
        fill(out, c(10.0, 16.0, 48.0, 0.2 * night * k), "screen");
    }
    if mid > 0.01 {
        fill(out, c(122.0, 74.0, 140.0, 0.22 * mid * k), "soft-light");
    }
    if dawn > 0.01 {
        fill(out, c(255.0, 160.0, 124.0, 0.34 * dawn * k), "soft-light");
        rect(
            out,
            Style::Linear {
                from: [0.0, 0.0],
                to: [0.0, 1080.0],
                stops: vec![
                    Stop {
                        offset: 0.0,
                        color: c(255.0, 190.0, 150.0, 0.0),
                    },
                    Stop {
                        offset: 0.55,
                        color: c(255.0, 170.0, 120.0, 0.0),
                    },
                    Stop {
                        offset: 1.0,
                        color: c(255.0, 184.0, 138.0, 0.55 * 0.7 * dawn * k),
                    },
                ],
            },
            "screen",
        );
    }
}
pub fn speed(out: &mut Vec<Command>, t: f64, k: usize, dir: f64, color: Color, a: f64) {
    let span = 1920.0f64.hypot(1080.0) + 900.0 * 0.7;
    let tq = (t * 24.0 + 1e-6).floor() / 24.0;
    let seed = 30.0 + k as f64;
    let mut path = Vec::new();
    let angle = if dir > 0.0 { std::f64::consts::PI } else { 0.0 };
    let (sn, cs) = angle.sin_cos();
    let point = |x: f64, y: f64| [960.0 + x * cs - y * sn, 540.0 + x * sn + y * cs];
    for i in 0..22 {
        let i = i as f64;
        let across = (math::rnd(i, seed) - 0.5) * span;
        let len = (180.0 + 620.0 * math::rnd(i, seed + 1.0)) * 0.7;
        let w = (0.8 + 3.2 * math::rnd(i, seed + 2.0).powi(2)) * 0.7;
        let along = (math::rnd(i, seed + 3.0)
            + tq * 3600.0 * 0.7 * (0.6 + 0.8 * math::rnd(i, seed + 4.0)) / span)
            .rem_euclid(1.0)
            * span
            - span / 2.0;
        path.extend([
            Step::MoveTo {
                point: point(along, across - w),
            },
            Step::LineTo {
                point: point(along + len, across),
            },
            Step::LineTo {
                point: point(along, across + w),
            },
            Step::Close,
        ]);
    }
    out.push(Command::Path {
        transform: ID,
        operations: Vec::new(),
        clip: None,
        path,
        paints: vec![paint(
            Style::Solid {
                color: alpha(color, a),
            },
            "source-over",
        )],
    });
}
pub fn composite(name: &str) -> &'static str {
    match name {
        "multiply" => "multiply",
        "screen" => "screen",
        "soft-light" => "soft-light",
        "overlay" => "overlay",
        "color" => "color",
        "lighter" => "lighter",
        "lighten" => "lighten",
        _ => "source-over",
    }
}
