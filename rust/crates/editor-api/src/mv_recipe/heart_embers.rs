//! Unchanged draw.js lifetime-loop ember population, parameterized only by original mode constants.
use super::{
    draw::*,
    plan::{Stop, Style},
};
pub struct Embers {
    pub count: usize,
    pub seed: f64,
    pub area: [f64; 4],
    pub color: Color,
    pub rise: f64,
    pub size: f64,
    pub alpha: f64,
    pub wind: f64,
}
pub fn draw(d: &mut Draw, t: f64, o: Embers) {
    for i in 0..o.count {
        let i = i as f64;
        let rnd = |j| super::seeded::rnd(i, o.seed + j);
        let life = 3.0 + 4.0 * rnd(0.0);
        let phase = rnd(1.0) * life;
        let value = (t + phase) / life;
        let k = value - value.floor();
        let x = o.area[0]
            + (o.area[2] - o.area[0]) * rnd(2.0)
            + (t * (0.6 + rnd(3.0)) + i).sin() * 30.0 * k
            + o.wind * k * 200.0;
        let y = o.area[3] + (o.area[1] - o.area[3]) * rnd(4.0) - k * o.rise * life;
        let flick = 0.55 + 0.45 * (t * 13.0 + i * 3.1).sin();
        let a = (k * std::f64::consts::PI).sin() * flick * o.alpha;
        let r = o.size * (0.5 + rnd(5.0)) * (1.0 - k * 0.5);
        if a <= 0.01 {
            continue;
        }
        let style = Style::Radial {
            from: [x, y, 0.0],
            to: [x, y, r * 4.0],
            stops: vec![
                Stop {
                    offset: 0.0,
                    color: rgb(255.0, 241.0, 208.0, a),
                },
                Stop {
                    offset: 0.3,
                    color: alpha(o.color, a * 0.8),
                },
                Stop {
                    offset: 1.0,
                    color: alpha(o.color, 0.0),
                },
            ],
        };
        d.rect(
            [x - r * 4.0, y - r * 4.0, r * 8.0, r * 8.0],
            fill(style, "lighter"),
        );
    }
}
