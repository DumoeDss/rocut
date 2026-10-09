use super::{draw::*, plan::*};
pub(super) const I: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub(super) const FRAME: [f64; 4] = [0.0, 0.0, 1920.0, 1080.0];
pub(super) fn linear(
    from: [f64; 2],
    to: [f64; 2],
    items: &[(f64, crate::mv_recipe::model::Color)],
) -> Style {
    Style::Linear {
        from,
        to,
        stops: stops(items),
    }
}
pub(super) fn opacity(mut p: Paint, a: f64) -> Paint {
    p.opacity = a;
    p
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
pub(super) fn append(out: &mut Vec<Command>, id: &'static str, draw: Draw) {
    out.push(Command::AppendSurface {
        surface: id,
        commands: draw.commands,
    });
}
pub(super) fn blit(
    d: &mut Draw,
    id: &'static str,
    source: [f64; 4],
    destination: [f64; 4],
    comp: &'static str,
    alpha: f64,
    blur: f64,
) {
    d.commands.push(Command::Blit {
        surface: id,
        source_rect: source,
        destination_rect: destination,
        transform: d.identity(),
        operations: d.operations.clone(),
        composite: comp,
        opacity: alpha,
        clip: d.clip.clone(),
        raster: Some(BlitRaster {
            blur_px: blur,
            smoothing: true,
            smoothing_quality: "low",
        }),
    });
}
pub(super) fn all(
    d: &mut Draw,
    id: &'static str,
    size: [u32; 2],
    rect: [f64; 4],
    comp: &'static str,
    alpha: f64,
    blur: f64,
) {
    blit(
        d,
        id,
        [0.0, 0.0, size[0] as f64, size[1] as f64],
        rect,
        comp,
        alpha,
        blur,
    );
}
pub(super) fn image(
    d: &mut Draw,
    id: &str,
    source: Option<[f64; 4]>,
    rect: [f64; 4],
    quality: &'static str,
) {
    d.commands.push(Command::Image {
        image: id.into(),
        source_rect: source,
        destination_rect: rect,
        transform: d.identity(),
        operations: d.operations.clone(),
        clip: d.clip.clone(),
        composite: "source-over",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: quality,
    });
}
pub(super) fn pattern(
    d: &mut Draw,
    id: &'static str,
    rect: [f64; 4],
    comp: &'static str,
    alpha: f64,
) {
    d.commands.push(Command::SurfacePatternRect {
        surface: id,
        rect,
        transform: d.identity(),
        operations: d.operations.clone(),
        clip: d.clip.clone(),
        composite: comp,
        opacity: alpha,
        smoothing: true,
        smoothing_quality: "low",
    });
}
pub(super) fn glow(
    d: &mut Draw,
    x: f64,
    y: f64,
    r: f64,
    color: crate::mv_recipe::model::Color,
    alpha: f64,
) {
    d.glow(
        x,
        y,
        r,
        &[
            (0.0, rgba(color, alpha)),
            (0.25, rgba(color, alpha * 0.45)),
            (1.0, rgba(color, 0.0)),
        ],
        "lighter",
    );
}
