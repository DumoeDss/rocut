#[path = "heart_plan.rs"]
pub mod common;
pub(super) use crate::mv_recipe::converge::{Matrix, Operation, Paint, PaintKind, Stop, Style};
pub(super) use common::Step;
use serde::Serialize;
#[derive(Serialize)]
#[serde(untagged)]
pub enum Command {
    Native(common::Command),
    Memories(MemoryCommand),
}
#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Raster {
    pub binding_sha256: String,
    pub part: String,
    pub width: u32,
    pub height: u32,
    pub rgba_sha256: String,
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MemoryCommand {
    RoundRect {
        transform: Matrix,
        operations: Vec<Operation>,
        rect: [f64; 4],
        radius: f64,
        paint: Paint,
    },
    Surface {
        id: &'static str,
        size: [u32; 2],
        commands: Vec<Command>,
    },
    Pixels {
        raster: Raster,
    },
    PreparedImage {
        raster: Raster,
        destination_rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        composite: &'static str,
        opacity: f64,
        smoothing_quality: &'static str,
    },
    FilteredRect {
        transform: Matrix,
        operations: Vec<Operation>,
        affine: Option<Matrix>,
        rect: [f64; 4],
        paint: Paint,
        blur_px: f64,
    },
    FilteredPath {
        transform: Matrix,
        operations: Vec<Operation>,
        path: Vec<Step>,
        paints: Vec<Paint>,
        blur_px: f64,
    },
    ClippedText {
        font: String,
        text: String,
        font_size: f64,
        position: [f64; 2],
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<common::native::Clip>,
        color: crate::mv_recipe::model::Color,
        opacity: f64,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<Command>,
    pub raster_budget_bytes: u64,
}
pub struct Payload {
    pub raster: Raster,
    pub rgba: Vec<u8>,
}
pub struct Frame {
    pub plan: Plan,
    pub payloads: Vec<Payload>,
}
pub fn raster(
    binding: &str,
    part: String,
    size: [u32; 2],
    rgba: Vec<u8>,
) -> Result<Payload, String> {
    use sha2::{Digest, Sha256};
    if rgba.len() != size[0] as usize * size[1] as usize * 4 {
        return Err("Memories raster dimensions mismatch".into());
    }
    Ok(Payload {
        raster: Raster {
            binding_sha256: binding.into(),
            part,
            width: size[0],
            height: size[1],
            rgba_sha256: format!("{:x}", Sha256::digest(&rgba)),
        },
        rgba,
    })
}
