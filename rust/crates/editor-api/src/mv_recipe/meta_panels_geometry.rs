pub(super) type Point = [f64; 2];
#[derive(Clone)]
pub(super) struct Slot {
    pub poly: Option<Vec<Point>>,
    pub lines: Vec<[f64; 3]>,
    pub dir: Point,
}
pub(super) fn norm(p: Point) -> Point {
    let l = p[0].hypot(p[1]);
    let l = if l == 0.0 { 1.0 } else { l };
    [p[0] / l, p[1] / l]
}
pub(super) fn centroid(p: &[Point]) -> Point {
    let n = p.len() as f64;
    [
        p.iter().map(|p| p[0]).sum::<f64>() / n,
        p.iter().map(|p| p[1]).sum::<f64>() / n,
    ]
}
pub(super) fn clip(p: &[Point], nx: f64, ny: f64, c: f64) -> Vec<Point> {
    let mut out = Vec::new();
    for i in 0..p.len() {
        let (a, b) = (p[i], p[(i + 1) % p.len()]);
        let da = a[0] * nx + a[1] * ny - c;
        let db = b[0] * nx + b[1] * ny - c;
        if da <= 0.0 {
            out.push(a);
        }
        if (da <= 0.0) != (db <= 0.0) {
            let k = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
        }
    }
    out
}
fn hp(a: Point, b: Point, r: Point, off: f64) -> [f64; 3] {
    let [mut nx, mut ny] = norm([a[1] - b[1], b[0] - a[0]]);
    let mut c = nx * a[0] + ny * a[1];
    if nx * r[0] + ny * r[1] - c > 0.0 {
        nx = -nx;
        ny = -ny;
        c = -c;
    }
    [nx, ny, c - off]
}
pub(super) fn defaults(n: usize, g: f64) -> Vec<Slot> {
    let h = 1080.0;
    let w = 1920.0;
    let mut out = Vec::new();
    let mut add = |lines, dir| {
        out.push(Slot {
            poly: None,
            lines,
            dir,
        })
    };
    match n {
        1 => add(vec![], [1.0, 0.0]),
        2 => {
            add(
                vec![hp([1090.0, 0.0], [830.0, h], [0.0, h / 2.0], g / 2.0)],
                [1.0, 0.15],
            );
            add(
                vec![hp([1090.0, 0.0], [830.0, h], [w, h / 2.0], g / 2.0)],
                [-1.0, 0.0],
            );
        }
        3 => {
            add(
                vec![hp([1060.0, 0.0], [905.0, h], [0.0, h / 2.0], g / 2.0)],
                [0.25, 1.0],
            );
            for (r, dir) in [([w, 0.0], [-1.0, 0.08]), ([w, h], [-0.1, -1.0])] {
                add(
                    vec![
                        hp([1060.0, 0.0], [905.0, h], [w, h / 2.0], g / 2.0),
                        hp([0.0, 560.0], [w, 478.0], r, g / 2.0),
                    ],
                    dir,
                );
            }
        }
        _ => {
            add(
                vec![
                    hp([0.0, 405.0], [w, 330.0], [0.0, h], g / 2.0),
                    hp([1135.0, 0.0], [985.0, h], [0.0, h], g / 2.0),
                ],
                [0.25, 1.0],
            );
            add(
                vec![hp([0.0, 405.0], [w, 330.0], [0.0, 0.0], g / 2.0)],
                [-1.0, 0.06],
            );
            for (r, dir) in [([w, 0.0], [-1.0, 0.06]), ([w, h], [-0.1, -1.0])] {
                add(
                    vec![
                        hp([0.0, 405.0], [w, 330.0], [0.0, h], g / 2.0),
                        hp([1135.0, 0.0], [985.0, h], [w, h], g / 2.0),
                        hp([0.0, 742.0], [w, 705.0], r, g / 2.0),
                    ],
                    dir,
                );
            }
        }
    }
    out
}
pub(super) fn poly(slot: &Slot, m: f64, grow: f64) -> Vec<Point> {
    if let Some(p) = &slot.poly {
        if grow == 0.0 {
            return p.clone();
        }
        let c = centroid(p);
        return p
            .iter()
            .map(|p| {
                [
                    p[0] + (c[0] + (p[0] - c[0]) * 4.0 - p[0]) * grow,
                    p[1] + (c[1] + (p[1] - c[1]) * 4.0 - p[1]) * grow,
                ]
            })
            .collect();
    }
    let mut p = vec![
        [m, m],
        [1920.0 - m, m],
        [1920.0 - m, 1080.0 - m],
        [m, 1080.0 - m],
    ];
    for l in &slot.lines {
        p = clip(&p, l[0], l[1], l[2] + grow * 3000.0);
    }
    p
}
pub(super) fn bounds(p: &[Point]) -> [f64; 4] {
    [
        p.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
        p.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
        p.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
        p.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max),
    ]
}
pub(super) fn convex(p: &[Point]) -> bool {
    if !(3..=12).contains(&p.len())
        || p.iter()
            .any(|p| p.iter().any(|v| !v.is_finite() || v.abs() > 8192.0))
    {
        return false;
    }
    let mut sign = 0.0;
    for i in 0..p.len() {
        let (a, b, c) = (p[i], p[(i + 1) % p.len()], p[(i + 2) % p.len()]);
        let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if cross.abs() < 1e-8 {
            return false;
        }
        if sign == 0.0 {
            sign = cross;
        } else if sign * cross < 0.0 {
            return false;
        }
        for (j, q) in p.iter().enumerate() {
            if j == i || j == (i + 1) % p.len() {
                continue;
            }
            let side = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
            if side * sign <= 0.0 {
                return false;
            }
        }
    }
    true
}
