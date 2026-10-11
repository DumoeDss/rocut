//! Original sky shardSprites base/glow/dark variants; no Heart mask is applied.
use super::{
    draw::*,
    plan::{Command, HeartCommand, Shadow, native},
    sky_geometry::Piece,
};
pub enum Variant {
    Base,
    Glow,
    Dark,
}
pub fn draw(
    d: &mut Draw,
    p: &Piece,
    variant: Variant,
    position: [f64; 2],
    spin: f64,
    flip: f64,
    scale: f64,
    a: f64,
    composite: &'static str,
) {
    if a <= 0.004 {
        return;
    }
    let mut path = Vec::new();
    for (i, point) in p.polygon.iter().enumerate() {
        let xy = [point[0] - p.origin[0], point[1] - p.origin[1]];
        path.push(if i == 0 {
            native::Step::MoveTo { point: xy }
        } else {
            native::Step::LineTo { point: xy }
        });
    }
    path.push(native::Step::Close);
    let clip = native::Clip {
        transform: ID,
        operations: Vec::new(),
        path: path.clone(),
    };
    let mut commands = Vec::new();
    let stroke = |color, width| super::draw::stroke(color, width, "source-over", "round", "round");
    match variant {
        Variant::Base | Variant::Dark => {
            commands.push(Command::Native(native::Command::Blit {
                surface: "sky-texture",
                source_rect: [0.0, 0.0, 2200.0, 1360.0],
                destination_rect: [-p.origin[0], -p.origin[1], 2200.0, 1360.0],
                transform: ID,
                operations: Vec::new(),
                composite: "source-over",
                opacity: 1.0,
                clip: Some(clip.clone()),
                raster: None,
            }));
            let paints = if matches!(variant, Variant::Dark) {
                commands.push(Command::Native(native::Command::Rect {
                    transform: ID,
                    operations: Vec::new(),
                    clip: Some(clip.clone()),
                    rect: [0.0, 0.0, p.sprite_size[0] as f64, p.sprite_size[1] as f64],
                    paint: fill(solid(rgb(106.0, 120.0, 184.0, 1.0)), "multiply"),
                }));
                vec![
                    stroke(rgb(6.0, 8.0, 20.0, 0.45), 8.0),
                    stroke(rgb(184.0, 204.0, 244.0, 1.0), 2.4),
                ]
            } else {
                vec![
                    stroke(rgb(20.0, 6.0, 26.0, 0.5), 8.0),
                    stroke(rgb(255.0, 233.0, 200.0, 1.0), 2.2),
                ]
            };
            commands.push(Command::Native(native::Command::Path {
                transform: ID,
                operations: Vec::new(),
                clip: Some(clip),
                path,
                paints,
            }));
        }
        Variant::Glow => {
            let c = if p.near > 0.6 {
                rgb(255.0, 176.0, 96.0, 1.0)
            } else {
                rgb(255.0, 138.0, 72.0, 1.0)
            };
            commands.push(Command::Heart(HeartCommand::ShadowPath {
                transform: ID,
                operations: Vec::new(),
                clip: None,
                path: path.clone(),
                paints: vec![stroke(c, 2.0 + 1.6 * p.near)],
                shadow: Shadow {
                    color: c,
                    blur_px: 10.0 + 6.0 * p.near,
                    offset: [0.0, 0.0],
                },
            }));
            commands.push(Command::Native(native::Command::Path {
                transform: ID,
                operations: Vec::new(),
                clip: None,
                path,
                paints: vec![stroke(rgb(255.0, 239.0, 216.0, 1.0), 1.0 + 0.4 * p.near)],
            }));
        }
    }
    d.commands.push(Command::Heart(HeartCommand::Surface {
        id: "sky-piece",
        size: p.sprite_size,
        commands,
    }));
    let saved = d.operations.clone();
    d.operations
        .push(super::plan::Operation::Translate { offset: position });
    d.operations
        .push(super::plan::Operation::Rotate { radians: p.axis });
    d.operations.push(super::plan::Operation::Scale {
        factors: super::motion::flip_scale(flip, scale),
    });
    d.operations.push(super::plan::Operation::Rotate {
        radians: spin - p.axis,
    });
    d.blit(
        "sky-piece",
        p.sprite_size,
        [
            p.origin[0] - p.position[0],
            p.origin[1] - p.position[1],
            p.sprite_size[0] as f64,
            p.sprite_size[1] as f64,
        ],
        a.min(1.0),
        composite,
    );
    d.operations = saved;
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "sky-piece",
        }));
}
