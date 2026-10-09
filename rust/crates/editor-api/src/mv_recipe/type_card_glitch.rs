use super::{
    Sample,
    math::{Rng, hash},
    model::{Flicker, Layout},
    plan,
};

pub(super) fn bands_and_blocks(
    a: &Flicker,
    l: &Layout,
    s: &Sample<'_>,
    flick: f64,
    sample: u64,
) -> (Vec<plan::Band>, Vec<plan::Rect>) {
    // Preserve reference RNG consumption and band rounding at every output size.
    let mut r = Rng::new(hash(&[sample as f64, f64::from(s.seed.wrapping_add(91))]));
    let (mut bands, mut blocks) = (Vec::new(), Vec::new());
    let (sx, sy) = (s.width / 1920.0, s.height / 1080.0);
    let mut y = 0.0;
    while y < 1080.0 {
        let height = (10.0 + r.next() * 70.0).round();
        let offset = if r.next() < 0.32 * l.glitch + 0.04 {
            (r.next() - 0.5) * 240.0 * l.glitch
        } else {
            0.0
        };
        bands.push(plan::Band {
            source_rect: [0.0, y * sy, s.width, height * sy],
            destination_rect: [offset * sx, y * sy, s.width, height * sy],
            opacity: flick,
        });
        y += height;
    }
    for i in 0..(16.0 * l.glitch).ceil() as usize {
        let p = &l.parts[i % l.parts.len()];
        let bw = (20.0 + r.next() * 160.0) * sx;
        let bh = (3.0 + r.next() * 20.0) * sy;
        let px = p.font_size * s.height;
        let x = p.position[0] * s.width + (r.next() - 0.5) * px * 2.4;
        let y = p.position[1] * s.height + (r.next() - 0.5) * px * 0.9;
        blocks.push(plan::Rect {
            rect: [x, y, bw, bh],
            color: a.noise_colors[i % 3],
            opacity: 1.0,
        });
    }
    (bands, blocks)
}
