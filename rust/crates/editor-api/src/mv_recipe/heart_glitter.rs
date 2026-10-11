//! Original shatter's 170 ordered glass-dust fillRect calls and sparkle gates.
#[path = "converge_math.rs"]
mod seeded;
#[derive(Debug)]
pub struct Glitter {
    pub rect: [f64; 4],
    pub alpha: f64,
    pub color: &'static str,
    pub sparkle_radius: Option<f64>,
}
pub fn shatter(time: f64, tau: f64, impact: [f64; 2]) -> Result<Vec<Glitter>, &'static str> {
    glass_dust(time, tau, impact, false)
}
pub fn glass_dust(
    time: f64,
    tau: f64,
    impact: [f64; 2],
    burn: bool,
) -> Result<Vec<Glitter>, &'static str> {
    if !time.is_finite() || !tau.is_finite() || tau < 0.0 || !impact.iter().all(|v| v.is_finite()) {
        return Err("Invalid Heart glitter clock or position");
    }
    let burst = |k: f64| {
        if tau <= 0.0 {
            0.0
        } else {
            1.0 - (-tau / k).exp()
        }
    };
    let mut out = Vec::with_capacity(170);
    for i in 0..170 {
        let rnd = |seed: f64| seeded::rnd(i as f64, seed);
        let angle = rnd(91.0) * seeded::TAU;
        let amplitude = 90.0 + 520.0 * rnd(92.0).powf(0.7);
        let velocity = 15.0 + 90.0 * rnd(93.0);
        let radius = amplitude * burst(0.07) + velocity * tau;
        let x = impact[0] + angle.cos() * radius;
        let y = impact[1] + angle.sin() * radius * 0.9 + 35.0 * tau * tau
            - if burn { 110.0 * tau * tau } else { 0.0 };
        let tw = (time * (4.0 + 6.0 * rnd(94.0)) + i as f64)
            .sin()
            .abs()
            .powi(6);
        let size = 1.0 + 2.2 * rnd(95.0);
        let alpha = (0.35 + 0.65 * tw) * (0.4 + 0.6 * (-tau * 1.2).exp());
        out.push(Glitter {
            rect: [x - size / 2.0, y - size / 2.0, size, size],
            alpha,
            color: if burn {
                if i % 3 != 0 { "#FFB060" } else { "#FF6A2A" }
            } else {
                if i % 4 != 0 { "#FFE3B0" } else { "#FFFFFF" }
            },
            sparkle_radius: if tw > 0.85 && i % 3 == 0 {
                Some(14.0 * tw)
            } else {
                None
            },
        });
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_population_and_fail_closed_time() {
        assert!(shatter(0.0, -1.0, [0.0, 0.0]).is_err());
        let glitter = shatter(1.0, 0.0, [300.0, 262.3]).unwrap();
        assert_eq!(glitter.len(), 170);
        for (i, g) in glitter.iter().enumerate() {
            assert_eq!(g.rect[0] + g.rect[2] / 2.0, 300.0);
            assert_eq!(g.rect[1] + g.rect[3] / 2.0, 262.3);
            assert_eq!(g.color, if i % 4 == 0 { "#FFFFFF" } else { "#FFE3B0" });
            assert!((0.0..=1.0).contains(&g.alpha));
        }
    }
}
