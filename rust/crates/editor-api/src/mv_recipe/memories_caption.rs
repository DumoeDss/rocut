use super::{
    Photo, Session,
    draw::*,
    plan::{Command, MemoryCommand, Operation, common::native},
};
pub fn draw(d: &mut Draw, s: &Session, p: &Photo, k: f64) -> Result<(), String> {
    let chars: Vec<char> = p.caption.chars().collect();
    if chars.is_empty() || k <= 0.0 {
        return Ok(());
    }
    let seed = p.index as f64 * 13.0 + 5.0;
    let shown = k * (chars.len() + 1) as f64;
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate {
        offset: [36.0, 403.0],
    });
    d.operations.push(Operation::Rotate {
        radians: -0.018 + super::math::rnds(&[seed, 3.0]) * 0.012,
    });
    let mut x = 0.0;
    for (i, ch) in chars.iter().enumerate() {
        let ki = (shown - i as f64).clamp(0.0, 1.0);
        if ki <= 0.0 {
            break;
        }
        let text = ch.to_string();
        let width = *s
            .facts
            .caption
            .widths
            .get(&text)
            .ok_or("Memories caption native width is missing")?;
        let clip = if ki < 1.0 {
            Some(native::Clip {
                transform: ID,
                operations: d.operations.clone(),
                path: vec![native::Step::Rect {
                    rect: [x - 4.0, -40.0, (width + 8.0) * ki, 60.0],
                }],
            })
        } else {
            None
        };
        let mut operations = d.operations.clone();
        operations.push(Operation::Translate {
            offset: [x, super::math::rnds(&[i as f64, seed]) * 2.2],
        });
        operations.push(Operation::Rotate {
            radians: super::math::rnds(&[i as f64, seed + 1.0]) * 0.035,
        });
        d.commands
            .push(Command::Memories(MemoryCommand::ClippedText {
                font: s.args.caption_font.clone(),
                text,
                font_size: 40.0,
                position: [0.0, 0.0],
                transform: ID,
                operations,
                clip,
                color: color(52.0, 58.0, 84.0, 0.9),
                opacity: 1.0,
            }));
        x += width * 0.96 + 1.0;
    }
    let kd = (shown - chars.len() as f64).clamp(0.0, 1.0);
    if kd > 0.0 && !p.date.is_empty() {
        let width = *s
            .facts
            .date
            .widths
            .get(&p.date)
            .ok_or("Memories date native width is missing")?;
        let clip = Some(native::Clip {
            transform: ID,
            operations: d.operations.clone(),
            path: vec![native::Step::Rect {
                rect: [520.0 - 30.0 - width - 4.0, -30.0, (width + 8.0) * kd, 44.0],
            }],
        });
        d.commands
            .push(Command::Memories(MemoryCommand::ClippedText {
                font: s.args.date_font.clone(),
                text: p.date.clone(),
                font_size: 22.0,
                position: [520.0 - 30.0 - width, -2.0],
                transform: ID,
                operations: d.operations.clone(),
                clip,
                color: color(52.0, 58.0, 84.0, 0.62),
                opacity: 1.0,
            }));
    }
    d.operations = saved;
    Ok(())
}
