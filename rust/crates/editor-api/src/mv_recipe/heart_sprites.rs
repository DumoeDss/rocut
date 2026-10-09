//! Original Heart shardSprites Canvas recipe, including native shadow strokes.
//! This is scratch-sprite construction, not the complete scene producer.
use super::plan::{self, native, Command, HeartCommand, Paint, PaintKind, Shadow, Style};
use native::{Clip, Step};
type Color = crate::mv_recipe::model::Color;
const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
const BODY: &str = "heart-body";
pub enum Variant {
    Base,
    Glow,
    Char,
    Flame,
}
pub struct Sprite {
    pub origin: [f64; 2],
    pub size: [u32; 2],
    pub commands: Vec<Command>,
}
fn color(r: f64, g: f64, b: f64, a: f64) -> Color {
    [r / 255.0, g / 255.0, b / 255.0, a]
}
fn paint(c: Color, width: f64) -> Paint {
    Paint {
        style: Style::Solid { color: c },
        composite: "source-over",
        opacity: 1.0,
        kind: PaintKind::Stroke {
            width,
            cap: "round",
            join: "round",
        },
    }
}
fn trace(polygon: &[[f64; 2]], origin: [f64; 2]) -> Vec<Step> {
    let mut out = Vec::with_capacity(polygon.len() + 1);
    for (i, p) in polygon.iter().enumerate() {
        let point = [p[0] - origin[0], p[1] - origin[1]];
        out.push(if i == 0 {
            Step::MoveTo { point }
        } else {
            Step::LineTo { point }
        });
    }
    out.push(Step::Close);
    out
}
fn stroke(path: Vec<Step>, clip: Option<Clip>, paints: Vec<Paint>) -> Command {
    Command::Native(native::Command::Path {
        transform: IDENTITY,
        operations: Vec::new(),
        clip,
        path,
        paints,
    })
}
fn sample(
    body_size: [u32; 2],
    origin: [f64; 2],
    clip: Option<Clip>,
    composite: &'static str,
) -> Command {
    Command::Native(native::Command::Blit {
        surface: BODY,
        source_rect: [0.0, 0.0, body_size[0] as f64, body_size[1] as f64],
        destination_rect: [
            -origin[0],
            -origin[1],
            body_size[0] as f64,
            body_size[1] as f64,
        ],
        transform: IDENTITY,
        operations: Vec::new(),
        composite,
        opacity: 1.0,
        clip,
        raster: None,
    })
}
fn multiply(size: [u32; 2], clip: Clip, c: Color) -> Command {
    Command::Native(native::Command::Rect {
        transform: IDENTITY,
        operations: Vec::new(),
        clip: Some(clip),
        rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
        paint: Paint {
            style: Style::Solid { color: c },
            composite: "multiply",
            opacity: 1.0,
            kind: PaintKind::Fill,
        },
    })
}

pub fn body(
    image: plan::prepared::PreparedImage,
    display_size: [u32; 2],
) -> Result<Command, &'static str> {
    if image.part != plan::prepared::Part::Body
        || display_size.iter().any(|v| !(1..=4096).contains(v))
    {
        return Err("Invalid Heart body raster reference");
    }
    Ok(Command::Heart(HeartCommand::Surface {
        id: BODY,
        size: display_size,
        commands: vec![Command::Heart(HeartCommand::PreparedImage {
            image,
            source_rect: None,
            destination_rect: [0.0, 0.0, display_size[0] as f64, display_size[1] as f64],
            transform: IDENTITY,
            operations: Vec::new(),
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "low",
        })],
    }))
}

