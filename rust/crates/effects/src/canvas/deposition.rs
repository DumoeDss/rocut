use super::{CanvasCell, CanvasConfig, CanvasStroke, TICKS_PER_SECOND};

fn random(seed: u32) -> f64 {
    let mut x = seed.wrapping_add(0x9e3779b9);
    x = (x ^ (x >> 16)).wrapping_mul(0x85ebca6b);
    x = (x ^ (x >> 13)).wrapping_mul(0xc2b2ae35);
    f64::from(x ^ (x >> 16)) / f64::from(u32::MAX)
}
fn sample(source: &[[f64; 4]], nx: usize, ny: usize, uv: [f64; 2]) -> [f64; 4] {
    // Clamp-to-edge bilinear sampling in premultiplied space, never hidden RGB.
    let x = (uv[0] * nx as f64 - 0.5).clamp(0.0, (nx - 1) as f64);
    let y = (uv[1] * ny as f64 - 0.5).clamp(0.0, (ny - 1) as f64);
    let ix = x.floor() as usize;
    let iy = y.floor() as usize;
    let mut out = [0.0; 4];
    for (dx, wx) in [(0, 1.0 - x.fract()), (1, x.fract())] {
        for (dy, wy) in [(0, 1.0 - y.fract()), (1, y.fract())] {
            let p = source[(iy + dy).min(ny - 1) * nx + (ix + dx).min(nx - 1)];
            for k in 0..4 {
                out[k] += p[k] * wx * wy;
            }
        }
    }
    out
}
pub(super) fn deposit(
    c: &CanvasConfig,
    s: &CanvasStroke,
    index: u32,
    start: u64,
    end: u64,
    source: &[[f64; 4]],
    cells: &mut [CanvasCell],
) {
    let nx = c.columns as usize;
    let ny = c.rows as usize;
    let short = nx.min(ny) as f64;
    let domain = [nx as f64 / short, ny as f64 / short];
    let from = [s.from[0] * domain[0], s.from[1] * domain[1]];
    let delta = [
        (s.to[0] - s.from[0]) * domain[0],
        (s.to[1] - s.from[1]) * domain[1],
    ];
    let length = delta[0].hypot(delta[1]);
    let normal = if length > 0.0 {
        [-delta[1] / length, delta[0] / length]
    } else {
        [0.0, 1.0]
    };
    let duration = (s.end_ticks - s.start_ticks) as f64;
    let a = (start - s.start_ticks) as f64 / duration;
    let b = (end - s.start_ticks) as f64 / duration;
    let dt = (end - start) as f64 / TICKS_PER_SECOND as f64;
    for bristle in 0..s.bristles {
        let seed = c
            .seed
            .wrapping_add(index.wrapping_mul(65537))
            .wrapping_add(bristle * 257);
        let offset = ((bristle as f64 + 0.2 + 0.6 * random(seed)) / s.bristles as f64 * 2.0 - 1.0)
            * s.radius;
        let radius = s.radius / (s.bristles as f64) * 0.7;
        let gain = 0.6 + 0.4 * random(seed.wrapping_add(17));
        let p = [
            from[0] + delta[0] * a + normal[0] * offset,
            from[1] + delta[1] * a + normal[1] * offset,
        ];
        let v = [delta[0] * (b - a), delta[1] * (b - a)];
        let vv = v[0] * v[0] + v[1] * v[1];
        for (i, cell) in cells.iter_mut().enumerate() {
            if source[i][3] == 0.0 {
                continue;
            }
            let point = [
                (i % nx) as f64 / short + 0.5 / short,
                (i / nx) as f64 / short + 0.5 / short,
            ];
            let t = if vv == 0.0 {
                0.0
            } else {
                ((point[0] - p[0]) * v[0] + (point[1] - p[1]) * v[1]) / vv
            }
            .clamp(0.0, 1.0);
            let center = [p[0] + v[0] * t, p[1] + v[1] * t];
            let d = (point[0] - center[0]).hypot(point[1] - center[1]);
            let edge = (1.0 - d / (radius + 0.5 / short)).clamp(0.0, 1.0);
            if edge == 0.0 {
                continue;
            }
            let rgba = sample(
                source,
                nx,
                ny,
                [center[0] / domain[0], center[1] / domain[1]],
            );
            let q = 1.0 - (-s.opacity * gain * edge * dt * 20.0 * rgba[3]).exp();
            if q == 0.0 {
                continue;
            }
            for k in 0..3 {
                cell.pigment[k] = cell.pigment[k] * (1.0 - q) + rgba[k] / rgba[3] * q;
            }
            cell.coverage = cell.coverage * (1.0 - q) + q;
            cell.wetness = cell.wetness * (1.0 - q) + s.wetness * q;
            cell.height = cell.height * (1.0 - q) + s.thickness * q;
        }
    }
}
