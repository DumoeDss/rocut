//! Heart-specific raster transport. Provider/dispatcher integration is pending.
#[path = "ember_plan.rs"]
pub mod native;
#[path = "heart_prepared.rs"]
pub mod prepared;
pub(super) use crate::mv_recipe::converge::{Matrix, Operation, Paint, PaintKind, Stop, Style};
use serde::Serialize;

#[derive(Serialize)]
#[serde(untagged)]
pub enum Command {
    Native(native::Command),
    Heart(HeartCommand),
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HeartCommand {
    Path {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<native::Clip>,
        path: Vec<Step>,
        paints: Vec<Paint>,
    },
    PreparedImage {
        image: prepared::PreparedImage,
        source_rect: Option<[f64; 4]>,
        destination_rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<native::Clip>,
        composite: &'static str,
        opacity: f64,
        smoothing: bool,
        smoothing_quality: &'static str,
    },
    // These explicit recursive wrappers allow preparedImage inside scratch surfaces.
    Surface {
        id: &'static str,
        size: [u32; 2],
        commands: Vec<Command>,
    },
    AppendSurface {
        surface: &'static str,
        commands: Vec<Command>,
    },
    /// Same native wire protocol, but IDs may be unique per produced layer.
    #[serde(rename = "surface")]
    OwnedSurface {
        id: String,
        size: [u32; 2],
        commands: Vec<Command>,
    },
    #[serde(rename = "blit")]
    OwnedBlit {
        surface: String,
        source_rect: [f64; 4],
        destination_rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        composite: &'static str,
        opacity: f64,
        clip: Option<native::Clip>,
        raster: Option<native::BlitRaster>,
    },
    #[serde(rename = "releaseSurface")]
    OwnedReleaseSurface { surface: String },
    ShadowPath {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<native::Clip>,
        path: Vec<native::Step>,
        paints: Vec<Paint>,
        shadow: Shadow,
    },
}
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum Step {
    Native(native::Step),
    Quadratic(Quadratic),
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Quadratic {
    QuadraticCurveTo { control: [f64; 2], point: [f64; 2] },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shadow {
    pub color: crate::mv_recipe::model::Color,
    pub blur_px: f64,
    pub offset: [f64; 2],
}
