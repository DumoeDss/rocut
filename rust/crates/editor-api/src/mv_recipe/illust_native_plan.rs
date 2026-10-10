use crate::mv_recipe::{
    burst::{Sprite, native},
    model::{Color, Role},
};
use serde::Serialize;
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Native {
        role: Role,
        command: native::Command,
    },
    Sprite {
        role: Role,
        sprite: Sprite,
        tint: Option<Color>,
        offset: [f64; 2],
        blur_px: f64,
        composite: &'static str,
    },
    Feather {
        role: Role,
        transform: [f64; 6],
        color: Color,
        line: Color,
        body: Vec<Bezier>,
        spine: Vec<Bezier>,
    },
    Path {
        role: Role,
        path: Vec<native::Step>,
        color: Color,
        width: f64,
        blur_px: f64,
        composite: &'static str,
    },
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Bezier {
    Move { point: [f64; 2] },
    Cubic { points: [f64; 6] },
    Quadratic { points: [f64; 4] },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<Command>,
    pub allocation_bytes: u64,
}
