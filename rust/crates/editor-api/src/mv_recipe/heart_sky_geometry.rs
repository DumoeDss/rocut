//! Original skyBuild retained cell selection, seeded piece metadata and foreground selection.
#[path = "heart_sky_fracture.rs"]
pub mod fracture;
#[path = "converge_math.rs"]
mod seeded;
pub const SIZE: [u32; 2] = [2200, 1360];
#[derive(Debug)]
pub struct Piece {
    pub polygon: Vec<[f64; 2]>,
    pub position: [f64; 2],
    pub ring: usize,
    pub distance: f64,
    pub near: f64,
    pub direction: [f64; 2],
    pub angle: f64,
    pub size: f64,
    pub gravity: f64,
    pub velocity: [f64; 2],
    pub spin_velocity: f64,
    pub spin_acceleration: f64,
    pub axis: f64,
    pub flip_velocity: f64,
    pub glow_phase: f64,
    pub jitter: f64,
    pub foreground: bool,
    pub z: f64,
    pub origin: [f64; 2],
    pub sprite_size: [u32; 2],
}
pub fn bounds(p: &[[f64; 2]]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for [x, y] in p {
        b[0] = b[0].min(*x);
        b[1] = b[1].min(*y);
        b[2] = b[2].max(*x);
        b[3] = b[3].max(*y);
    }
    b
}
fn range(r: &mut seeded::Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
pub fn build(seed: u32, impact: [f64; 2]) -> Result<Vec<Piece>, &'static str> {
    if impact.iter().any(|v| !v.is_finite() || v.abs() > 8192.0) {
        return Err("Invalid sky impact");
    }
    let center = [impact[0] + 140.0, impact[1] + 140.0];
    let fr = fracture::build(seed, center);
    let cells: Vec<_> = fr
        .cells
        .into_iter()
        .filter(|c| {
            let b = bounds(&c.polygon);
            c.area > 300.0 && b[2] > 0.0 && b[0] < 2200.0 && b[3] > 0.0 && b[1] < 1360.0
        })
        .collect();
    let max_d = cells
        .iter()
        .map(|c| (c.center[0] - center[0]).hypot(c.center[1] - center[1]))
        .fold(1.0, f64::max);
    let mut r = seeded::Rng::new(seed as f64 + 5.0);
    let mut pieces = Vec::new();
    for c in cells {
        let dx = c.center[0] - center[0];
        let dy = c.center[1] - center[1];
        let dd = dx.hypot(dy);
        let dd = if dd == 0.0 { 1.0 } else { dd };
        let near = 1.0 - dd / max_d;
        let b = bounds(&c.polygon);
        let origin = [(b[0] - 22.0).floor(), (b[1] - 22.0).floor()];
        let sw = ((b[2] + 22.0).ceil() - origin[0]).max(2.0);
        let sh = ((b[3] + 22.0).ceil() - origin[1]).max(2.0);
        if sw > 4096.0 || sh > 4096.0 {
            return Err("Sky shard scratch exceeds dimension limit");
        }
        let size = c.area.sqrt();
        pieces.push(Piece {
            polygon: c.polygon,
            position: c.center,
            ring: c.ring,
            distance: dd,
            near,
            direction: [dx / dd, dy / dd],
            angle: dy.atan2(dx),
            size,
            gravity: 1500.0 / (size / 100.0).max(1.0).sqrt() * range(&mut r, 0.85, 1.15),
            velocity: [range(&mut r, 15.0, 60.0), range(&mut r, -30.0, 5.0)],
            spin_velocity: range(&mut r, -0.18, 0.18),
            spin_acceleration: range(&mut r, -0.35, 0.35),
            axis: r.next() * std::f64::consts::PI,
            flip_velocity: range(&mut r, 0.6, 1.5) * if r.next() < 0.5 { -1.0 } else { 1.0 },
            glow_phase: r.next() * std::f64::consts::TAU,
            jitter: r.next(),
            foreground: false,
            z: range(&mut r, 0.03, 0.14),
            origin,
            sprite_size: [sw as u32, sh as u32],
        });
    }
    let mut upper: Vec<_> = pieces
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p.position[1] < 680.0 && p.position[1] > 200.0 && p.size > 230.0 && p.near < 0.7
        })
        .map(|(i, p)| (i, p.size))
        .collect();
    upper.sort_by(|a, b| b.1.total_cmp(&a.1));
    for (i, _) in upper.into_iter().take(3) {
        pieces[i].foreground = true;
        pieces[i].z = 0.5 + 0.25 * pieces[i].jitter;
    }
    if pieces.is_empty() {
        return Err("Sky preparation retained no visible cells");
    }
    Ok(pieces)
}
pub fn ground(x: f64) -> f64 {
    let xx = (x - 140.0) / 230.0;
    let mut noise = 0.0;
    let mut a = 0.5;
    let mut f = 1.0;
    for o in 0..3 {
        noise += a * seeded::noise(xx * f, 6.0 + o as f64 * 17.0);
        a *= 0.5;
        f *= 2.0;
    }
    1144.0 - 34.0 * ((x - 140.0) / 1920.0 - 0.5) + 12.0 * noise
        - 20.0 * (-((x - 520.0) / 260.0).powi(2)).exp()
}
