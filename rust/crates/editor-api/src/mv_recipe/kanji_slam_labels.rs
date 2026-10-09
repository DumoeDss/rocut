use super::{clock::Clock, math::small, model::KanjiSlam, palette::*};
use crate::mv_recipe::model::Color;
pub(super) struct Label {
    pub font: String,
    pub text: String,
    pub size: f64,
    pub position: [f64; 2],
    pub color: Color,
    pub align: &'static str,
}
pub(super) fn labels(a: &KanjiSlam, c: &Clock) -> (Vec<Label>, f64) {
    let mut out = Vec::new();
    let mut y = 104.0;
    for (i, word) in a.glyphs.iter().enumerate() {
        let on = i == c.hit.min(a.glyphs.len() - 1);
        for ch in word.chars() {
            let shift = if small(ch) { 3.0 } else { 0.0 };
            out.push(Label {
                font: a.fonts.lyric.clone(),
                text: ch.to_string(),
                size: 30.0,
                position: [86.0 + shift, y - shift],
                color: if on {
                    if a.night() { rgb(0xff6a4d) } else { HI }
                } else {
                    [244.0 / 255.0, 239.0 / 255.0, 230.0 / 255.0, 0.38]
                },
                align: "center",
            });
            y += 30.0 * 1.12;
        }
        y += 30.0 * 0.35;
    }
    out.push(Label {
        font: a.fonts.counter.clone(),
        text: format!("{:02} / {:02}", c.hit + 1, c.shot_beats.len()),
        size: 16.0,
        position: [78.0, y + 120.0],
        color: [244.0 / 255.0, 239.0 / 255.0, 230.0 / 255.0, 0.65],
        align: "left",
    });
    (out, y)
}
