use super::{math::*, plan::*};
use crate::mv_recipe::model::Color;

pub(super) fn rgba(mut c: Color, gain: f64) -> Color {
    c[3] *= clamp(gain);
    c
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
pub(super) fn radial(x: f64, y: f64, r: f64, colors: &[(f64, Color)]) -> Style {
    Style::Radial {
        from: [x, y, 0.0],
        to: [x, y, r],
        stops: stops(colors),
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
pub(super) fn stroke(
    style: Style,
    width: f64,
    cap: &'static str,
    join: &'static str,
    composite: &'static str,
) -> Paint {
    Paint {
        style,
        composite,
        opacity: 1.0,
        kind: PaintKind::Stroke { width, cap, join },
    }
}
pub(super) fn line(from: [f64; 2], to: [f64; 2]) -> Vec<Step> {
    vec![Step::MoveTo { point: from }, Step::LineTo { point: to }]
}
pub(super) fn circle(x: f64, y: f64, radius: f64) -> Vec<Step> {
    vec![Step::Arc {
        center: [x, y],
        radius,
        start: 0.0,
        end: TAU,
    }]
}
pub(super) struct Draw {
    pub commands: Vec<Command>,
    pub width: f64,
    pub height: f64,
}
impl Draw {
    pub fn grain(&mut self, transform: Matrix, rect: [f64; 4], gray: Vec<u8>, opacity: f64) {
        self.commands.push(Command::Grain {
            transform,
            rect,
            size: [256, 256],
            gray,
            opacity,
        });
    }
    pub fn transform(&self, local: Matrix) -> Matrix {
        let sx = self.width / 1920.0;
        let sy = self.height / 1080.0;
        [
            sx * local[0],
            sy * local[1],
            sx * local[2],
            sy * local[3],
            sx * local[4],
            sy * local[5],
        ]
    }
    pub fn identity(&self) -> Matrix {
        self.transform([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }
    pub fn path(&mut self, path: Vec<Step>, paints: Vec<Paint>) {
        self.commands.push(Command::Path {
            transform: self.identity(),
            operations: Vec::new(),
            path,
            paints,
        });
    }
    pub fn rect(&mut self, rect: [f64; 4], paint: Paint) {
        self.commands.push(Command::Rect {
            transform: self.identity(),
            operations: Vec::new(),
            rect,
            paint,
        });
    }
    pub fn glow(
        &mut self,
        x: f64,
        y: f64,
        radius: f64,
        colors: &[(f64, Color)],
        comp: &'static str,
    ) {
        self.rect(
            [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
            fill(radial(x, y, radius, colors), comp),
        );
    }
    pub fn screen(&mut self, color: Color, opacity: f64) {
        let mut paint = fill(solid(color), "source-over");
        paint.opacity = opacity;
        self.commands.push(Command::Rect {
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            operations: Vec::new(),
            rect: [0.0, 0.0, self.width, self.height],
            paint,
        });
    }
}
