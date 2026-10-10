//! Original seed+9 RNG consumption: clouds, Milky Way dust, field stars, animated stars.
#[path = "converge_math.rs"]
mod seeded;
pub struct Cloud {
    pub position: [f64; 2],
    pub radius: f64,
    pub color: [f64; 4],
}
pub struct Dust {
    pub position: [f64; 2],
    pub color: [f64; 4],
}
pub struct Star {
    pub position: [f64; 2],
    pub radius: f64,
    pub color: [f64; 4],
}
pub struct Twinkle {
    pub position: [f64; 2],
    pub radius: f64,
    pub frequency: f64,
    pub phase: f64,
    pub cool: bool,
}
pub struct Night {
    pub clouds: Vec<Cloud>,
    pub dust: Vec<Dust>,
    pub stars: Vec<Star>,
    pub twinkles: Vec<Twinkle>,
}
pub fn curve(u: f64) -> [f64; 2] {
    [
        -200.0 + 2600.0 * u,
        1360.0 * 0.78 + (-80.0 - 1360.0 * 0.78) * u + 130.0 * (u * 2.8 + 0.3).sin(),
    ]
}
pub fn build(seed: u32) -> Night {
    let mut r = seeded::Rng::new(seed as f64 + 9.0);
    let mut clouds = Vec::with_capacity(110);
    for _ in 0..110 {
        let u = r.next();
        let b = curve(u);
        let off = (r.next() - 0.5) * 260.0;
        let radius = 70.0 + 190.0 * r.next();
        let position = [b[0] + 0.55 * off, b[1] + 0.83 * off];
        clouds.push(Cloud {
            position,
            radius,
            color: [
                (110.0 + 60.0 * r.next()).trunc() / 255.0,
                (120.0 + 40.0 * r.next()).trunc() / 255.0,
                215.0 / 255.0,
                0.035 + 0.05 * r.next(),
            ],
        });
    }
    let mut dust = Vec::with_capacity(6000);
    for _ in 0..6000 {
        let u = r.next();
        let gs = (r.next() + r.next() + r.next() - 1.5) * 150.0;
        let b = curve(u);
        let position = [b[0] + 0.55 * gs, b[1] + 0.83 * gs];
        let a = (0.05 + 0.22 * r.next()) * (1.0 - gs.abs() / 230.0);
        dust.push(Dust {
            position,
            color: [
                (210.0 + 45.0 * r.next()).trunc() / 255.0,
                (210.0 + 40.0 * r.next()).trunc() / 255.0,
                1.0,
                a.max(0.0),
            ],
        });
    }
    let mut stars = Vec::with_capacity(1600);
    for _ in 0..1600 {
        let position = [r.next() * 2200.0, r.next() * 1360.0 * 0.9];
        let m = r.next().powi(3);
        let radius = 0.5 + 1.3 * m;
        let c = r.next();
        stars.push(Star {
            position,
            radius,
            color: if c < 0.2 {
                [1.0, 220.0 / 255.0, 190.0 / 255.0, 0.3 + 0.7 * m]
            } else if c < 0.45 {
                [190.0 / 255.0, 210.0 / 255.0, 1.0, 0.3 + 0.7 * m]
            } else {
                [240.0 / 255.0, 244.0 / 255.0, 1.0, 0.25 + 0.75 * m]
            },
        });
    }
    let mut twinkles = Vec::with_capacity(55);
    for _ in 0..55 {
        twinkles.push(Twinkle {
            position: [r.next() * 2200.0, r.next() * 1360.0 * 0.8],
            radius: 5.0 + 15.0 * r.next().powf(2.2),
            frequency: 0.8 + 2.4 * r.next(),
            phase: r.next() * std::f64::consts::TAU,
            cool: r.next() < 0.7,
        });
    }
    Night {
        clouds,
        dust,
        stars,
        twinkles,
    }
}
