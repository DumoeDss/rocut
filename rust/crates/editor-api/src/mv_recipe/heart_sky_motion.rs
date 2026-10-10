#[path = "converge_math.rs"]
mod seeded;
pub fn release(near: f64, jitter: f64, angle: f64, bands: usize, band_times: &[f64]) -> f64 {
    let b = ((bands as f64 * (1.0 - near).powf(1.15)).floor() as usize).min(bands - 1);
    band_times[b] + 0.16 * jitter + 0.05 * (0.5 + 0.5 * (angle * 2.0).sin())
}
pub struct Falling {
    pub position: [f64; 2],
    pub scale: f64,
    pub spin: f64,
    pub flip: f64,
    pub dark: f64,
    pub glint: f64,
    pub visible: bool,
}
pub struct FallInput {
    pub position: [f64; 2],
    pub direction: [f64; 2],
    pub velocity: [f64; 2],
    pub gravity: f64,
    pub size: f64,
    pub z: f64,
    pub foreground: bool,
    pub spin_velocity: f64,
    pub spin_acceleration: f64,
    pub flip_velocity: f64,
    pub glow_phase: f64,
}
pub fn fall(p: FallInput, tau: f64) -> Falling {
    let tf = (tau - 0.06).max(0.0);
    let position = [
        p.position[0] + p.direction[0] * p.velocity[0] * tau,
        p.position[1]
            + p.velocity[1] * tau
            + 0.5 * p.gravity * tf * tf * if p.foreground { 1.3 } else { 1.0 },
    ];
    let scale = 1.0 + p.z * tau + if p.foreground { 0.45 * tau * tau } else { 0.0 };
    let spin = p.spin_velocity * tau + 0.5 * p.spin_acceleration * tau * tau;
    let flip = p.flip_velocity * tau * if p.foreground { 0.6 } else { 1.0 };
    let dark =
        ((1.0 - flip.cos().abs()) * 0.7 + tau * 0.22 + if p.foreground { 0.25 } else { 0.0 })
            .clamp(0.0, 1.0)
            * 0.85;
    Falling {
        position,
        scale,
        spin,
        flip,
        dark,
        glint: (flip * 2.0 + p.glow_phase).cos().max(0.0).powi(30),
        visible: position[1] - p.size * 0.8 * scale <= 1280.0,
    }
}
pub struct Debris {
    pub position: [f64; 2],
    pub alpha: f64,
    pub twinkle: f64,
    pub white: bool,
    pub sparkle: bool,
}
pub fn debris(j: usize, t: f64, tau: f64, position: [f64; 2], size: f64, jitter: f64) -> Debris {
    let fj = j as f64;
    let seed = jitter * 1000.0;
    let ta = (tau + 0.1 * seeded::rnd(fj, seed)).max(0.0);
    let rnds = |part: f64| seeded::hash(&[fj, part, seed]) as f64 / 4_294_967_296.0 * 2.0 - 1.0;
    let x = position[0] + rnds(1.0) * size * 0.45 + rnds(3.0) * 60.0 * ta;
    let y = position[1] + rnds(2.0) * size * 0.45 + 700.0 * ta * ta;
    let tw = (t * (7.0 + 5.0 * seeded::rnd(fj, 4.0)) + fj)
        .sin()
        .abs()
        .powi(5);
    let alpha = (0.3 + 0.7 * tw) * (1.0 - ta / 1.7);
    Debris {
        position: [x, y],
        alpha,
        twinkle: tw,
        white: j % 3 == 0,
        sparkle: tw > 0.9 && j % 2 == 1,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_bands_center_first_and_delayed_gravity() {
        let b = [1.0, 1.5, 2.0, 2.5, 3.0];
        assert_eq!(release(1.0, 0.0, 0.0, 5, &b), 1.025);
        assert_eq!(release(0.0, 0.0, 0.0, 5, &b), 3.025);
        let q = debris(0, 1.0, 0.0, [900.0, 400.0], 200.0, 0.5);
        assert!(q.position.iter().all(|v| v.is_finite()));
        assert!(q.alpha > 0.0 && q.alpha <= 1.0);
    }
}
