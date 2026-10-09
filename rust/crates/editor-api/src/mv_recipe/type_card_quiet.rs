use super::{
    Sample, math,
    model::{Orientation, Quiet},
    plan,
};

pub(super) fn resolve(a: &Quiet, s: &Sample<'_>) -> Result<plan::Plan, String> {
    let fonts = s
        .fonts
        .ok_or("TypeCard quiet requires verified font metrics")?;
    let boxes = a
        .glyphs
        .iter()
        .map(|g| fonts.glyph(&a.font, &g.text))
        .collect::<Result<Vec<_>, _>>()?;
    let vertical = matches!(a.orientation, Orientation::Vertical);
    let size = a.font_size * s.height;
    let ext: Vec<f64> = boxes
        .iter()
        .zip(&a.glyphs)
        .map(|(b, g)| {
            (if vertical {
                b.ascent + b.descent
            } else {
                b.left + b.right
            }) / 100.0
                * size
                * g.optical_scale
        })
        .collect();
    let gap = size * a.gap;
    let total = ext.iter().sum::<f64>() + gap * (a.glyphs.len() - 1) as f64;
    let [cx, cy] = s.point(a.center);
    let t = s.elapsed();
    let hold = 0.96 - 0.1 * math::smooth((t - (s.duration() - 0.7)) / 0.7);
    let mut position = if vertical { cy } else { cx } - total / 2.0;
    let mut glyphs = Vec::new();
    for (i, (g, b)) in a.glyphs.iter().zip(&boxes).enumerate() {
        let k = math::clamp((t - a.lead - i as f64 * a.stagger) / a.fade);
        let e = math::soft(k);
        let px = size * g.optical_scale;
        if k > 0.0 {
            let blur = (1.0 - e) * 6.0;
            let drift = (1.0 - e) * 7.0 * s.height / 1080.0;
            glyphs.push(plan::Text {
                font: a.font.clone(),
                text: g.text.clone(),
                font_size: (px * 10.0).round() / 10.0,
                tracking: 0.0,
                color: a.color,
                opacity: e * hold,
                blur: if blur > 0.25 {
                    (blur * 100.0).round() / 100.0 * s.height / 1080.0
                } else {
                    0.0
                },
                position: if vertical {
                    [
                        cx - (b.right - b.left) / 200.0 * px,
                        position + b.ascent / 100.0 * px + drift,
                    ]
                } else {
                    [position + b.left / 100.0 * px, cy + drift]
                },
            });
        }
        position += ext[i] + gap;
    }
    let mut rule = Vec::new();
    if let Some(r) = &a.rule {
        let k = math::out(math::clamp((t - a.lead - 0.2) / 1.3));
        let creep = 1.0 + 0.05 * math::clamp((t - 1.2) / 1.6);
        let len = (total * r.length_scale + r.length_padding * s.height) * k * creep;
        let off = r.offset * s.height;
        let width = r.width * s.height;
        let rect = if vertical {
            [cx + off, cy - len / 2.0, width, len]
        } else {
            [cx - len / 2.0, cy + off, len, width]
        };
        rule.push(plan::Rect {
            rect,
            color: r.color,
            opacity: 0.95,
        });
        let tk = math::soft(math::clamp((t - a.lead - 1.0) / 0.35));
        if tk > 0.0 {
            let th = r.tick_length * s.height * tk;
            let ticks = if vertical {
                [
                    [cx + off - th / 2.0, cy - len / 2.0, th, width],
                    [cx + off - th / 2.0, cy + len / 2.0 - width, th, width],
                ]
            } else {
                [
                    [cx - len / 2.0, cy + off - th / 2.0, width, th],
                    [cx + len / 2.0 - width, cy + off - th / 2.0, width, th],
                ]
            };
            rule.extend(ticks.into_iter().map(|rect| plan::Rect {
                rect,
                color: r.color,
                opacity: tk * 0.85 * 0.95,
            }));
        }
    }
    let subtitle = a.subtitle.as_ref().map(|v| {
        plan::text(
            v,
            s,
            0.42 * math::soft(math::clamp((t - a.lead - 0.8) / 0.8)),
        )
    });
    Ok(plan::Plan {
        mode: "quiet",
        background: a.background,
        quiet: Some(plan::Quiet {
            glyphs,
            rule,
            subtitle,
        }),
        flicker: None,
        grain: math::grain(s.seed, s.song_ticks * 24 / 120_000, a.grain),
        flood: None,
        white: None,
        negative: None,
    })
}
