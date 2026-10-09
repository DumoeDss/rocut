//! Original Heart retained-cell selection and closed-form shard motion.
#[path = "heart_components.rs"]
pub mod components;
#[path = "heart_fracture.rs"]
pub mod fracture;
#[path = "converge_math.rs"]
mod seeded;
use seeded::{Rng, TAU};

#[derive(Debug)]
pub struct Shard {
    pub cell: usize,
    pub pivot: [f64; 2],
    pub coverage: f64,
    pub distance: f64,
    pub direction: [f64; 2],
    pub random: f64,
    pub size: f64,
    pub amplitude: f64,
    pub velocity: f64,
    pub spin_amplitude: f64,
    pub spin_velocity: f64,
    pub axis: f64,
    pub flip_amplitude: f64,
    pub flip_velocity: f64,
    pub z: f64,
    pub glow_phase: f64,
}
impl Shard {
    pub fn position(&self, tau: f64, lift: f64) -> [f64; 2] {
        let burst = if tau <= 0.0 {
            0.0
        } else {
            1.0 - (-tau / 0.085).exp()
        };
        let radius = self.amplitude * burst + self.velocity * tau;
        [
            self.pivot[0] + self.direction[0] * radius,
            self.pivot[1] + self.direction[1] * radius + 22.0 * tau * tau - lift,
        ]
    }
}
#[derive(Debug)]
pub struct Glass {
    pub fracture: fracture::Fracture,
    pub inside: Vec<bool>,
    pub radius_max: f64,
    pub distance_max: f64,
    pub impact: [f64; 2],
    pub shards: Vec<Shard>,
}
fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}

/// `sample_budget` bounds the exact original step-three cell scan, not its result.
pub fn build(
    body: &components::Prepared,
    sample_budget: usize,
) -> Result<Glass, components::Error> {
    let impact = [
        body.display_size[0] as f64 * 0.5,
        body.display_size[1] as f64 * 0.43,
    ];
    let fracture = fracture::build(impact);
    let mut radius_max: f64 = 1.0;
    let inside = fracture
        .edges
        .iter()
        .map(|e| {
            let midpoint = e.points[e.points.len() / 2];
            let first = e.points[0];
            let inside = body.alpha_at(midpoint[0], midpoint[1]) > 60
                || body.alpha_at(first[0], first[1]) > 60;
            if inside {
                radius_max = radius_max.max(
                    e.distance
                        + if e.kind == "spoke" {
                            e.length * 0.35
                        } else {
                            0.0
                        },
                );
            }
            inside
        })
        .collect();
    let mut r = Rng::new(2204.0);
    let mut distance_max: f64 = 1.0;
    let mut samples = 0usize;
    let mut shards = Vec::new();
    for (index, c) in fracture.cells.iter().enumerate() {
        let mut bounds = [1e9f64, 1e9f64, -1e9f64, -1e9f64];
        for [x, y] in &c.polygon {
            bounds[0] = bounds[0].min(*x);
            bounds[1] = bounds[1].min(*y);
            bounds[2] = bounds[2].max(*x);
            bounds[3] = bounds[3].max(*y);
        }
        let (mut n, mut sx, mut sy) = (0usize, 0.0, 0.0);
        let mut y = bounds[1];
        while y <= bounds[3] {
            let mut x = bounds[0];
            while x <= bounds[2] {
                samples = samples
                    .checked_add(1)
                    .ok_or(components::Error::BudgetExceeded)?;
                if samples > sample_budget {
                    return Err(components::Error::BudgetExceeded);
                }
                if fracture::in_polygon(x, y, &c.polygon) && body.alpha_at(x, y) > 90 {
                    n += 1;
                    sx += x;
                    sy += y;
                }
                x += 3.0;
            }
            y += 3.0;
        }
        if n < 10 {
            continue;
        }
        let pivot = [sx / n as f64, sy / n as f64];
        let dx = pivot[0] - impact[0];
        let dy = pivot[1] - impact[1];
        let distance = {
            let d = dx.hypot(dy);
            if d == 0.0 {
                1.0
            } else {
                d
            }
        };
        let angle = dy.atan2(dx) + range(&mut r, -0.25, 0.25);
        distance_max = distance_max.max(distance);
        shards.push(Shard {
            cell: index,
            pivot,
            coverage: n as f64 * 9.0,
            distance,
            direction: [angle.cos(), angle.sin()],
            random: r.next(),
            size: (n as f64 * 9.0).sqrt(),
            amplitude: (24.0 + 0.45 * distance) * range(&mut r, 0.75, 1.35),
            velocity: (18.0 + 0.16 * distance) * range(&mut r, 0.6, 1.5),
            spin_amplitude: range(&mut r, -0.9, 0.9),
            spin_velocity: range(&mut r, -0.55, 0.55),
            axis: r.next() * std::f64::consts::PI,
            flip_amplitude: range(&mut r, -1.3, 1.3),
            flip_velocity: range(&mut r, -1.7, 1.7),
            z: range(&mut r, -0.18, 0.42),
            glow_phase: r.next() * TAU,
        });
    }
    shards.sort_by(|a, b| a.z.total_cmp(&b.z));
    Ok(Glass {
        fracture,
        inside,
        radius_max,
        distance_max,
        impact,
        shards,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retained_shards_and_motion_are_bounded() {
        let body = components::prepare(20, 20, &vec![255; 20 * 20 * 4], 100_000).unwrap();
        assert_eq!(
            build(&body, 0).unwrap_err(),
            components::Error::BudgetExceeded
        );
        let glass = build(&body, 1_000_000).unwrap();
        assert!(!glass.shards.is_empty());
        assert!(glass.shards.windows(2).all(|s| s[0].z <= s[1].z));
        for s in glass.shards {
            assert_eq!(s.position(0.0, 0.0), s.pivot);
            assert!(s.position(0.067, 0.0).iter().all(|v| v.is_finite()));
        }
    }
}
