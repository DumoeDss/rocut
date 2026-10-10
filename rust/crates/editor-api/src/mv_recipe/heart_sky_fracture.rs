//! Sky's original radial fracture, including shared jagged cell boundaries.
#[path = "converge_math.rs"]
mod seeded;
use seeded::{hash, Rng, TAU};

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
fn jagged(a: Point, b: Point, key: usize, seed: u32) -> Path {
    let len = dist(a, b);
    let mut path = vec![a];
    if len > 2.0 {
        let n = ((len / 34.0 + 0.5).floor() as usize).max(1);
        let nx = -(b[1] - a[1]) / len;
        let ny = (b[0] - a[0]) / len;
        let mut r = Rng::new(hash(&[seed as f64, key as f64]) as f64);
        for k in 1..n {
            let f = (k as f64 + range(&mut r, -0.3, 0.3)) / n as f64;
            let off = range(&mut r, -1.0, 1.0) * (len * 0.035).min(12.0);
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

pub fn build(seed: u32, center: Point) -> Fracture {
    const NS: usize = 17;
    const RADII: [f64; 11] = [
        0.0, 60.0, 150.0, 270.0, 430.0, 630.0, 880.0, 1190.0, 1560.0, 2050.0, 2700.0,
    ];
    let mut r = Rng::new(seed as f64);
    let jagged = |a, b, key| jagged(a, b, key, seed);
    let gaps: Vec<f64> = (0..NS).map(|_| range(&mut r, 0.45, 1.55)).collect();
    let sum: f64 = gaps.iter().sum();
    let mut acc = r.next() * TAU;
    let mut angles = Vec::new();
    for gap in gaps {
        angles.push(acc);
        acc += gap / sum * TAU;
    }
    let mut vertices = [[center; 11]; NS];
    for i in 0..NS {
        for (j, radius) in RADII.iter().enumerate().skip(1) {
            let radius = radius * (1.0 + range(&mut r, -0.12, 0.12));
            let a = angles[i] + range(&mut r, -0.05, 0.05);
            vertices[i][j] = [center[0] + a.cos() * radius, center[1] + a.sin() * radius];
        }
    }
    let mut spokes: Vec<Vec<Path>> = Vec::new();
    let mut rings: Vec<Vec<Path>> = Vec::new();
    let mut on = [[false; 11]; NS];
    for i in 0..NS {
        spokes.push(
            (0..10)
                .map(|j| jagged(vertices[i][j], vertices[i][j + 1], i * 131 + j))
                .collect(),
        );
        let mut row = Vec::new();
        for j in 0..11 {
            on[i][j] = if j == 10 {
                true
            } else if j == 0 {
                false
            } else {
                r.next() > if j < 3 { 0.1 } else { 0.3 }
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
        for j in 0..10 {
            edges.push(edge(
                spokes[i][j].clone(),
                dist(vertices[i][j], center),
                "spoke",
            ));
        }
    }
    for i in 0..NS {
        for j in 1..10 {
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
        while j < 10 {
            let mut je = j + 1;
            while je < 10 && !on[i][je] {
                je += 1;
            }
            if je - j == 1 && j >= 1 && r.next() < 0.42 {
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
