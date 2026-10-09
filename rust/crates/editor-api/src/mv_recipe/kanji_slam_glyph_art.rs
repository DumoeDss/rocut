use super::{
    draw::*, fonts::ink_request, math::*, model::KanjiSlam, palette::*, plan::*, raster::*,
};
use crate::mv_font_metrics::Context;
pub(super) struct Art {
    pub ch: char,
    pub size: [u32; 2],
    pub ink_h: f64,
    pub position: [f64; 2],
    pub bounds: [f64; 4],
    pub ids: [&'static str; 5],
    pub live: bool,
    pub ghost: bool,
}
macro_rules! ids {($($id:literal),*)=>{[$([concat!("ks-g",$id,"-fill"),concat!("ks-g",$id,"-line"),concat!("ks-g",$id,"-edge"),concat!("ks-g",$id,"-ring"),concat!("ks-g",$id,"-shadow")]),*]};}
const IDS: [[&str; 5]; 16] = ids!(
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"
);
pub(super) fn geometry(
    ch: char,
    index: usize,
    a: &KanjiSlam,
    fonts: &Context,
) -> Result<Art, String> {
    let m = fonts.bounds(&a.fonts.monument, &ink_request(ch))?;
    let pad = 105.0;
    let w = (m.left + m.right + 2.0 * pad).ceil();
    let h = (m.ascent + m.descent + 2.0 * pad).ceil();
    if !(1.0..=4096.0).contains(&w) || !(1.0..=4096.0).contains(&h) || m.ascent + m.descent <= 0.0 {
        return Err(
            "kanjiSlam requires finite positive measured monument ink within surface bounds".into(),
        );
    }
    Ok(Art {
        ch,
        size: [w as u32, h as u32],
        ink_h: m.ascent + m.descent,
        position: [pad + m.left, pad + m.ascent],
        bounds: [pad, pad, m.left + m.right, m.ascent + m.descent],
        ids: *IDS
            .get(index)
            .ok_or("kanjiSlam visible glyph art exceeds bounded surface identities")?,
        live: false,
        ghost: false,
    })
}
fn text(d: &mut Draw, a: &KanjiSlam, g: &Art, style: Style, comp: &'static str, alpha: f64) {
    d.commands.push(Command::Text {
        font: a.fonts.monument.clone(),
        text: g.ch.to_string(),
        font_size: 1500.0,
        tracking: 0.0,
        position: g.position,
        transform: I,
        operations: vec![],
        fill: TextFill::Style { style },
        opacity: alpha,
        composite: comp,
        align: "left",
        baseline: "alphabetic",
    });
}
fn stroke_text(
    d: &mut Draw,
    a: &KanjiSlam,
    g: &Art,
    color: crate::mv_recipe::model::Color,
    width: f64,
    blur: f64,
) {
    d.commands.push(Command::TextStroke {
        font: a.fonts.monument.clone(),
        text: g.ch.to_string(),
        font_size: 1500.0,
        tracking: 0.0,
        position: g.position,
        transform: I,
        operations: vec![],
        clip: None,
        style: solid(color),
        width,
        cap: "butt",
        join: "round",
        blur_px: blur,
        raster_bounds: [
            g.bounds[0] - width / 2.0,
            g.bounds[1] - width / 2.0,
            g.bounds[2] + width,
            g.bounds[3] + width,
        ],
        opacity: 1.0,
        composite: "source-over",
        align: "left",
        baseline: "alphabetic",
    });
}
pub(super) fn emit(out: &mut Vec<Command>, a: &KanjiSlam, g: &Art) {
    let w = g.size[0] as f64;
    let h = g.size[1] as f64;
    let rect = [0.0, 0.0, w, h];
    if g.ghost {
        let mut d = Draw::new(1920.0, 1080.0);
        stroke_text(&mut d, a, g, CYAN, 18.0, 0.0);
        text(&mut d, a, g, solid(CYAN), "source-over", 0.18);
        surface(out, g.ids[3], g.size, d);
    }
    if !g.live {
        return;
    }
    let base = rgb255(a.color);
    let (top, mid, bot) = if a.fire {
        (
            mix(base, rgb255(rgb(0x1a0508)), 0.72),
            mix(base, rgb255(rgb(0x2a0608)), 0.45),
            mix(base, rgb255(rgb(0xff6a2a)), 0.2),
        )
    } else if a.night() {
        (
            mix(base, rgb255(rgb(0x0b1524)), 0.55),
            base,
            mix(base, rgb255(rgb(0xff7a4a)), 0.2),
        )
    } else {
        (
            mix(base, rgb255(DUSK), 0.55),
            base,
            mix(base, rgb255(SUNSET), 0.45),
        )
    };
    let mut d = Draw::new(1920.0, 1080.0);
    text(
        &mut d,
        a,
        g,
        linear(
            [0.0, 105.0],
            [0.0, h - 105.0],
            &[
                (0.0, css(top, 1.0)),
                (0.5, css(mid, 1.0)),
                (1.0, css(bot, 1.0)),
            ],
        ),
        "source-over",
        1.0,
    );
    let step = round(1500.0 / 95.0).max(9.0);
    let mut circles = Vec::new();
    let mut y = 0.0;
    while y < h {
        let mut x = (round(y / step) % 2.0) * step / 2.0;
        while x < w {
            let r = clamp(0.95 - (x / w) * 0.75 - (y / h) * 0.85) * 1.05 * step * 0.5;
            if r > 0.3 {
                circles.push([x, y, r]);
            }
            x += step;
        }
        y += step;
    }
    d.commands.push(Command::CircleBatch {
        transform: I,
        operations: vec![],
        clip: None,
        circles,
        paints: vec![opacity(
            fill(
                solid(if a.night() && !a.fire {
                    rgb(0x050a18)
                } else {
                    INK
                }),
                "source-atop",
            ),
            if a.fire {
                0.5
            } else if a.night() {
                0.42
            } else {
                0.3
            },
        )],
    });
    d.rect(
        rect,
        opacity(
            fill(
                linear(
                    [0.0, h * 0.7],
                    [0.0, h],
                    &[
                        (0.0, [1.0, 170.0 / 255.0, 90.0 / 255.0, 0.0]),
                        (
                            1.0,
                            if a.night() && !a.fire {
                                [1.0, 120.0 / 255.0, 80.0 / 255.0, 0.55]
                            } else {
                                [1.0, 200.0 / 255.0, 120.0 / 255.0, 0.7]
                            },
                        ),
                    ],
                ),
                "source-atop",
            ),
            if a.fire { 0.35 } else { 0.5 },
        ),
    );
    let cp = g.ch as u32;
    let code_unit = if cp > 0xffff {
        0xd800 + ((cp - 0x10000) >> 10)
    } else {
        cp
    };
    let mut rng = Rng::new(f64::from(hash(&[code_unit as f64, 1500.0])));
    let rects = (0..2600)
        .map(|_| {
            let x = rng.next() * w;
            let y = rng.next() * h;
            let s = 0.6 + rng.next() * 1500.0 / 700.0;
            [x, y, s, s]
        })
        .collect();
    d.commands.push(Command::RectBatch {
        transform: I,
        operations: vec![],
        clip: None,
        rects,
        paint: fill(solid([0.0, 0.0, 0.0, 0.35]), "destination-out"),
    });
    surface(out, g.ids[0], g.size, d);
    let ink = if a.fire {
        rgb(0x0a0204)
    } else if a.night() {
        rgb(0x03060f)
    } else {
        INK
    };
    let mut d = Draw::new(1920.0, 1080.0);
    stroke_text(&mut d, a, g, ink, 45.0, 0.0);
    text(&mut d, a, g, solid(ink), "source-over", 1.0);
    surface(out, g.ids[1], g.size, d);
    if a.fire {
        let mut d = Draw::new(1920.0, 1080.0);
        for (width, blur, color) in [
            (60.0, 15.0, 0xc8401e),
            (24.0, 6.0, 0xff9a3a),
            (7.5, 0.0, 0xffebb8),
        ] {
            stroke_text(&mut d, a, g, rgb(color), width, blur);
        }
        text(&mut d, a, g, solid([1.0; 4]), "destination-in", 1.0);
        surface(out, g.ids[2], g.size, d);
    }
    let mut d = Draw::new(1920.0, 1080.0);
    all(&mut d, g.ids[1], g.size, rect, "source-over", 1.0, 0.0);
    d.rect(
        rect,
        fill(
            solid(if a.night() {
                rgb(0x01030a)
            } else {
                rgb(0x0a0410)
            }),
            "source-in",
        ),
    );
    surface(out, g.ids[4], g.size, d);
}
