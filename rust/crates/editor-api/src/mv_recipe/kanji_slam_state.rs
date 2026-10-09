use super::{
    clock::Clock,
    math::*,
    model::{KanjiSlam, Slot},
    plan::Operation,
};

pub(super) struct Glyph {
    pub ch: char,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
}
pub(super) fn layout(word: &str, slot: &Slot, hit: usize) -> Vec<Glyph> {
    let chars: Vec<_> = word.chars().collect();
    if chars.len() == 1 {
        return vec![Glyph {
            ch: chars[0],
            x: slot.x,
            y: slot.y,
            scale: slot.s,
            rotation: slot.r,
        }];
    }
    if chars.len() == 2 && small(chars[0]) {
        let alt = (hit / 2) % 2 != 0;
        return vec![
            Glyph {
                ch: chars[0],
                x: if alt { 230.0 } else { 215.0 },
                y: if alt { 800.0 } else { 470.0 },
                scale: if alt { 0.38 } else { 0.4 },
                rotation: slot.r * if alt { -1.5 } else { 1.8 },
            },
            Glyph {
                ch: chars[1],
                x: slot.x + 260.0,
                y: 600.0 + if alt { 20.0 } else { 0.0 },
                scale: slot.s.min(1.1),
                rotation: slot.r,
            },
        ];
    }
    let n = chars.len();
    let scale = slot.s * if n == 2 { 0.95 } else { 0.8 };
    let advance = scale * 1080.0 * 0.95;
    chars
        .into_iter()
        .enumerate()
        .map(|(i, ch)| Glyph {
            ch,
            x: slot.x + (i as f64 - (n - 1) as f64 / 2.0) * advance,
            y: slot.y,
            scale: scale * if small(ch) || particle(ch) { 0.7 } else { 1.0 },
            rotation: slot.r,
        })
        .collect()
}
pub(super) struct State {
    pub rekick: bool,
    pub glyphs: Vec<Glyph>,
    pub previous: Vec<Glyph>,
    pub glyph_scale: f64,
    pub smear: f64,
    pub burn: f64,
    push: f64,
    kick: f64,
    shake: [f64; 2],
    roll: f64,
}
impl State {
    pub fn new(a: &KanjiSlam, c: &Clock) -> Self {
        let k = c.hit;
        let u = c.elapsed;
        let rekick = k >= a.glyphs.len();
        let amplitude =
            if rekick { 9.0 } else { 18.0 } * (-u * 13.0).exp() + if a.fire { 2.2 } else { 0.0 };
        let q = (c.time * 24.0).floor();
        Self {
            rekick,
            glyphs: layout(
                &a.glyphs[k.min(a.glyphs.len() - 1)],
                &a.slots[k % a.slots.len()],
                k,
            ),
            previous: if k > 0 && !rekick && 0.85 * (-u * 5.5).exp() > 0.01 {
                layout(
                    &a.glyphs[(k - 1).min(a.glyphs.len() - 1)],
                    &a.slots[(k - 1) % a.slots.len()],
                    k - 1,
                )
            } else {
                Vec::new()
            },
            glyph_scale: (if rekick {
                1.0 + damp(u, 0.08, 14.0, 2.4)
            } else {
                1.0 + damp(u, 0.27, 16.0, 2.6)
            }) + 0.022 * u.min(0.6)
                - 0.03 * c.anticipation(),
            smear: if rekick { 0.0 } else { (-u * 40.0).exp() },
            burn: if a.fire {
                0.7 + 0.3 * noise(quant(c.time, 15.0) * 6.0, 3.0)
            } else {
                0.0
            },
            push: 1.0 + 0.035 * io(c.progress),
            kick: damp(u, if rekick { 0.035 } else { 0.06 }, 11.0, 1.6) - 0.022 * c.anticipation(),
            shake: [
                rnds(q, 17.0 + k as f64) * amplitude,
                rnds(q, 24.0 + k as f64) * amplitude,
            ],
            roll: if k % 2 != 0 { -1.0 } else { 1.0 } * 0.016 * (-u * 7.0).exp()
                + 0.004 * (c.local * 1.3).sin(),
        }
    }
    pub fn camera(&self, depth: f64) -> Vec<Operation> {
        let z = 1.0 + (self.push - 1.0) * depth + self.kick * depth;
        vec![
            Operation::Translate {
                offset: [960.0 + self.shake[0] * depth, 540.0 + self.shake[1] * depth],
            },
            Operation::Rotate {
                radians: self.roll * depth,
            },
            Operation::Scale { factors: [z, z] },
            Operation::Translate {
                offset: [-960.0, -540.0],
            },
        ]
    }
}
