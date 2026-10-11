//! Heart's original radial fracture, including shared jagged cell boundaries.
#[path = "converge_math.rs"]
mod seeded;
use seeded::{Rng, TAU, hash};

pub type Point = [f64; 2];
pub type Path = Vec<Point>;
#[derive(Debug)]
pub struct Edge {
    pub points: Path,
    pub length: f64,
    pub distance: f64,
    pub kind: &'static str,
}
#[derive(Debug)]
pub struct Cell {
    pub polygon: Path,
    pub ring: usize,
    pub center: Point,
    pub area: f64,
}
#[derive(Debug)]
pub struct Fracture {
    pub edges: Vec<Edge>,
    pub cells: Vec<Cell>,
}
fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
fn dist(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
pub fn length(path: &[Point]) -> f64 {
    path.windows(2).map(|p| dist(p[0], p[1])).sum()
}
fn reversed(path: &[Point]) -> Path {
    path.iter().rev().copied().collect()
}
fn jagged(a: Point, b: Point, key: usize) -> Path {
    let len = dist(a, b);
    let mut path = vec![a];
    if len > 2.0 {
        let n = ((len / 20.0 + 0.5).floor() as usize).max(1);
        let nx = -(b[1] - a[1]) / len;
        let ny = (b[0] - a[0]) / len;
        let mut r = Rng::new(hash(&[1807.0, key as f64]) as f64);
        for k in 1..n {
            let f = (k as f64 + range(&mut r, -0.3, 0.3)) / n as f64;
            let off = range(&mut r, -1.0, 1.0) * (len * 0.05).min(6.0);
            path.push([
                a[0] + (b[0] - a[0]) * f + nx * off,
                a[1] + (b[1] - a[1]) * f + ny * off,
            ]);
        }
    }
    path.push(b);
    path
}
fn edge(points: Path, distance: f64, kind: &'static str) -> Edge {
    Edge {
        length: length(&points),
        points,
        distance,
        kind,
    }
}
fn polygon(parts: &[Path]) -> Path {
    let mut out: Path = Vec::new();
    for p in parts.iter().flatten() {
        if out
            .last()
            .is_none_or(|q| (q[0] - p[0]).abs() > 1e-6 || (q[1] - p[1]).abs() > 1e-6)
        {
            out.push(*p);
        }
    }
    if out.len() > 1 {
        let f = out[0];
        let l = out[out.len() - 1];
        if (f[0] - l[0]).abs() < 1e-6 && (f[1] - l[1]).abs() < 1e-6 {
            out.pop();
        }
    }
    out
}
fn cell(parts: &[Path], ring: usize) -> Cell {
    let p = polygon(parts);
    let (mut sx, mut sy, mut sum) = (0.0, 0.0, 0.0);
    for i in 0..p.len() {
        let a = p[i];
        let b = p[(i + 1) % p.len()];
        let c = a[0] * b[1] - b[0] * a[1];
        sum += c;
        sx += (a[0] + b[0]) * c;
        sy += (a[1] + b[1]) * c;
    }
    let center = if (sum * 3.0).abs() < 1e-9 {
        p[0]
    } else {
        [sx / (sum * 3.0), sy / (sum * 3.0)]
    };
    Cell {
        polygon: p,
        ring,
        center,
        area: (sum / 2.0).abs(),
    }
}

pub fn build(center: Point) -> Fracture {
    const NS: usize = 14;
    const RADII: [f64; 9] = [0.0, 26.0, 62.0, 112.0, 172.0, 244.0, 330.0, 440.0, 600.0];
    let mut r = Rng::new(1807.0);
    let gaps: Vec<f64> = (0..NS).map(|_| range(&mut r, 0.45, 1.55)).collect();
    let sum: f64 = gaps.iter().sum();
    let mut acc = r.next() * TAU;
    let mut angles = Vec::new();
    for gap in gaps {
        angles.push(acc);
        acc += gap / sum * TAU;
    }
    let mut vertices = [[center; 9]; NS];
    for i in 0..NS {
        for (j, radius) in RADII.iter().enumerate().skip(1) {
            let radius = radius * (1.0 + range(&mut r, -0.14, 0.14));
            let a = angles[i] + range(&mut r, -0.06, 0.06);
            vertices[i][j] = [center[0] + a.cos() * radius, center[1] + a.sin() * radius];
        }
    }
    let mut spokes: Vec<Vec<Path>> = Vec::new();
    let mut rings: Vec<Vec<Path>> = Vec::new();
    let mut on = [[false; 9]; NS];
    for i in 0..NS {
        spokes.push(
            (0..8)
                .map(|j| jagged(vertices[i][j], vertices[i][j + 1], i * 131 + j))
                .collect(),
        );
        let mut row = Vec::new();
        for j in 0..9 {
            on[i][j] = if j == 8 {
                true
            } else if j == 0 {
                false
            } else {
                r.next() > if j < 3 { 0.15 } else { 0.38 }
            };
            row.push(if j == 0 {
                Vec::new()
            } else {
                jagged(
                    vertices[i][j],
                    vertices[(i + 1) % NS][j],
                    7777 + i * 131 + j,
                )
            });
        }
        rings.push(row);
    }
    let mut edges = Vec::new();
    let mut cells = Vec::new();
    for i in 0..NS {
        for j in 0..8 {
            edges.push(edge(
                spokes[i][j].clone(),
                dist(vertices[i][j], center),
                "spoke",
            ));
        }
    }
    for i in 0..NS {
        for j in 1..8 {
            if on[i][j] {
                let fw = r.next() < 0.5;
                edges.push(edge(
                    if fw {
                        rings[i][j].clone()
                    } else {
                        reversed(&rings[i][j])
                    },
                    dist(vertices[i][j], center).min(dist(vertices[(i + 1) % NS][j], center)) + 6.0,
                    "ring",
                ));
            }
        }
    }
    for i in 0..NS {
        let i2 = (i + 1) % NS;
        let mut j = 0;
        while j < 8 {
            let mut je = j + 1;
            while je < 8 && !on[i][je] {
                je += 1;
            }
            if je - j == 1 && j >= 1 && r.next() < 0.45 {
                let flip = r.next() < 0.5;
                if !flip {
                    let dg = jagged(vertices[i][j], vertices[i2][je], 99999 + i * 131 + j);
                    edges.push(edge(dg.clone(), dist(vertices[i][j], center) + 4.0, "diag"));
                    cells.push(cell(
                        &[spokes[i][j].clone(), rings[i][je].clone(), reversed(&dg)],
                        j,
                    ));
                    cells.push(cell(
                        &[dg, reversed(&spokes[i2][j]), reversed(&rings[i][j])],
                        j,
                    ));
                } else {
                    let dg = jagged(vertices[i2][j], vertices[i][je], 99999 + i * 131 + j);
                    edges.push(edge(
                        dg.clone(),
                        dist(vertices[i2][j], center) + 4.0,
                        "diag",
                    ));
                    cells.push(cell(
                        &[spokes[i][j].clone(), reversed(&dg), reversed(&rings[i][j])],
                        j,
                    ));
                    cells.push(cell(
                        &[dg, rings[i][je].clone(), reversed(&spokes[i2][j])],
                        j,
                    ));
                }
            } else {
                let mut parts: Vec<Path> = (j..je).map(|k| spokes[i][k].clone()).collect();
                parts.push(rings[i][je].clone());
                parts.extend((j..je).rev().map(|k| reversed(&spokes[i2][k])));
                if j > 0 {
                    parts.push(reversed(&rings[i][j]));
                }
                cells.push(cell(&parts, j));
            }
            j = je;
        }
    }
    Fracture { edges, cells }
}

pub fn in_polygon(x: f64, y: f64, p: &[Point]) -> bool {
    let mut inside = false;
    let mut j = p.len().saturating_sub(1);
    for i in 0..p.len() {
        let [xi, yi] = p[i];
        let [xj, yj] = p[j];
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Exact physical-length truncation of original tracePartial; no point-count approximation.
pub fn partial(path: &[Point], fraction: f64, len: f64) -> Path {
    if path.is_empty() {
        return Vec::new();
    }
    let mut out = vec![path[0]];
    let mut remaining = fraction * len;
    for pair in path.windows(2) {
        let a = pair[0];
        let b = pair[1];
        let sl = dist(a, b);
        if sl >= remaining {
            let k = if sl > 0.0 { remaining / sl } else { 0.0 };
            out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
            return out;
        }
        out.push(b);
        remaining -= sl;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_length_and_polygon_tests() {
        let p = vec![[0.0, 0.0], [3.0, 0.0], [3.0, 4.0]];
        assert_eq!(
            partial(&p, 0.5, 7.0),
            vec![[0.0, 0.0], [3.0, 0.0], [3.0, 0.5]]
        );
        assert!(in_polygon(
            1.0,
            1.0,
            &[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]
        ));
        assert!(!in_polygon(
            3.0,
            1.0,
            &[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]
        ));
    }
    #[test]
    fn fracture_is_finite_and_reproducible() {
        let a = build([300.0, 262.3]);
        let b = build([300.0, 262.3]);
        assert_eq!(a.edges.len(), b.edges.len());
        assert_eq!(a.cells.len(), b.cells.len());
        for (x, y) in a.edges.iter().zip(&b.edges) {
            assert_eq!(x.points, y.points);
            assert!(x.length.is_finite() && x.length > 0.0);
        }
        for c in a.cells {
            assert!(c.area.is_finite() && c.area > 0.0);
            assert!(c.center.iter().all(|v| v.is_finite()));
        }
    }
}
