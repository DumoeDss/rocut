use crate::mv_recipe::model::Color;
use serde::Serialize;

pub(super) use super::transform::{Matrix, Operation};
#[derive(Serialize)]
pub struct Plan {
    pub commands: Vec<Command>,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Command {
    Path {
        transform: Matrix,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        operations: Vec<Operation>,
        path: Vec<Step>,
        paints: Vec<Paint>,
    },
    Rect {
        transform: Matrix,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        operations: Vec<Operation>,
        rect: [f64; 4],
        paint: Paint,
    },
    Grain {
        transform: Matrix,
        rect: [f64; 4],
        size: [u32; 2],
        gray: Vec<u8>,
        opacity: f64,
    },
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Step {
    MoveTo {
        point: [f64; 2],
    },
    LineTo {
        point: [f64; 2],
    },
    Close,
    Arc {
        center: [f64; 2],
        radius: f64,
        start: f64,
        end: f64,
    },
    Ellipse {
        center: [f64; 2],
        radii: [f64; 2],
        rotation: f64,
        start: f64,
        end: f64,
    },
}
#[derive(Serialize)]
pub struct Stop {
    pub offset: f64,
    pub color: Color,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Style {
    Solid {
        color: Color,
    },
    Linear {
        from: [f64; 2],
        to: [f64; 2],
        stops: Vec<Stop>,
    },
    Radial {
        from: [f64; 3],
        to: [f64; 3],
        stops: Vec<Stop>,
    },
}
#[derive(Serialize)]
pub struct Paint {
    pub style: Style,
    pub composite: &'static str,
    pub opacity: f64,
    #[serde(flatten)]
    pub kind: PaintKind,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PaintKind {
    Fill,
    Stroke {
        width: f64,
        cap: &'static str,
        join: &'static str,
    },
}
