//! Original 12/24fps focus wedges and quantized streaming speed-line paths.
use super::super::{
    math::{Rng, hash},
    rnd,
};
use crate::mv_recipe::model::Color;
use serde::Serialize;
#[derive(Serialize)]
pub struct LinePlan {
    pub triangles: Vec<[[f64; 2]; 3]>,
    pub color: Color,
}
pub(super) fn validate(
    kind: Option<&str>,
    at: Option<[f64; 2]>,
    r: Option<[f64; 2]>,
    color: Option<Color>,
    impact: Option<Color>,
    a: Option<f64>,
    angle: Option<f64>,
    n: Option<u32>,
) -> Result<(), String> {
    if kind.is_some_and(|v| !matches!(v, "focus" | "speed" | "none"))
        || at.is_some_and(|p| p.iter().any(|v| !v.is_finite() || v.abs() > 8192.0))
        || r.is_some_and(|p| p.iter().any(|v| !v.is_finite() || *v <= 0.0 || *v > 8192.0))
        || a.is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        || angle.is_some_and(|v| !v.is_finite() || v.abs() > 100.0)
        || n.is_some_and(|v| !(1..=256).contains(&v))
        || [color, impact]
            .into_iter()
            .flatten()
            .any(|p| p.iter().any(|v| !v.is_finite() || !(0.0..=1.0).contains(v)))
    {
        return Err("ReferencePanels invalid focus/speed line controls".into());
    }
    Ok(())
}
fn gain(mut color: Color, a: f64) -> Color {
    color[3] *= a;
    color
}
fn focus(
    t: f64,
    center: [f64; 2],
    r: [f64; 2],
    color: Color,
    alpha: f64,
    n: u32,
    seed: u32,
    width: f64,
    spread: f64,
    fps: f64,
) -> LinePlan {
    let q = (t * fps + 1e-6).floor();
    let mut rng = Rng::new(f64::from(hash(&[seed as f64, q])));
    let mut triangles = Vec::with_capacity(n as usize);
    for i in 0..n {
        let a = (i as f64 + (-0.45 + 0.9 * rng.next())) / n as f64 * std::f64::consts::TAU;
        let k = 1.0 + rng.next() * spread;
        let hw = width * (0.25 + rng.next() * rng.next() * 1.8);
        triangles.push([
            [
                center[0] + a.cos() * r[0] * k,
                center[1] + a.sin() * r[1] * k,
            ],
            [
                center[0] + (a - hw).cos() * 2600.0,
                center[1] + (a - hw).sin() * 2600.0,
            ],
            [
                center[0] + (a + hw).cos() * 2600.0,
                center[1] + (a + hw).sin() * 2600.0,
            ],
        ]);
    }
    LinePlan {
        triangles,
        color: gain(color, alpha),
    }
}
pub(super) fn plan(
    t: f64,
    index: usize,
    kind: Option<&str>,
    center: [f64; 2],
    r: [f64; 2],
    color: Option<Color>,
    impact_color: Option<Color>,
    alpha: Option<f64>,
    angle: Option<f64>,
    n: Option<u32>,
    impact: f64,
    scale: f64,
    window: [f64; 4],
) -> Vec<LinePlan> {
    let ink = [20.0 / 255.0, 11.0 / 255.0, 30.0 / 255.0, 1.0];
    let paper = [244.0 / 255.0, 239.0 / 255.0, 230.0 / 255.0, 1.0];
    let mut plans = Vec::new();
    if kind == Some("focus") {
        plans.push(focus(
            t,
            center,
            r,
            color.unwrap_or(ink),
            alpha.unwrap_or(0.8),
            110,
            11 + index as u32,
            0.011,
            0.55,
            12.0,
        ));
    }
    if impact > 0.0 {
        let k = impact.clamp(0.0, 1.0);
        let factor = 1.5 + (0.95 - 1.5) * k;
        plans.push(focus(
            t,
            center,
            [r[0] * factor, r[1] * factor],
            impact_color.or(color).unwrap_or(ink),
            1.0 - (1.0 - k).powi(2),
            170,
            99,
            0.014,
            0.4,
            24.0,
        ));
    }
    if kind == Some("speed") {
        let n = n.unwrap_or(70);
        let angle = angle.unwrap_or(-std::f64::consts::FRAC_PI_2);
        let seed = 7.0 + index as f64;
        let ws = 1.0 / scale;
        let span = (window[2] - window[0]).hypot(window[3] - window[1]) + 900.0 * ws;
        let tq = (t * 12.0 + 1e-6).floor() / 12.0;
        let speed = 2600.0 * ws;
        let center = [(window[0] + window[2]) / 2.0, (window[1] + window[3]) / 2.0];
        let mut triangles = Vec::with_capacity(n as usize);
        let map = |x: f64, y: f64| {
            [
                center[0] + x * angle.cos() - y * angle.sin(),
                center[1] + x * angle.sin() + y * angle.cos(),
            ]
        };
        for i in 0..n {
            let i = i as f64;
            let across = (rnd(&[i, seed]) - 0.5) * span;
            let len = (180.0 + 620.0 * rnd(&[i, seed + 1.0])) * ws;
            let w = (0.8 + 3.2 * rnd(&[i, seed + 2.0]).powi(2)) * ws;
            let phase =
                rnd(&[i, seed + 3.0]) + tq * speed * (0.6 + 0.8 * rnd(&[i, seed + 4.0])) / span;
            let along = (phase - phase.floor()) * span - span / 2.0;
            triangles.push([
                map(along, across - w),
                map(along + len, across),
                map(along, across + w),
            ]);
        }
        plans.push(LinePlan {
            triangles,
            color: gain(color.unwrap_or(paper), alpha.unwrap_or(0.6)),
        });
    }
    plans
}
