//! Narrow direct filtered-fill primitive. The target's existing backing is
//! charged by surface lifetimes; this adds filter intermediates, never RSS.
use super::super::plan::{BlitRaster, Command, PaintKind, Style};

pub(super) fn cost(command: &Command) -> Result<u64, String> {
    let Command::FilteredRect {
        transform,
        operations,
        clip,
        rect,
        paint,
        blur_px,
    } = command
    else {
        return Err("Expected filtered rectangle command".into());
    };
    if *transform != [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        || !operations.is_empty()
        || clip.is_some()
        || rect.iter().any(|v| !v.is_finite())
        || rect[..2].iter().any(|v| v.abs() > 1_000_000.0)
        || rect[2..].iter().any(|v| v.abs() > 8192.0)
        || !matches!(paint.kind, PaintKind::Fill)
        || !paint.opacity.is_finite()
        || !(0.0..=1.0).contains(&paint.opacity)
        || !["source-over", "lighter"].contains(&paint.composite)
        || !style_valid(&paint.style)
    {
        return Err("Filtered fillRect requires identity CTM, no operations/clip, bounded finite fill and source-over/lighter compositing".into());
    }
    super::filter_pixels(
        &BlitRaster {
            blur_px: *blur_px,
            contrast: None,
            smoothing: true,
            smoothing_quality: "low",
        },
        rect,
    )
}

fn color_valid(c: &[f64; 4]) -> bool {
    c.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
}
fn style_valid(style: &Style) -> bool {
    let stops = match style {
        Style::Solid { color } => return color_valid(color),
        Style::Linear { from, to, stops } => {
            if from
                .iter()
                .chain(to)
                .any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
            {
                return false;
            }
            stops
        }
        Style::Radial { from, to, stops } => {
            if from
                .iter()
                .chain(to)
                .any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
                || from[2] < 0.0
                || to[2] < 0.0
            {
                return false;
            }
            stops
        }
    };
    stops.len() <= 32
        && stops.iter().all(|v| {
            v.offset.is_finite() && (0.0..=1.0).contains(&v.offset) && color_valid(&v.color)
        })
}

#[cfg(test)]
#[path = "fall_filtered_rect_tests.rs"]
mod tests;
