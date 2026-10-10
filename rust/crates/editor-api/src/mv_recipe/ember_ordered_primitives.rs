//! Validate new native Canvas protocol boundaries before allocating surfaces.
use super::super::plan::{Command, Operation, PaintKind, Step};

fn finite(values: &[f64], bound: f64) -> bool {
    values.iter().all(|v| v.is_finite() && v.abs() <= bound)
}

fn operations(ops: &[Operation]) -> Result<(), String> {
    for op in ops {
        if let Operation::CopyScaledTransform { scale, offset } = op {
            if !scale.is_finite() || *scale <= 0.0 || *scale > 8.0 || !finite(offset, 1_000_000.0) {
                return Err("Invalid native scaled Canvas transform copy".into());
            }
        }
    }
    Ok(())
}

fn path(steps: &[Step]) -> Result<(), String> {
    for step in steps {
        if let Step::Ellipse {
            center,
            radii,
            rotation,
            start,
            end,
            ..
        } = step
        {
            if !finite(center, 1_000_000.0)
                || !finite(radii, 8192.0)
                || radii.iter().any(|v| *v < 0.0)
                || !finite(&[*rotation, *start, *end], 1_000_000.0)
            {
                return Err("Invalid bounded native ellipse".into());
            }
        }
    }
    Ok(())
}

pub(super) fn validate(commands: &[Command]) -> Result<(), String> {
    for command in commands {
        match command {
            Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                validate(commands)?;
            }
            Command::GradientRect {
                transform,
                operations: draw_ops,
                clip,
                rect,
                paint,
                style_transform,
                style_operations,
            } => {
                if !finite(transform, 1_000_000.0)
                    || !finite(style_transform, 1_000_000.0)
                    || !finite(&rect[..2], 1_000_000.0)
                    || !finite(&rect[2..], 8192.0)
                    || !matches!(paint.kind, PaintKind::Fill)
                {
                    return Err("Gradient rectangle requires bounded independent draw/brush CTMs and fill paint".into());
                }
                operations(draw_ops)?;
                operations(style_operations)?;
                if let Some(clip) = clip {
                    operations(&clip.operations)?;
                    path(&clip.path)?;
                }
            }
            Command::Path {
                operations: ops,
                clip,
                path: steps,
                ..
            } => {
                operations(ops)?;
                path(steps)?;
                if let Some(clip) = clip {
                    operations(&clip.operations)?;
                    path(&clip.path)?;
                }
            }
            Command::CircleBatch {
                operations: ops,
                clip,
                ..
            }
            | Command::Rect {
                operations: ops,
                clip,
                ..
            }
            | Command::FilteredRect {
                operations: ops,
                clip,
                ..
            }
            | Command::RectBatch {
                operations: ops,
                clip,
                ..
            }
            | Command::SurfacePatternRect {
                operations: ops,
                clip,
                ..
            }
            | Command::Blit {
                operations: ops,
                clip,
                ..
            }
            | Command::Image {
                operations: ops,
                clip,
                ..
            }
            | Command::TextStroke {
                operations: ops,
                clip,
                ..
            } => {
                operations(ops)?;
                if let Some(clip) = clip {
                    operations(&clip.operations)?;
                    path(&clip.path)?;
                }
            }
            Command::Text {
                operations: ops, ..
            } => operations(ops)?,
            _ => {}
        }
    }
    Ok(())
}
