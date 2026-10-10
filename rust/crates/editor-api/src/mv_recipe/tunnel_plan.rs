//! Tunnel retains the shared non-text vocabulary, but never emits single-face text.
#[path = "ember_plan.rs"]
mod shared;
use super::fonts::Stack;
use serde::Serialize;
pub(super) use crate::mv_recipe::converge::{Matrix, Operation, Paint, PaintKind, Stop, Style};
pub(super) use shared::{Clip, FillHistory, Step, TextFill};

#[derive(Serialize)]
pub struct Plan {
    pub commands: Vec<Command>,
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Path {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        path: Vec<Step>,
        paints: Vec<Paint>,
    },
    Rect {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        rect: [f64; 4],
        paint: Paint,
    },
    Grain {
        transform: Matrix,
        rect: [f64; 4],
        size: [u32; 2],
        gray: Vec<u8>,
        opacity: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_history: Option<FillHistory>,
    },
    StackText {
        font_stack: Stack,
        text: String,
        font_size: f64,
        tracking: f64,
        position: [f64; 2],
        transform: Matrix,
        operations: Vec<Operation>,
        #[serde(flatten)]
        fill: TextFill,
        opacity: f64,
        composite: &'static str,
        align: &'static str,
        baseline: &'static str,
    },
}
