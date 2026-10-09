use super::{draw::*, plan::*};
pub(super) const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub(super) const FRAME: [f64; 4] = [0.0, 0.0, 1920.0, 1080.0];
pub(super) fn rect_path(rect: [f64; 4]) -> Vec<Step> {
    // Canvas retains a rectangle primitive for clipping; manually transformed
    // polygon corners need not have the same antialiasing at fractional CTMs.
    vec![Step::Rect { rect }]
}
pub(super) fn source_stroke(style: Style, width: f64) -> Paint {
    Paint {
        style,
        composite: "source-over",
        opacity: 1.0,
        kind: PaintKind::Stroke {
            width,
            cap: "butt",
            join: "miter",
        },
    }
}
pub(super) fn blit(
    d: &mut Draw,
    id: &'static str,
    size: [u32; 2],
    rect: [f64; 4],
    composite: &'static str,
    opacity: f64,
    blur: f64,
    quality: &'static str,
) {
    d.commands.push(Command::Blit {
        surface: id,
        source_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
        destination_rect: rect,
        transform: d.identity(),
        operations: d.operations.clone(),
        composite,
        opacity,
        clip: d.clip.clone(),
        raster: Some(BlitRaster {
            blur_px: blur,
            smoothing: true,
            smoothing_quality: quality,
        }),
    });
}
pub(super) fn surface(out: &mut Vec<Command>, id: &'static str, size: [u32; 2], draw: Draw) {
    out.push(Command::Surface {
        id,
        size,
        commands: draw.commands,
    });
}
pub(super) fn release(out: &mut Vec<Command>, id: &'static str) {
    out.push(Command::ReleaseSurface { surface: id });
}
pub(super) fn linear(
    from: [f64; 2],
    to: [f64; 2],
    colors: &[(f64, crate::mv_recipe::model::Color)],
) -> Style {
    Style::Linear {
        from,
        to,
        stops: stops(colors),
    }
}
pub(super) fn radial_between(
    from: [f64; 3],
    to: [f64; 3],
    colors: &[(f64, crate::mv_recipe::model::Color)],
) -> Style {
    Style::Radial {
        from,
        to,
        stops: stops(colors),
    }
}
