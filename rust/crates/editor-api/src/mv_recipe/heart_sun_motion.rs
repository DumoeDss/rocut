//! Original closed-form vortex and reborn-sun spark positions.
#[path = "converge_math.rs"]
mod seeded;
pub fn spiral(
    i: f64,
    lead: f64,
    r0: f64,
    theta: f64,
    dir: f64,
    t: f64,
    t0: f64,
    fuse: f64,
    center: [f64; 2],
) -> [f64; 3] {
    let u = ((t - (t0 - lead)) / (fuse - (t0 - lead))).clamp(0.0, 1.0);
    let e = u * u * u;
    let r = r0 * (1.0 - e);
    let th = theta + dir * (1.5 + 1.2 * seeded::rnd(i, 5.0)) * u * u;
    [center[0] + th.cos() * r, center[1] + th.sin() * r * 0.82, u]
}
pub struct Vortex {
    pub position: [f64; 3],
    pub previous: [f64; 3],
    pub hot: f64,
    pub color: [f64; 3],
    pub alpha: f64,
    pub width: f64,
    pub glow_radius: Option<f64>,
}
pub fn vortex(i: usize, t: f64, t0: f64, fuse: f64, center: [f64; 2]) -> Vortex {
    let fi = i as f64;
    let lead = 0.1 + seeded::rnd(fi, 61.0);
    let r0 = 300.0 + 820.0 * seeded::rnd(fi, 62.0).sqrt();
    let th = seeded::rnd(fi, 63.0) * std::f64::consts::TAU;
    let dir = if i % 2 == 1 { 1.0 } else { -1.0 };
    let position = spiral(fi, lead, r0, th, dir, t, t0, fuse, center);
    let previous = spiral(fi, lead, r0, th, dir, t - 0.05, t0, fuse, center);
    let k = ((position[2] - 0.5) / 0.5).clamp(0.0, 1.0);
    let hot = k * k * (3.0 - 2.0 * k);
    Vortex {
        position,
        previous,
        hot,
        color: if hot > 0.5 {
            [255.0, 233.0, 192.0]
        } else if i % 3 != 0 {
            [255.0, 165.0, 82.0]
        } else {
            [255.0, 106.0, 42.0]
        },
        alpha: (0.5 + 0.5 * (t * 19.0 + fi).sin().powi(2)) * (0.55 + 0.45 * position[2]),
        width: 1.4 + 2.2 * seeded::rnd(fi, 64.0),
        glow_radius: if i % 5 == 0 {
            Some(10.0 + 8.0 * seeded::rnd(fi, 65.0))
        } else {
            None
        },
    }
}
pub struct ShardPose {
    pub position: [f64; 3],
    pub scale: f64,
    pub spin: f64,
    pub flip: f64,
    pub flame_alpha: f64,
}
pub fn shard(i: usize, t: f64, tq: f64, t0: f64, fuse: f64, center: [f64; 2]) -> ShardPose {
    let fi = i as f64;
    let lead = 0.2 + 0.7 * seeded::rnd(fi, 71.0);
    let r0 = 360.0 + 480.0 * seeded::rnd(fi, 72.0);
    let th = seeded::rnd(fi, 73.0) * std::f64::consts::TAU;
    let dir = if i % 2 == 1 { 1.0 } else { -1.0 };
    let position = spiral(fi + 500.0, lead, r0, th, dir, t, t0, fuse, center);
    ShardPose {
        position,
        scale: 0.95 * (1.0 - 0.8 * position[2] * position[2]),
        spin: t * (1.2 + seeded::rnd(fi, 74.0)) * dir,
        flip: t * 2.1 + fi,
        flame_alpha: 0.7 + 0.3 * (tq * 29.0 + fi * 5.0).sin(),
    }
}
pub struct Spark {
    pub rect: [f64; 4],
    pub alpha: f64,
    pub high: bool,
}
pub fn spark(i: usize, t: f64, tau: f64, radius: f64, center: [f64; 2]) -> Spark {
    let fi = i as f64;
    let an = seeded::rnd(fi, 81.0) * std::f64::consts::TAU;
    let speed = 260.0 + 700.0 * seeded::rnd(fi, 82.0);
    let burst = if tau <= 0.0 {
        0.0
    } else {
        1.0 - (-tau / 0.25).exp()
    };
    let r = radius * 0.8 + speed * burst + 40.0 * tau;
    let x = center[0] + an.cos() * r;
    let y = center[1] + an.sin() * r * 0.9 + 60.0 * tau * tau;
    let size = 1.5 + 2.5 * seeded::rnd(fi, 83.0);
    Spark {
        rect: [x - size / 2.0, y - size / 2.0, size, size],
        alpha: (-tau * 1.1).exp() * (0.5 + 0.5 * (t * 21.0 + fi).sin().powi(2)),
        high: i % 3 != 0,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vortex_reaches_core_and_sparks_begin_at_radius() {
        let p = spiral(3.0, 0.5, 800.0, 1.0, 1.0, 1.0, 0.0, 1.0, [960.0, 300.0]);
        assert_eq!(p, [960.0, 300.0, 1.0]);
        let q = shard(0, 0.0, 0.0, 0.0, 1.0, [960.0, 300.0]);
        assert!(q.position[2] > 0.0 && q.position[2] < 1.0);
        let s = spark(0, 1.0, 0.0, 128.0, [960.0, 300.0]);
        assert!(s.rect.iter().all(|v| v.is_finite()));
        assert!(s.alpha <= 1.0 && s.alpha >= 0.5);
    }
}
