use super::math::Rng;
type Point = [f64; 3];
pub(super) struct Crack {
    pub main: Vec<[f64; 2]>,
    pub halves: Vec<Vec<Point>>,
    pub reach: f64,
    pub branches: Vec<Vec<Point>>,
    pub ring: Vec<Vec<[f64; 2]>>,
}
fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
fn walk(r: &mut Rng, c: [f64; 2], a0: f64) -> Vec<Point> {
    let (mut x, mut y, mut a, mut l) = (c[0], c[1], a0, 0.0);
    let mut pts = Vec::new();
    while x > -80.0 && x < 2000.0 && y > -80.0 && y < 1160.0 && pts.len() < 128 {
        let st = range(r, 46.0, 130.0);
        a = a0 + (a - a0) * 0.3 + range(r, -0.26, 0.26);
        x += a.cos() * st;
        y += a.sin() * st;
        l += st;
        pts.push([x, y, l]);
    }
    pts
}
pub(super) fn geometry(seed: u32, c: [f64; 2], ang: f64) -> Crack {
    let mut r = Rng::new(f64::from(seed));
    let a = walk(&mut r, c, ang);
    let b = walk(&mut r, c, ang + std::f64::consts::PI);
    let reach = a
        .last()
        .map_or(0.0, |p| p[2])
        .max(b.last().map_or(0.0, |p| p[2]));
    let ea = a.last().copied().unwrap_or([c[0], c[1], 0.0]);
    let eb = b.last().copied().unwrap_or([c[0], c[1], 0.0]);
    let mut main = vec![[eb[0] - ang.cos() * 4000.0, eb[1] - ang.sin() * 4000.0]];
    main.extend(b.iter().rev().map(|p| [p[0], p[1]]));
    main.push(c);
    main.extend(a.iter().map(|p| [p[0], p[1]]));
    main.push([ea[0] + ang.cos() * 4000.0, ea[1] + ang.sin() * 4000.0]);
    let mut branches = Vec::new();
    for i in 0..6 {
        let src = if i % 2 == 1 { &a } else { &b };
        if src.len() < 4 {
            continue;
        }
        let p = src[range(&mut r, 1.0, (src.len() - 2) as f64).floor() as usize];
        let sign = if r.next() < 0.5 { -1.0 } else { 1.0 };
        let (mut x, mut y, mut angle, mut l) = (
            p[0],
            p[1],
            ang + if i % 2 == 0 {
                std::f64::consts::PI
            } else {
                0.0
            } + sign * range(&mut r, 0.45, 1.0),
            p[2],
        );
        let max = range(&mut r, 60.0, 200.0);
        let mut pts = vec![p];
        while l - p[2] < max {
            angle += range(&mut r, -0.2, 0.2);
            let st = range(&mut r, 26.0, 60.0);
            x += angle.cos() * st;
            y += angle.sin() * st;
            l += st;
            pts.push([x, y, l]);
        }
        branches.push(pts);
    }
    for i in 0..9 {
        let a0 = i as f64 / 9.0 * std::f64::consts::TAU + range(&mut r, -0.2, 0.2);
        let (mut x, mut y, mut l) = (c[0], c[1], 0.0);
        let max = range(&mut r, 24.0, 90.0);
        let mut pts = vec![[x, y, l]];
        while l < max {
            let st = range(&mut r, 12.0, 30.0);
            let angle = a0 + range(&mut r, -0.25, 0.25);
            x += angle.cos() * st;
            y += angle.sin() * st;
            l += st;
            pts.push([x, y, l]);
        }
        branches.push(pts);
    }
    let mut ring = Vec::new();
    for i in 0..9 {
        if r.next() < 0.3 {
            continue;
        }
        let radius = range(&mut r, 26.0, 44.0);
        let a0 = i as f64 / 9.0 * std::f64::consts::TAU;
        let a1 = (i + 1) as f64 / 9.0 * std::f64::consts::TAU;
        // Original consumes a separate random radial multiplier for x and y.
        ring.push(vec![
            [c[0] + a0.cos() * radius, c[1] + a0.sin() * radius],
            [
                c[0] + a1.cos() * radius * range(&mut r, 0.9, 1.1),
                c[1] + a1.sin() * radius * range(&mut r, 0.9, 1.1),
            ],
        ]);
    }
    let halves = vec![
        std::iter::once([c[0], c[1], 0.0]).chain(a).collect(),
        std::iter::once([c[0], c[1], 0.0]).chain(b).collect(),
    ];
    Crack {
        main,
        halves,
        reach,
        branches,
        ring,
    }
}
pub(super) fn upto(pts: &[Point], r: f64) -> Vec<[f64; 2]> {
    let mut out = vec![[pts[0][0], pts[0][1]]];
    for pair in pts.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if b[2] <= r {
            out.push([b[0], b[1]]);
        } else {
            let k = ((r - a[2]) / (b[2] - a[2])).clamp(0.0, 1.0);
            out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
            break;
        }
    }
    out
}
