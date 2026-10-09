use super::{Sample, math, model, plan};
use crate::mv_recipe::model::Color;

fn alpha(mut color: Color, amount: f64) -> Color {
    color[3] *= amount;
    color
}
pub(super) fn kick(a: &model::Glow, s: &Sample<'_>, since: f64) -> plan::Glow {
    let center = s.point(a.center);
    let radius = a.radius * s.height;
    let amount = 0.3 * (-since * 9.0).exp();
    plan::Glow {
        center,
        radius,
        rect: [
            center[0] - radius,
            center[1] - radius,
            radius * 2.0,
            radius * 2.0,
        ],
        stops: [(0.0, 1.0), (0.25, 0.45), (1.0, 0.0)]
            .map(|(offset, k)| plan::Stop {
                offset,
                color: alpha(a.color, amount * k),
            })
            .into(),
    }
}
pub(super) fn morse(a: &model::Morse, s: &Sample<'_>) -> plan::Morse {
    let unit = a.unit * s.height;
    let gap = a.gap * s.height;
    let height = a.height * s.height;
    let total = a
        .elements
        .iter()
        .map(|e| f64::from(*e) * unit + gap)
        .sum::<f64>()
        - gap;
    let [cx, cy] = s.point(a.position);
    let mut x = cx - total / 2.0;
    let lit = (math::clamp(s.elapsed() / (s.duration() * 0.92)) * a.elements.len() as f64 + 1e-6)
        .floor() as usize;
    let elements = a
        .elements
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let width = f64::from(*e) * unit;
            let rect = plan::Rect {
                rect: [x, cy - height / 2.0, width, height],
                color: if i < lit { a.lit_color } else { a.unlit_color },
                opacity: 1.0,
            };
            x += width + gap;
            rect
        })
        .collect();
    plan::Morse {
        elements,
        label: plan::text(&a.label, s, 1.0),
    }
}
pub(super) fn flood(
    a: &model::Flicker,
    s: &Sample<'_>,
    white: f64,
) -> (Option<plan::Glow>, Option<Color>, Option<plan::Text>) {
    if white <= 0.0 {
        return (None, None, None);
    }
    let f = &a.flood;
    let center = s.point(f.center);
    let radius = (f.radius_from + (f.radius_to - f.radius_from) * white.powf(1.3)) * s.height;
    let stops = [
        (0.0, (white * 2.0).min(1.0)),
        (0.35, (white * 1.3).min(1.0)),
        (0.75, white * 0.5),
        (1.0, 1.0),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (offset, amount))| plan::Stop {
        offset,
        color: alpha(f.colors[i], amount),
    })
    .collect();
    let gradient = plan::Glow {
        center,
        radius,
        rect: [0.0, 0.0, s.width, s.height],
        stops,
    };
    let neg = math::clamp((white - 0.35) / 0.65);
    let negative = (neg > 0.0).then(|| plan::Text {
        font: a.font.clone(),
        text: a.negative.text.clone(),
        position: s.point(a.negative.position),
        font_size: (a.negative.font_size * s.height * (1.02 + 0.06 * neg)).round(),
        tracking: 0.0,
        color: a.negative.color,
        opacity: neg,
        blur: ((2.0 + 5.0 * (1.0 - neg)) * 10.0).round() / 10.0 * s.height / 1080.0,
    });
    (
        Some(gradient),
        Some(alpha(f.white, white.powf(1.7))),
        negative,
    )
}
