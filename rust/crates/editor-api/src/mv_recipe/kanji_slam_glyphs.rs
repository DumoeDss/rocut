use super::{
    clock::Clock,
    draw::*,
    fire,
    glyph_art::{self, Art},
    model::KanjiSlam,
    plan::*,
    raster::*,
    state::{Glyph, State},
};
use crate::mv_font_metrics::Context;
pub(super) fn stream(
    out: &mut Vec<Command>,
    a: &KanjiSlam,
    c: &Clock,
    s: &State,
    fonts: &Context,
) -> Result<(), String> {
    surface(
        out,
        "ks-glyph-layer",
        [1920, 1080],
        Draw::new(1920.0, 1080.0),
    );
    if a.fire {
        fire::begin_silhouette(out);
    }
    let mut next_id = 0;
    for (ghost, glyphs) in [(true, &s.previous), (false, &s.glyphs)] {
        let mut arts: Vec<Art> = Vec::new();
        for (index, glyph) in glyphs.iter().enumerate() {
            let art_index = if let Some(index) = arts.iter().position(|a| a.ch == glyph.ch) {
                index
            } else {
                let mut art = glyph_art::geometry(glyph.ch, next_id, a, fonts)?;
                next_id += 1;
                art.live = !ghost;
                art.ghost = ghost;
                glyph_art::emit(out, a, &art);
                arts.push(art);
                arts.len() - 1
            };
            let mut d = Draw::new(1920.0, 1080.0);
            d.operations = s.camera(1.0);
            word(
                &mut d,
                a,
                std::slice::from_ref(glyph),
                &arts,
                if ghost {
                    1.02 + c.elapsed * 0.12
                } else {
                    s.glyph_scale
                },
                if ghost {
                    0.85 * (-c.elapsed * 5.5).exp()
                } else {
                    0.0
                },
                if ghost { 0.0 } else { s.smear },
                if ghost { 0.0 } else { s.burn },
            );
            append(out, "ks-glyph-layer", d);
            if a.fire && !ghost {
                fire::append_silhouette(out, s, glyph, &arts[art_index]);
            }
            // Keep repeated letters only until their final original-order use.
            // No redraw/cache expansion for words such as AABAA.
            if !glyphs[index + 1..].iter().any(|g| g.ch == glyph.ch) {
                release_all(out, a, std::slice::from_ref(&arts[art_index]));
                arts.remove(art_index);
            }
        }
    }
    Ok(())
}
pub(super) fn transform(d: &mut Draw, g: &Glyph, art: &Art, scale: f64) {
    let sc = (g.scale * 1080.0 / art.ink_h) * scale;
    d.operations
        .push(Operation::Translate { offset: [g.x, g.y] });
    d.operations.push(Operation::Rotate {
        radians: g.rotation,
    });
    d.operations.push(Operation::Scale { factors: [sc, sc] });
}
pub(super) fn word(
    d: &mut Draw,
    a: &KanjiSlam,
    glyphs: &[Glyph],
    arts: &[Art],
    scale: f64,
    ghost: f64,
    smear: f64,
    burn: f64,
) {
    for g in glyphs {
        let art = arts
            .iter()
            .find(|v| v.ch == g.ch)
            .expect("prepared every glyph");
        let count = d.operations.len();
        transform(d, g, art, scale);
        let w = art.size[0] as f64;
        let h = art.size[1] as f64;
        let rect = [-w / 2.0, -h / 2.0, w, h];
        if ghost > 0.0 {
            all(d, art.ids[3], art.size, rect, "lighter", ghost, 0.0);
        } else {
            all(
                d,
                art.ids[4],
                art.size,
                [rect[0] + 1500.0 * 0.035, rect[1] + 1500.0 * 0.028, w, h],
                "source-over",
                0.55,
                0.0,
            );
            all(
                d,
                art.ids[1],
                art.size,
                [rect[0] + 6.0, rect[1] + 4.5, w, h],
                "source-over",
                1.0,
                0.0,
            );
            all(d, art.ids[0], art.size, rect, "source-over", 1.0, 0.0);
            if a.fire && burn != 0.0 {
                all(d, art.ids[2], art.size, rect, "lighter", burn, 0.0);
            }
            if smear != 0.0 {
                for (k, alpha) in [(1.16, 0.28), (1.38, 0.13)] {
                    all(
                        d,
                        art.ids[0],
                        art.size,
                        [rect[0] * k, rect[1] * k, w * k, h * k],
                        "source-over",
                        alpha * smear,
                        0.0,
                    );
                }
            }
        }
        d.operations.truncate(count);
    }
}
pub(super) fn release_all(out: &mut Vec<Command>, a: &KanjiSlam, arts: &[Art]) {
    for art in arts {
        for (i, id) in art.ids.iter().enumerate() {
            if i == 3 && art.ghost || i != 3 && art.live && (i != 2 || a.fire) {
                release(out, id);
            }
        }
    }
}
