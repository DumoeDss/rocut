use super::{
    draw::*,
    ease::jsround,
    labels::{Label, plain},
    plan::*,
    raster::IDENTITY,
};
use crate::mv_font_metrics::{BoundsRequest, Context, TextAlign, TextBaseline};
pub(super) fn draw(d: &mut Draw, label: &Label, metrics: &Context) -> Result<(), String> {
    let text = if label.hud {
        plain(&label.text)
    } else {
        label.text.clone()
    };
    let align = if label.hud || label.align == "left" {
        TextAlign::Left
    } else if label.align == "right" {
        TextAlign::Right
    } else {
        TextAlign::Center
    };
    let baseline = if label.baseline == "middle" {
        TextBaseline::Middle
    } else {
        TextBaseline::Alphabetic
    };
    metrics.bounds(
        &label.font,
        &BoundsRequest {
            version: 1,
            text: text.clone(),
            font_size_px: label.size,
            letter_spacing_px: label.tracking,
            align,
            baseline,
        },
    )?;
    let mut position = label.position;
    if label.hud {
        let width = metrics.advance(&label.font, &text, label.size, 0.0)?;
        position = [
            jsround(
                position[0]
                    - match label.align {
                        "right" => width,
                        "center" => width / 2.0,
                        _ => 0.0,
                    },
            ),
            jsround(position[1]),
        ];
    }
    d.commands.push(Command::Text {
        font: label.font.clone(),
        text,
        font_size: label.size,
        tracking: label.tracking,
        position,
        transform: IDENTITY,
        operations: label.operations.clone(),
        fill: TextFill::Color { color: label.color },
        opacity: label.opacity,
        composite: "source-over",
        align: if label.hud { "left" } else { label.align },
        baseline: label.baseline,
    });
    if label.hud {
        let previous = std::mem::replace(&mut d.operations, label.operations.clone());
        let mut prefix = String::new();
        for ch in label.text.chars() {
            if ch == 'Ō' {
                let pre = metrics.advance(&label.font, &prefix, label.size, 0.0)?;
                let width = metrics.advance(&label.font, "O", label.size, 0.0)?;
                let mut paint = fill(solid(label.color), "source-over");
                paint.opacity = label.opacity;
                d.rect(
                    [
                        jsround(position[0] + pre + width * 0.2),
                        jsround(label.position[1] - label.size * 0.96),
                        jsround(width * 0.6),
                        2.0f64.max(jsround(label.size * 0.09)),
                    ],
                    paint,
                );
            }
            prefix.push(match ch {
                'Ō' => 'O',
                'ō' => 'o',
                other => other,
            });
        }
        d.operations = previous;
    }
    Ok(())
}
