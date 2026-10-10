use super::{CanvasCell, CanvasConfig};
fn weave(c: &CanvasConfig, x: f64, y: f64) -> f64 {
    let phase = f64::from(c.seed % 997) / 997.0 * std::f64::consts::TAU;
    let u = x * c.weave_frequency * std::f64::consts::TAU + phase;
    let v = y * c.weave_frequency * std::f64::consts::TAU + phase * 0.7;
    c.weave_height * (u.cos() * 0.45 + v.cos() * 0.45 + u.sin() * v.sin() * 0.1)
}
pub(super) fn shade(c: &CanvasConfig, cells: &[CanvasCell], source: &[[f64; 4]]) -> Vec<[f64; 4]> {
    let nx = c.columns as usize;
    let ny = c.rows as usize;
    let short = nx.min(ny) as f64;
    let h = |x: usize, y: usize| {
        cells[y * nx + x].height + weave(c, (x as f64 + 0.5) / short, (y as f64 + 0.5) / short)
    };
    let ln = c.light.iter().map(|v| v * v).sum::<f64>().sqrt();
    let light = c.light.map(|v| v / ln);
    source
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if p[3] == 0.0 {
                return [0.0; 4];
            }
            let x = i % nx;
            let y = i / nx;
            let gx =
                (h((x + 1).min(nx - 1), y) - h(x.saturating_sub(1), y)) * short * 0.5 * c.relief;
            let gy =
                (h(x, (y + 1).min(ny - 1)) - h(x, y.saturating_sub(1))) * short * 0.5 * c.relief;
            let norm = (gx * gx + gy * gy + 1.0).sqrt();
            let diffuse = ((-gx * light[0] - gy * light[1] + light[2]) / norm).max(0.0);
            let cell = cells[i];
            let shine = cell.wetness * 0.18 * diffuse.powi(24);
            let lighting = 0.65 + 0.35 * diffuse;
            let mut out = [0.0, 0.0, 0.0, p[3]];
            for k in 0..3 {
                let pigment = cell.pigment[k] * p[3] + p[k] * (1.0 - cell.coverage);
                out[k] = (pigment * lighting + shine * p[3]).clamp(0.0, p[3]);
            }
            out
        })
        .collect()
}
