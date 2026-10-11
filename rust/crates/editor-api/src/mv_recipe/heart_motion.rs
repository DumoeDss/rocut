//! Exact shatter-mode drawPiece parameters. No substitute particle effect.
#[path = "heart_shards.rs"]
pub mod shards;
use shards::Shard;
#[path = "converge_math.rs"]
mod seeded;

#[derive(Debug)]
pub struct Piece {
    pub variant: &'static str,
    pub position: [f64; 2],
    pub spin: f64,
    pub axis: f64,
    pub flip: f64,
    pub scale: f64,
    pub alpha: f64,
    pub composite: &'static str,
}
#[derive(Debug)]
pub struct Pose {
    pub pieces: Vec<Piece>,
    pub glint: f64,
    pub sparkle: Option<([f64; 2], f64)>,
    pub fire: Option<Fire>,
    pub embers: Vec<Ember>,
}
#[derive(Debug)]
pub struct Fire {
    pub position: [f64; 2],
    pub size: f64,
    pub alpha: f64,
    pub seed: f64,
    pub count: usize,
}
#[derive(Debug)]
pub struct Ember {
    pub position: [f64; 2],
    pub radius: f64,
    pub alpha: f64,
    pub color: &'static str,
}
fn burst(x: f64, k: f64) -> f64 {
    if x <= 0.0 { 0.0 } else { 1.0 - (-x / k).exp() }
}

/// Only after the break; caller validates song clock and passes the original pulse(t,7).
pub fn shatter(s: &Shard, tau: f64, pulse: f64) -> Result<Pose, &'static str> {
    if !tau.is_finite() || tau < 0.0 || !pulse.is_finite() || !(0.0..=1.0).contains(&pulse) {
        return Err("Invalid Heart shatter time or pulse");
    }
    let position = s.position(tau, 0.0);
    let spin = s.spin_amplitude * burst(tau, 0.12) + s.spin_velocity * tau;
    let flip = s.flip_amplitude * burst(tau, 0.12) + s.flip_velocity * tau;
    let scale = 1.0 + s.z * tau + 0.05 * burst(tau, 0.1);
    let glint = (flip * 2.0 + s.glow_phase).cos().max(0.0).powi(26);
    let mut pieces = Vec::with_capacity(5);
    if tau < 0.067 {
        pieces.push(Piece {
            variant: "char",
            position,
            spin,
            axis: s.axis,
            flip,
            scale,
            alpha: 1.0,
            composite: "source-over",
        });
        return Ok(Pose {
            pieces,
            glint,
            sparkle: None,
            fire: None,
            embers: Vec::new(),
        });
    }
    if tau < 0.2 {
        for g in 1..=3 {
            let tg = (tau - g as f64 * 0.022).max(0.0);
            pieces.push(Piece {
                variant: "glow",
                position: s.position(tg, 0.0),
                spin: s.spin_amplitude * burst(tg, 0.12),
                axis: s.axis,
                flip: s.flip_amplitude * burst(tg, 0.12),
                scale: 1.0,
                alpha: 0.35 * (1.0 - g as f64 / 4.0) * (1.0 - tau / 0.2),
                composite: "lighter",
            });
        }
    }
    pieces.push(Piece {
        variant: "base",
        position,
        spin,
        axis: s.axis,
        flip,
        scale,
        alpha: 1.0,
        composite: "source-over",
    });
    let ga = 0.45 + 0.55 * (-tau * 2.4).exp() + 0.25 * pulse + glint * 0.9;
    // Native drawPiece suppresses alpha<=.004, then min(1,alpha).
    pieces.push(Piece {
        variant: "glow",
        position,
        spin,
        axis: s.axis,
        flip,
        scale,
        alpha: ga.min(1.0),
        composite: "lighter",
    });
    let sparkle = if glint > 0.3 && s.size > 45.0 {
        Some((
            [
                position[0] + s.direction[0] * 16.0,
                position[1] + s.direction[1] * 16.0,
            ],
            26.0 * glint * scale + 6.0,
        ))
    } else {
        None
    };
    Ok(Pose {
        pieces,
        glint,
        sparkle,
        fire: None,
        embers: Vec::new(),
    })
}

fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let k = ((v - a) / (b - a)).clamp(0.0, 1.0);
    k * k * (3.0 - 2.0 * k)
}
fn rnd(values: &[f64]) -> f64 {
    seeded::hash(values) as f64 / 4_294_967_296.0
}
pub fn burn(
    s: &Shard,
    tau: f64,
    pulse: f64,
    t: f64,
    tq: f64,
    tb: f64,
    dmax: f64,
) -> Result<Pose, &'static str> {
    if ![tau, pulse, t, tq, tb, dmax].iter().all(|v| v.is_finite())
        || tau < 0.0
        || !(0.0..=1.0).contains(&pulse)
        || dmax <= 0.0
    {
        return Err("Invalid Heart burn clock or shard distance");
    }
    let tig = tb + 0.05 + 0.42 * (s.distance / dmax) + 0.1 * s.random;
    let b = ((t - tig) / 0.9).clamp(0.0, 1.0);
    let position = s.position(tau, 90.0 * (t - tig).max(0.0).powi(2));
    let spin = s.spin_amplitude * burst(tau, 0.12) + s.spin_velocity * tau;
    let flip = s.flip_amplitude * burst(tau, 0.12) + s.flip_velocity * tau;
    let scale = (1.0 + s.z * tau + 0.05 * burst(tau, 0.1)) * (1.0 - 0.5 * b * b);
    let glint = (flip * 2.0 + s.glow_phase).cos().max(0.0).powi(26);
    let piece = |variant, position, spin, flip, scale, alpha, composite| Piece {
        variant,
        position,
        spin,
        axis: s.axis,
        flip,
        scale,
        alpha,
        composite,
    };
    if tau < 0.067 {
        return Ok(Pose {
            pieces: vec![piece(
                "char",
                position,
                spin,
                flip,
                scale,
                1.0,
                "source-over",
            )],
            glint,
            sparkle: None,
            fire: None,
            embers: Vec::new(),
        });
    }
    let mut pieces = Vec::with_capacity(7);
    if tau < 0.2 {
        for g in 1..=3 {
            let tg = (tau - g as f64 * 0.022).max(0.0);
            pieces.push(piece(
                "glow",
                s.position(tg, 0.0),
                s.spin_amplitude * burst(tg, 0.12),
                s.flip_amplitude * burst(tg, 0.12),
                1.0,
                0.35 * (1.0 - g as f64 / 4.0) * (1.0 - tau / 0.2),
                "lighter",
            ));
        }
    }
    let fade = 1.0 - smooth(0.8, 1.0, b);
    pieces.push(piece(
        "base",
        position,
        spin,
        flip,
        scale,
        (1.0 - smooth(0.05, 0.45, b)) * fade,
        "source-over",
    ));
    let fire = if b > 0.0 {
        pieces.push(piece(
            "char",
            position,
            spin,
            flip,
            scale,
            smooth(0.0, 0.35, b) * fade,
            "source-over",
        ));
        let fl = 0.65 + 0.35 * (tq * 31.0 + s.random * 40.0).sin();
        pieces.push(piece(
            "flame",
            position,
            spin,
            flip,
            scale,
            fl * smooth(0.0, 0.15, b) * (1.0 - smooth(0.75, 1.0, b)) * 1.1,
            "lighter",
        ));
        Some(Fire {
            position: [position[0], position[1] - s.size * 0.25 * scale],
            size: s.size
                * 0.9
                * scale
                * (0.6 + 0.8 * (std::f64::consts::PI * (b * 1.2).min(1.0)).sin()),
            alpha: 0.8 * (1.0 - smooth(0.7, 1.0, b)),
            seed: s.random * 50.0,
            count: if s.size > 60.0 { 3 } else { 2 },
        })
    } else {
        None
    };
    let ga = (0.45 + 0.55 * (-tau * 2.4).exp() + 0.25 * pulse) * (1.0 - b) + glint * 0.9;
    pieces.push(piece(
        "glow",
        position,
        spin,
        flip,
        scale,
        ga.min(1.0),
        "lighter",
    ));
    let sparkle = if glint > 0.3 && s.size > 45.0 {
        Some((
            [
                position[0] + s.direction[0] * 16.0,
                position[1] + s.direction[1] * 16.0,
            ],
            26.0 * glint * scale + 6.0,
        ))
    } else {
        None
    };
    let mut embers = Vec::with_capacity(7);
    for j in 0..7 {
        let j = j as f64;
        let birth = tig + j * 0.1 + 0.05 * rnd(&[j, s.random * 1e3]);
        let age = t - birth;
        let life = 0.8 + 0.5 * rnd(&[j, 3.0, s.random * 1e3]);
        if age < 0.0 || age > life {
            continue;
        }
        let pos = s.position(birth - tb, 90.0 * (birth - tig).max(0.0).powi(2));
        let k = age / life;
        let x = pos[0]
            + (age * 6.0 + j * 2.0 + s.random * 9.0).sin() * 22.0 * k
            + (rnd(&[j, s.random * 77.0]) * 2.0 - 1.0) * 30.0 * k;
        let y = pos[1] - (130.0 + 90.0 * rnd(&[j, 5.0, s.random * 1e3])) * age - 60.0 * age * age;
        embers.push(Ember {
            position: [x, y],
            radius: 9.0 + 5.0 * (1.0 - k),
            color: if k < 0.4 { "#FFD08A" } else { "#FF6A2A" },
            alpha: (std::f64::consts::PI * k).sin() * (0.6 + 0.4 * (t * 23.0 + j).sin()),
        });
    }
    Ok(Pose {
        pieces,
        glint,
        sparkle,
        fire,
        embers,
    })
}

