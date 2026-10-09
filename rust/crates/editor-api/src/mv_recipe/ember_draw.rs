use super::{math::*, plan::*};
use crate::mv_recipe::model::Color;

pub(super) fn rgba(mut color: Color, alpha: f64) -> Color {
    color[3] *= clamp(alpha);
    color
}
pub(super) fn solid(color: Color) -> Style {
    Style::Solid { color }
}
pub(super) fn stops(items: &[(f64, Color)]) -> Vec<Stop> {
    items
        .iter()
        .map(|(offset, color)| Stop {
            offset: *offset,
            color: *color,
        })
        .collect()
}
pub(super) fn radial(x: f64, y: f64, r: f64, items: &[(f64, Color)]) -> Style {
    Style::Radial {
        from: [x, y, 0.0],
        to: [x, y, r],
        stops: stops(items),
    }
}
pub(super) fn fill(style: Style, composite: &'static str) -> Paint {
    Paint {
        style,
        composite,
        opacity: 1.0,
        kind: PaintKind::Fill,
    }
}
pub(super) fn stroke(style: Style, width: f64, cap: &'static str, join: &'static str) -> Paint {
    Paint {
        style,
        composite: "lighter",
        opacity: 1.0,
        kind: PaintKind::Stroke { width, cap, join },
    }
}
pub(super) fn line(a: [f64; 2], b: [f64; 2]) -> Vec<Step> {
    vec![Step::MoveTo { point: a }, Step::LineTo { point: b }]
}
pub(super) fn arc(x: f64, y: f64, r: f64, start: f64, end: f64, anticlockwise: bool) -> Step {
    Step::Arc {
        center: [x, y],
        radius: r,
        start,
        end,
        anticlockwise,
    }
}
pub(super) fn circle(x: f64, y: f64, r: f64) -> Vec<Step> {
    vec![arc(x, y, r, 0.0, TAU, false)]
}
pub(super) struct Draw {
    pub commands: Vec<Command>,
    pub width: f64,
    pub height: f64,
    pub operations: Vec<Operation>,
    pub clip: Option<Clip>,
}
impl Draw {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            commands: Vec::new(),
            width,
            height,
            operations: Vec::new(),
            clip: None,
        }
    }
    pub fn identity(&self) -> Matrix {
        [
            self.width / 1920.0,
            0.0,
            0.0,
            self.height / 1080.0,
            0.0,
            0.0,
        ]
    }
    pub fn path(&mut self, path: Vec<Step>, paints: Vec<Paint>) {
        self.commands.push(Command::Path {
            transform: self.identity(),
            operations: self.operations.clone(),
            clip: self.clip.clone(),
            path,
            paints,
        });
    }
    pub fn rect(&mut self, rect: [f64; 4], paint: Paint) {
        self.commands.push(Command::Rect {
            transform: self.identity(),
            operations: self.operations.clone(),
            clip: self.clip.clone(),
            rect,
            paint,
        });
    }
    pub fn glow(
        &mut self,
        x: f64,
        y: f64,
        r: f64,
        items: &[(f64, Color)],
        composite: &'static str,
    ) {
        self.rect(
            [x - r, y - r, 2.0 * r, 2.0 * r],
            fill(radial(x, y, r, items), composite),
        );
    }
    pub fn background(&mut self, color: Color) {
        self.rect(
            [0.0, 0.0, 1920.0, 1080.0],
            fill(solid(color), "source-over"),
        );
    }
    pub fn clip_circle(&self, r: f64) -> Clip {
        Clip {
            transform: self.identity(),
            operations: self.operations.clone(),
            path: circle(960.0, 540.0, r),
        }
    }
}
