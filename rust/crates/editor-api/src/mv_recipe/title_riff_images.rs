use super::{
    draw::*,
    model::{TitleRiff, View},
    palette::{Palette, rgb},
    plan::*,
    raster::*,
    recording::Recording,
};
use crate::mv_image_dimensions::Context;

pub(super) fn image(
    d: &mut Draw,
    id: &str,
    rect: [f64; 4],
    composite: &'static str,
    opacity: f64,
    quality: &'static str,
) {
    d.commands.push(Command::Image {
        image: id.into(),
        source_rect: None,
        destination_rect: rect,
        transform: d.identity(),
        operations: d.operations.clone(),
        clip: d.clip.clone(),
        composite,
        opacity,
        smoothing: true,
        smoothing_quality: quality,
    });
}
pub(super) fn cover(
    d: &mut Draw,
    id: &str,
    view: View,
    images: &Context,
    recording: &mut Recording,
) -> Result<(), String> {
    let size = images.image(id)?;
    let scale = (1920.0 / size.width as f64).max(1080.0 / size.height as f64) * view.zoom;
    let width = size.width as f64 * scale;
    let height = size.height as f64 * scale;
    recording.save(&[Operation::Translate {
        offset: [
            960.0 + view.x * ((width - 1920.0) / 2.0).max(0.0),
            540.0 + view.y * ((height - 1080.0) / 2.0).max(0.0),
        ],
    }]);
    if view.rot != 0.0 {
        recording.transform(Operation::Rotate { radians: view.rot });
    }
    d.operations = recording.operations();
    image(
        d,
        id,
        [-width / 2.0, -height / 2.0, width, height],
        "source-over",
        1.0,
        "high",
    );
    recording.resource(id, [size.width, size.height])?;
    recording.restore();
    d.operations = recording.operations();
    Ok(())
}
pub(super) fn sprite(
    d: &mut Draw,
    id: &str,
    pos: [f64; 2],
    height: f64,
    anchor: [f64; 2],
    rotation: f64,
    breathe: f64,
    opacity: f64,
    images: &Context,
    recording: &mut Recording,
) -> Result<(), String> {
    let size = images.image(id)?;
    let width = size.width as f64 * height / size.height as f64;
    recording.save(&[
        Operation::Translate { offset: pos },
        Operation::Rotate { radians: rotation },
        Operation::Scale {
            factors: [1.0, breathe],
        },
    ]);
    d.operations = recording.operations();
    image(
        d,
        id,
        [-width * anchor[0], -height * anchor[1], width, height],
        "source-over",
        opacity,
        "high",
    );
    recording.resource(id, [size.width, size.height])?;
    recording.restore();
    d.operations = recording.operations();
    Ok(())
}
pub(super) fn mask_sprite(
    d: &mut Draw,
    id: &'static str,
    size: [u32; 2],
    pos: [f64; 2],
    height: f64,
    rotation: f64,
    opacity: f64,
    recording: &mut Recording,
) -> Result<(), String> {
    let width = size[0] as f64 * height / size[1] as f64;
    recording.save(&[
        Operation::Translate { offset: pos },
        Operation::Rotate { radians: rotation },
        Operation::Scale {
            factors: [1.0, 1.0],
        },
    ]);
    d.operations = recording.operations();
    blit(
        d,
        id,
        size,
        [-width * 0.46, -height, width, height],
        "source-over",
        opacity,
        0.0,
        "high",
    );
    recording.surface(id, 0, size)?;
    recording.restore();
    d.operations = recording.operations();
    Ok(())
}
pub(super) fn masks(
    out: &mut Vec<Command>,
    a: &TitleRiff,
    p: &Palette,
    images: &Context,
) -> Result<[u32; 2], String> {
    let character = images.image(&a.character)?;
    let sky = images.image(&a.sky)?;
    let size = [character.width, character.height];
    if size.iter().any(|v| *v > 4096) {
        return Err(
            "titleRiff character scratch masks require decoded dimensions at most4096".into(),
        );
    }
    let width = character.width as f64;
    let height = character.height as f64;
    let mut cut = Draw::new(1920.0, 1080.0);
    let scale = (width / sky.width as f64).max(height / sky.height as f64) * 1.15;
    image(
        &mut cut,
        &a.sky,
        [
            (width - sky.width as f64 * scale) * 0.5,
            (height - sky.height as f64 * scale) * 0.25,
            sky.width as f64 * scale,
            sky.height as f64 * scale,
        ],
        "source-over",
        1.0,
        "low",
    );
    cut.rect(
        [0.0, 0.0, width, height],
        fill(
            linear(
                [0.0, 0.0],
                [0.0, height],
                &[(0.0, rgb(0x5a3a6e)), (0.55, p.dusk), (1.0, rgb(0x1a0d24))],
            ),
            "multiply",
        ),
    );
    image(
        &mut cut,
        &a.character,
        [0.0, 0.0, width, height],
        "destination-in",
        1.0,
        "low",
    );
    surface(out, "title-sky-cutout", size, cut);
    let mut rim = Draw::new(1920.0, 1080.0);
    image(
        &mut rim,
        &a.character,
        [0.0, 0.0, width, height],
        "source-over",
        1.0,
        "low",
    );
    rim.rect([0.0, 0.0, width, height], fill(solid(p.core), "source-in"));
    surface(out, "title-rim", size, rim);
    Ok(size)
}
