//! Convex manga-panel reveals/collapse adapted from the reference meta.js
//! mechanism (MIT, NikusonP 2026). Layout/colors/timing are authored, not song data.
use super::{
    evaluate::{lerp, progress},
    panel_model::*,
    validate::{camera, range, span},
};

fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn convex(p: &[[f64; 2]]) -> bool {
    if !(3..=12).contains(&p.len()) || !p.iter().flatten().all(|v| range(*v, 0.0, 1.0)) {
        return false;
    }
    let sign = cross(p[0], p[1], p[2]).signum();
    // Check every non-edge vertex, not just consecutive turns (star polygons).
    (0..p.len()).all(|i| {
        (0..p.len())
            .filter(|j| *j != i && *j != (i + 1) % p.len())
            .all(|j| cross(p[i], p[(i + 1) % p.len()], p[j]) * sign > 1e-8)
    })
}
pub fn valid(
    panels: &[Panel],
    collapse: &Option<Collapse>,
    border: &Option<super::transition_model::Edge>,
    frames: u32,
) -> bool {
    (1..=4).contains(&panels.len())
        && panels.iter().all(|p| {
            convex(&p.polygon)
                && span(&p.opening.span, frames)
                && range(p.opening.angle, -std::f64::consts::PI, std::f64::consts::PI)
                && span(&p.camera.motion, frames)
                && camera(&p.camera.from)
                && camera(&p.camera.to)
        })
        && collapse.as_ref().is_none_or(|c| {
            c.hero < panels.len()
                && span(&c.span, frames)
                && panels.iter().all(|p| {
                    p.opening.span.start_frame + p.opening.span.duration_frames
                        <= c.span.start_frame
                })
        })
        && border
            .as_ref()
            .is_none_or(|e| super::validate::color(&e.color) && range(e.width, 0.0, 0.05))
}
fn clip(p: Vec<[f64; 2]>, n: [f64; 2], limit: f64) -> Vec<[f64; 2]> {
    let mut out = Vec::new();
    for i in 0..p.len() {
        let a = p[i];
        let b = p[(i + 1) % p.len()];
        let da = a[0] * n[0] + a[1] * n[1] - limit;
        let db = b[0] * n[0] + b[1] * n[1] - limit;
        if da <= 0.0 {
            out.push(a);
        }
        if (da <= 0.0) != (db <= 0.0) {
            let t = da / (da - db);
            out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
        }
    }
    out
}
fn expand(p: &[[f64; 2]], grow: f64, w: f64, h: f64) -> Vec<[f64; 2]> {
    let corners = vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]];
    if grow >= 1.0 {
        return corners;
    }
    let sign = cross(p[0], p[1], p[2]).signum();
    let mut out = corners.clone();
    for i in 0..p.len() {
        let a = p[i];
        let b = p[(i + 1) % p.len()];
        let n = [(b[1] - a[1]) * sign, (a[0] - b[0]) * sign];
        let at = a[0] * n[0] + a[1] * n[1];
        let full = corners
            .iter()
            .map(|c| c[0] * n[0] + c[1] * n[1])
            .fold(f64::NEG_INFINITY, f64::max);
        out = clip(out, n, lerp(at, full, grow));
    }
    out
}

/// Output polygon is world-space; transform maps a full source canvas into it.
pub fn geometry(
    p: &Panel,
    frame: u64,
    grow: f64,
    w: f64,
    h: f64,
) -> Option<(Vec<[f64; 2]>, [f64; 6])> {
    let open = progress(frame as f64, &p.opening.span, p.opening.easing);
    if open <= 0.0 {
        return None;
    }
    let raw = p
        .polygon
        .iter()
        .map(|v| [v[0] * w, v[1] * h])
        .collect::<Vec<_>>();
    let full = expand(&raw, grow, w, h);
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for v in &full {
        bounds[0] = bounds[0].min(v[0]);
        bounds[1] = bounds[1].min(v[1]);
        bounds[2] = bounds[2].max(v[0]);
        bounds[3] = bounds[3].max(v[1]);
    }
    let k = progress(frame as f64, &p.camera.motion, p.camera.easing);
    let zoom = lerp(p.camera.from.zoom, p.camera.to.zoom, k);
    let x = lerp(p.camera.from.x, p.camera.to.x, k);
    let y = lerp(p.camera.from.y, p.camera.to.y, k);
    let bw = bounds[2] - bounds[0];
    let bh = bounds[3] - bounds[1];
    let scale = (bw / w).max(bh / h) * zoom;
    let transform = [
        scale,
        0.0,
        0.0,
        scale,
        bounds[0] + (bw - w * scale) * (1.0 + x) / 2.0,
        bounds[1] + (bh - h * scale) * (1.0 + y) / 2.0,
    ];
    if open >= 1.0 {
        return Some((full, transform));
    }
    let n = [p.opening.angle.cos(), p.opening.angle.sin()];
    let values = full
        .iter()
        .map(|v| v[0] * n[0] + v[1] * n[1])
        .collect::<Vec<_>>();
    let lo = values.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some((clip(full, n, lerp(lo, hi, open)), transform))
}