/// Native axis flip safeguard from drawPiece, including sign at zero.
pub fn flip_scale(flip: f64, scale: f64) -> [f64; 2] {
    let mut cf = flip.cos();
    if cf.abs() < 0.035 {
        cf = if cf < 0.0 { -0.035 } else { 0.035 };
    }
    [cf * scale, scale]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn impact_and_smear_boundaries_are_original() {
        let body = shards::components::prepare(20, 20, &vec![255; 1600], 100_000).unwrap();
        let glass = shards::build(&body, 1_000_000).unwrap();
        let s = &glass.shards[0];
        assert_eq!(shatter(s, 0.066, 0.0).unwrap().pieces[0].variant, "char");
        assert_eq!(shatter(s, 0.067, 0.0).unwrap().pieces.len(), 5);
        assert_eq!(shatter(s, 0.2, 0.0).unwrap().pieces.len(), 2);
        assert!(shatter(s, -0.1, 0.0).is_err());
        assert!(shatter(s, 0.1, f64::NAN).is_err());
        assert_eq!(flip_scale(std::f64::consts::FRAC_PI_2, 2.0), [0.07, 2.0]);
    }
    #[test]
    fn burn_ignition_and_consumption_keep_original_layers() {
        let body = shards::components::prepare(20, 20, &vec![255; 1600], 100_000).unwrap();
        let glass = shards::build(&body, 1_000_000).unwrap();
        let s = &glass.shards[0];
        let dmax = glass.shards.iter().map(|s| s.distance).fold(0.0, f64::max);
        let tig = 1.0 + 0.05 + 0.42 * (s.distance / dmax) + 0.1 * s.random;
        let impact = burn(s, 0.066, 0.0, 1.066, 1.066, 1.0, dmax).unwrap();
        assert_eq!(impact.pieces.len(), 1);
        assert_eq!(impact.pieces[0].variant, "char");
        assert!(impact.fire.is_none());
        let ignited = burn(s, tig - 1.0 + 0.1, 0.0, tig + 0.1, tig + 0.1, 1.0, dmax).unwrap();
        assert!(ignited.pieces.iter().any(|p| p.variant == "flame"));
        assert!(ignited.fire.as_ref().unwrap().alpha > 0.0);
        assert_eq!(ignited.pieces.last().unwrap().variant, "glow");
        let consumed = burn(s, tig, 0.0, tig + 1.0, tig + 1.0, 1.0, dmax).unwrap();
        assert_eq!(
            consumed
                .pieces
                .iter()
                .find(|p| p.variant == "base")
                .unwrap()
                .alpha,
            0.0
        );
        assert_eq!(consumed.fire.unwrap().alpha, 0.0);
        assert!(burn(s, 0.1, 0.0, 1.1, 1.1, 1.0, 0.0).is_err());
    }
}
