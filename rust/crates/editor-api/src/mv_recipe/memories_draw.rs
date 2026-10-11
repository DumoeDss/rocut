use super::plan::{
    Command, MemoryCommand, Operation, Paint, PaintKind, Step, Stop, Style,
    common::{self, native},
};
pub type Color = crate::mv_recipe::model::Color;
pub const ID: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub fn color(r: f64, g: f64, b: f64, a: f64) -> Color {
    [r / 255.0, g / 255.0, b / 255.0, a.clamp(0.0, 1.0)]
}
pub fn solid(color: Color) -> Style {
    Style::Solid { color }
}
pub fn fill(style: Style, composite: &'static str) -> Paint {
    Paint {
        style,
        composite,
        opacity: 1.0,
        kind: PaintKind::Fill,
    }
}
pub fn stroke(color: Color, width: f64, composite: &'static str, cap: &'static str) -> Paint {
    Paint {
        style: solid(color),
        composite,
        opacity: 1.0,
        kind: PaintKind::Stroke {
            width,
            cap,
            join: "miter",
        },
    }
}
pub fn mv(point: [f64; 2]) -> Step {
    Step::Native(native::Step::MoveTo { point })
}
pub fn ln(point: [f64; 2]) -> Step {
    Step::Native(native::Step::LineTo { point })
}
pub fn close() -> Step {
    Step::Native(native::Step::Close)
}
pub fn quad(control: [f64; 2], point: [f64; 2]) -> Step {
    Step::Quadratic(common::Quadratic::QuadraticCurveTo { control, point })
}
pub fn arc(center: [f64; 2], radius: f64) -> Step {
    Step::Native(native::Step::Arc {
        center,
        radius,
        start: 0.0,
        end: std::f64::consts::TAU,
        anticlockwise: false,
    })
}
pub fn radial(from: [f64; 3], to: [f64; 3], stops: &[(f64, Color)]) -> Style {
    Style::Radial {
        from,
        to,
        stops: stops
            .iter()
            .map(|(offset, color)| Stop {
                offset: *offset,
                color: *color,
            })
            .collect(),
    }
}
pub fn linear(from: [f64; 2], to: [f64; 2], stops: &[(f64, Color)]) -> Style {
    Style::Linear {
        from,
        to,
        stops: stops
            .iter()
            .map(|(offset, color)| Stop {
                offset: *offset,
                color: *color,
            })
            .collect(),
    }
}
pub struct Draw {
    pub commands: Vec<Command>,
    pub operations: Vec<Operation>,
}
impl Draw {
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
            operations: Vec::new(),
        }
    }
    pub fn rect(&mut self, rect: [f64; 4], paint: Paint) {
        self.commands.push(Command::Native(common::Command::Native(
            native::Command::Rect {
                transform: ID,
                operations: self.operations.clone(),
                clip: None,
                rect,
                paint,
            },
        )));
    }
    pub fn path(&mut self, path: Vec<Step>, paints: Vec<Paint>) {
        self.commands.push(Command::Native(common::Command::Heart(
            common::HeartCommand::Path {
                transform: ID,
                operations: self.operations.clone(),
                clip: None,
                path,
                paints,
            },
        )));
    }
    pub fn filtered_rect(
        &mut self,
        rect: [f64; 4],
        paint: Paint,
        blur: f64,
        affine: Option<[f64; 6]>,
    ) {
        self.commands
            .push(Command::Memories(MemoryCommand::FilteredRect {
                transform: ID,
                operations: self.operations.clone(),
                affine,
                rect,
                paint,
                blur_px: blur,
            }));
    }
    pub fn image(&mut self, id: &str, rect: [f64; 4]) {
        self.commands.push(Command::Native(common::Command::Native(
            native::Command::Image {
                image: id.into(),
                source_rect: None,
                destination_rect: rect,
                transform: ID,
                operations: self.operations.clone(),
                clip: None,
                composite: "source-over",
                opacity: 1.0,
                smoothing: true,
                smoothing_quality: "low",
            },
        )));
    }
    pub fn blit(
        &mut self,
        id: &'static str,
        size: [u32; 2],
        rect: [f64; 4],
        a: f64,
        comp: &'static str,
        blur: Option<f64>,
        quality: &'static str,
    ) {
        self.commands.push(Command::Native(common::Command::Native(
            native::Command::Blit {
                surface: id,
                source_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
                destination_rect: rect,
                transform: ID,
                operations: self.operations.clone(),
                composite: comp,
                opacity: a,
                clip: None,
                raster: blur.map(|blur_px| native::BlitRaster {
                    blur_px,
                    contrast: None,
                    smoothing: true,
                    smoothing_quality: quality,
                }),
            },
        )));
    }
    pub fn prepared(
        &mut self,
        raster: &super::plan::Raster,
        rect: [f64; 4],
        a: f64,
        comp: &'static str,
        quality: &'static str,
    ) {
        self.commands
            .push(Command::Memories(MemoryCommand::PreparedImage {
                raster: raster.clone(),
                destination_rect: rect,
                transform: ID,
                operations: self.operations.clone(),
                composite: comp,
                opacity: a,
                smoothing_quality: quality,
            }));
    }
    pub fn surface(&mut self, id: &'static str, size: [u32; 2], commands: Vec<Command>) {
        self.commands
            .push(Command::Memories(MemoryCommand::Surface {
                id,
                size,
                commands,
            }));
    }
    pub fn release(&mut self, id: &'static str) {
        self.commands.push(Command::Native(common::Command::Native(
            native::Command::ReleaseSurface { surface: id },
        )));
    }
}
