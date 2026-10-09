use super::{
    clock::Clock,
    draw::*,
    ease::ease,
    fonts::ink_request,
    math::*,
    model::{Easing, TitleRiff},
    palette::{Palette, rgb},
    plan::*,
    raster::*,
    state::State,
};
use crate::mv_font_metrics::Context;
pub(super) struct Glyph<'a> {
    pub text: &'a str,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub surface: &'static str,
}
pub(super) fn layouts<'a>(a: &'a TitleRiff, c: &Clock, s: &State) -> Vec<Glyph<'a>> {
    let t = c.time;
    let q = a.cues;
    let z = c.at(q.zan);
    let k = c.at(q.ko);
    let split = c.at(q.split);
    if t < z - 0.001 {
        return Vec::new();
    }
    let split_k = ease(seg(t, split - 0.04, 0.42), Easing::Io);
    let push = c
        .cues
        .iter()
        .filter(|b| **b > split + 0.1 && **b < c.at(q.lock) - 0.1)
        .map(|b| 14.0 * ease(seg(t, *b, 0.25), Easing::Out))
        .sum::<f64>()
        * (1.0 - s.lock);
    let exit = ease(seg(t, c.at(q.exit), 0.4), Easing::In) * 900.0;
    let mix = |first: [f64; 3], mid: [f64; 3], last: [f64; 3], dt: f64| -> [f64; 3] {
        let mut v = std::array::from_fn(|i| lerp(lerp(first[i], mid[i], split_k), last[i], s.lock));
        v[2] *= if dt < 0.0 {
            1.32
        } else {
            1.0 + 0.32 * (-12.0 * dt).exp() * (22.0 * dt).cos()
        };
        v
    };
    let mut out = Vec::new();
    if t < k || split_k > 0.0 {
        let v = mix(
            if t >= k {
                [-620.0, 540.0, 940.0]
            } else {
                [560.0, 560.0, 1480.0]
            },
            [250.0, 540.0, 940.0],
            [490.0, 500.0, 400.0],
            t - z,
        );
        out.push(Glyph {
            text: &a.glyphs[0],
            x: v[0] - push - exit,
            y: v[1],
            size: v[2],
            surface: "title-monument-0",
        });
    }
    if t >= k {
        let v = mix(
            [1380.0, 530.0, 1480.0],
            [1670.0, 540.0, 940.0],
            [1430.0, 500.0, 400.0],
            t - k,
        );
        out.push(Glyph {
            text: &a.glyphs[1],
            x: v[0] + push + exit,
            y: v[1],
            size: v[2],
            surface: "title-monument-1",
        });
    }
    out
}
fn glyph(
    d: &mut Draw,
    a: &TitleRiff,
    text: &str,
    position: [f64; 2],
    size: f64,
    style: Style,
    opacity: f64,
    metrics: &Context,
) -> Result<(), String> {
    let bounds = metrics.bounds(&a.fonts.title, &ink_request(text))?;
    let mut operations = d.operations.clone();
    operations.push(Operation::Translate { offset: position });
    operations.push(Operation::Scale {
        factors: [size / 1000.0, size / 1000.0],
    });
    d.commands.push(Command::Text {
        font: a.fonts.title.clone(),
        text: text.into(),
        font_size: 1000.0,
        tracking: 0.0,
        position: [
            -(bounds.right - bounds.left) / 2.0,
            -(bounds.descent - bounds.ascent) / 2.0,
        ],
        transform: IDENTITY,
        operations,
        fill: TextFill::Style { style },
        opacity,
        composite: "source-over",
        align: "left",
        baseline: "alphabetic",
    });
    Ok(())
}
pub(super) fn monuments(
    out: &mut Vec<Command>,
    a: &TitleRiff,
    s: &State,
    p: &Palette,
    items: &[Glyph<'_>],
    metrics: &Context,
) -> Result<(), String> {
    if s.lock >= 0.999 || items.is_empty() {
        return Ok(());
    }
    super::textures::halftone(out, "title-half-12", p.ink, 12.0);
    for g in items {
        let mut d = Draw::new(1920.0, 1080.0);
        d.operations = s.camera.clone();
        // intro.js copies the camera CTM onto the scratch canvas. Replaying
        // camera operations alone misses Canvas's matrix-copy quantization.
        d.operations.push(Operation::CopyTransform);
        let off = g.size * 0.007;
        glyph(
            &mut d,
            a,
            g.text,
            [g.x - off, g.y - off * 0.8],
            g.size,
            solid(if a.outro() { p.glow } else { p.sunset }),
            1.0,
            metrics,
        )?;
        let colors = if a.outro() {
            [rgb(0xf6b2a6), rgb(0xe0707e), rgb(0x8a5a98)]
        } else {
            [rgb(0xe24a3b), rgb(0xc8373a), rgb(0x8c2342)]
        };
        glyph(
            &mut d,
            a,
            g.text,
            [g.x, g.y],
            g.size,
            linear(
                [0.0, -520.0],
                [0.0, 520.0],
                &[(0.0, colors[0]), (0.5, colors[1]), (1.0, colors[2])],
            ),
            1.0,
            metrics,
        )?;
        d.operations.clear();
        blit(
            &mut d,
            "title-half-12",
            [1920, 1080],
            FRAME,
            "source-atop",
            if a.outro() { 0.35 } else { 0.5 },
            0.0,
            "low",
        );
        surface(out, g.surface, [1920, 1080], d);
    }
    release(out, "title-half-12");
    Ok(())
}
pub(super) fn draw(
    d: &mut Draw,
    a: &TitleRiff,
    s: &State,
    p: &Palette,
    items: &[Glyph<'_>],
    metrics: &Context,
) -> Result<(), String> {
    for g in items {
        if s.lock < 0.999 {
            d.operations.clear();
            blit(
                d,
                g.surface,
                [1920, 1080],
                FRAME,
                "source-over",
                1.0 - s.lock,
                0.0,
                "low",
            );
            d.operations = s.camera.clone();
        }
        if s.lock > 0.001 {
            glyph(
                d,
                a,
                g.text,
                [g.x + 7.0 * s.lock, g.y + 7.0 * s.lock],
                g.size,
                solid(p.verm),
                s.lock,
                metrics,
            )?;
            glyph(
                d,
                a,
                g.text,
                [g.x, g.y],
                g.size,
                solid(p.hi),
                s.lock,
                metrics,
            )?;
        }
    }
    Ok(())
}