pub fn shard(
    polygon: &[[f64; 2]],
    body_size: [u32; 2],
    variant: Variant,
) -> Result<Sprite, &'static str> {
    if polygon.len() < 3 || polygon.iter().flatten().any(|v| !v.is_finite()) {
        return Err("Invalid Heart shard polygon");
    }
    let mut b = [1e9f64, 1e9f64, -1e9f64, -1e9f64];
    for [x, y] in polygon {
        b[0] = b[0].min(*x);
        b[1] = b[1].min(*y);
        b[2] = b[2].max(*x);
        b[3] = b[3].max(*y);
    }
    let origin = [(b[0] - 16.0).floor(), (b[1] - 16.0).floor()];
    let w = ((b[2] + 16.0).ceil() - origin[0]).max(2.0);
    let h = ((b[3] + 16.0).ceil() - origin[1]).max(2.0);
    if w > 4096.0 || h > 4096.0 || body_size.iter().any(|v| !(1..=4096).contains(v)) {
        return Err("Heart shard exceeds native surface limits");
    }
    let size = [w as u32, h as u32];
    let path = trace(polygon, origin);
    let clip = Clip {
        transform: IDENTITY,
        operations: Vec::new(),
        path: path.clone(),
    };
    let mut commands = Vec::new();
    match variant {
        Variant::Base => {
            commands.push(sample(body_size, origin, Some(clip.clone()), "source-over"));
            commands.push(stroke(
                path.clone(),
                Some(clip.clone()),
                vec![
                    paint(color(60.0, 12.0, 20.0, 0.4), 7.0),
                    paint(color(255.0, 241.0, 210.0, 1.0), 3.0),
                ],
            ));
        }
        Variant::Glow => {
            commands.push(Command::Heart(HeartCommand::ShadowPath {
                transform: IDENTITY,
                operations: Vec::new(),
                clip: None,
                path: path.clone(),
                paints: vec![paint(color(255.0, 165.0, 82.0, 1.0), 3.5)],
                shadow: Shadow {
                    color: color(255.0, 165.0, 82.0, 1.0),
                    blur_px: 10.0,
                    offset: [0.0, 0.0],
                },
            }));
            commands.push(stroke(
                path.clone(),
                None,
                vec![paint(color(255.0, 241.0, 208.0, 1.0), 1.4)],
            ));
        }
        Variant::Char => {
            commands.push(sample(body_size, origin, Some(clip.clone()), "source-over"));
            commands.push(multiply(size, clip.clone(), color(138.0, 36.0, 16.0, 1.0)));
            commands.push(multiply(size, clip.clone(), color(154.0, 58.0, 42.0, 1.0)));
            commands.push(stroke(
                path.clone(),
                Some(clip.clone()),
                vec![
                    paint(color(20.0, 4.0, 6.0, 0.6), 9.0),
                    paint(color(255.0, 106.0, 42.0, 1.0), 6.0),
                    paint(color(255.0, 224.0, 160.0, 1.0), 2.0),
                ],
            ));
        }
        Variant::Flame => {
            commands.push(Command::Heart(HeartCommand::ShadowPath {
                transform: IDENTITY,
                operations: Vec::new(),
                clip: None,
                path: path.clone(),
                paints: vec![paint(color(255.0, 90.0, 31.0, 1.0), 6.0)],
                shadow: Shadow {
                    color: color(255.0, 58.0, 16.0, 1.0),
                    blur_px: 16.0,
                    offset: [0.0, 0.0],
                },
            }));
            commands.push(stroke(
                path.clone(),
                None,
                vec![paint(color(255.0, 192.0, 96.0, 1.0), 2.0)],
            ));
        }
    }
    commands.push(sample(body_size, origin, None, "destination-in"));
    Ok(Sprite {
        origin,
        size,
        commands,
    })
}

pub fn hot_body(size: [u32; 2]) -> Command {
    let commands = vec![
        sample(size, [0.0, 0.0], None, "source-over"),
        Command::Native(native::Command::Rect {
            transform: IDENTITY,
            operations: Vec::new(),
            clip: None,
            rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
            paint: Paint {
                style: Style::Solid {
                    color: color(255.0, 106.0, 74.0, 1.0),
                },
                composite: "multiply",
                opacity: 1.0,
                kind: PaintKind::Fill,
            },
        }),
        sample(size, [0.0, 0.0], None, "destination-in"),
    ];
    Command::Heart(HeartCommand::Surface {
        id: "heart-hot-body",
        size,
        commands,
    })
}
