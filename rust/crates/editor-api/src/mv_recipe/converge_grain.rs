use super::{draw::Draw, math::*, plan::Command};

pub(super) fn draw(d: &mut Draw, t: f64, opacity: f64) {
    if opacity <= 0.0 {
        return;
    }
    let q = (t * 24.0 + 1e-6).floor();
    let mut rng = Rng::new(900.0 + q % 4.0);
    // Canvas ImageData applies ToUint8Clamp (ties to even), not truncation.
    let gray = (0..65_536)
        .map(|_| {
            let v = (128.0 + (rng.next() + rng.next() + rng.next() - 1.5) * 92.0).clamp(0.0, 255.0);
            v.round_ties_even() as u8
        })
        .collect();
    let ox = (rnd(q, 1.0) * 256.0).floor();
    let oy = (rnd(q, 2.0) * 256.0).floor();
    d.commands.push(Command::Grain {
        transform: [1.0, 0.0, 0.0, 1.0, -ox, -oy],
        rect: [ox, oy, d.width, d.height],
        size: [256, 256],
        gray,
        opacity,
    });
}
