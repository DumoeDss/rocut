use super::{draw::Draw, plan::*};
pub(super) const I: Matrix = [1., 0., 0., 1., 0., 0.];
pub(super) const FRAME: [f64; 4] = [0., 0., 1920., 1080.];
pub(super) const COVER: [f64; 4] = [-2400., -2400., 6720., 5880.];
pub(super) fn surface(out: &mut Vec<Command>, id: &'static str, size: [u32; 2], d: Draw) {
    out.push(Command::Surface {
        id,
        size,
        commands: d.commands,
    });
}
pub(super) fn append(out: &mut Vec<Command>, id: &'static str, d: Draw) {
    out.push(Command::AppendSurface {
        surface: id,
        commands: d.commands,
    });
}
pub(super) fn release(out: &mut Vec<Command>, id: &'static str) {
    out.push(Command::ReleaseSurface { surface: id });
}
pub(super) fn blit(
    d: &mut Draw,
    id: &'static str,
    source: [f64; 4],
    destination: [f64; 4],
    composite: &'static str,
    opacity: f64,
    blur: f64,
    contrast: Option<f64>,
) {
    d.commands.push(Command::Blit {
        surface: id,
        source_rect: source,
        destination_rect: destination,
        transform: d.identity(),
        operations: d.operations.clone(),
        composite,
        opacity,
        clip: d.clip.clone(),
        raster: Some(BlitRaster {
            blur_px: blur,
            contrast,
            smoothing: true,
            smoothing_quality: "low",
        }),
    });
}
pub(super) fn all(
    d: &mut Draw,
    id: &'static str,
    size: [u32; 2],
    destination: [f64; 4],
    composite: &'static str,
    opacity: f64,
    blur: f64,
) {
    blit(
        d,
        id,
        [0., 0., size[0] as f64, size[1] as f64],
        destination,
        composite,
        opacity,
        blur,
        None,
    );
}
pub(super) fn image(d: &mut Draw, id: &str, destination: [f64; 4], composite: &'static str) {
    d.commands.push(Command::Image {
        image: id.into(),
        source_rect: None,
        destination_rect: destination,
        transform: d.identity(),
        operations: d.operations.clone(),
        clip: None,
        composite,
        opacity: 1.,
        smoothing: true,
        smoothing_quality: "low",
    });
}
