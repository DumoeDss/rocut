use super::{clock::Clock, math::*, plan::Operation};
pub(super) struct State {
    pub progress: f64,
    pub growth: f64,
    pub tug: f64,
    pub arrival: f64,
    pub beat: f64,
    pub light_pulse: f64,
}
impl State {
    pub fn new(c: &Clock) -> Self {
        let progress = sine(clamp((c.time - c.start) / c.duration));
        let g = inv(c.start + 0.06, c.kick - 0.12, c.held);
        let growth = clamp(
            0.02 + 0.9 * (1.0 - (1.0 - g).powf(2.4)) + 0.08 * expo(inv(c.kick, c.arrive, c.time)),
        );
        let tug = (c.time - c.kick) / (c.arrive - c.kick).max(0.1);
        let arrival = if c.time >= c.arrive {
            (-(c.time - c.arrive) * 2.6).exp()
        } else {
            0.0
        };
        Self {
            progress,
            growth,
            tug,
            arrival,
            beat: c.pulse(c.quantized, 6.0),
            light_pulse: 0.3 + 0.5 * growth + 0.9 * arrival + 0.12 * c.down_pulse(c.time, 4.0),
        }
    }
    pub fn camera(&self, k: f64) -> Vec<Operation> {
        let z = 1.0 + ((1.0 + 0.06 * self.progress) - 1.0) * k;
        vec![
            Operation::Translate {
                offset: [960.0, 540.0],
            },
            Operation::Scale { factors: [z, z] },
            Operation::Translate {
                offset: [
                    -960.0 - 70.0 * self.progress * k,
                    -540.0 + 20.0 * self.progress * k,
                ],
            },
        ]
    }
}
