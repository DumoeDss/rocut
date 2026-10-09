pub(super) use crate::mv_recipe::converge::{Matrix, Operation, Paint, PaintKind, Stop, Style};
use crate::mv_recipe::model::Color;
use serde::Serialize;

#[derive(Serialize)]
pub struct Plan {
    pub commands: Vec<Command>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlitRaster {
    pub blur_px: f64,
    pub smoothing: bool,
    pub smoothing_quality: &'static str,
}
/// Reference paint-state assignment before the next pattern, not another draw
/// or authoring parameter. Gradient creation must use its original Canvas CTM.
#[derive(Serialize)]
pub struct FillHistory {
    pub transform: Matrix,
    pub style: Style,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum TextFill {
    Color { color: Color },
    Style { style: Style },
}
#[derive(Clone, Serialize)]
pub struct Clip {
    pub transform: Matrix,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub operations: Vec<Operation>,
    pub path: Vec<Step>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Step {
    Rect {
        rect: [f64; 4],
    },
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
        anticlockwise: bool,
    },
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    RectBatch {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        rects: Vec<[f64; 4]>,
        paint: Paint,
    },
    CircleBatch {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        circles: Vec<[f64; 3]>,
        paints: Vec<Paint>,
    },
    GrayPixels {
        size: [u32; 2],
        gray: Vec<u8>,
        position: [i32; 2],
    },
    AlphaPixels {
        size: [u32; 2],
        alpha: Vec<u8>,
        position: [i32; 2],
    },
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
    /// Direct fillRect under a Canvas filter, not a post-blur of the target.
    /// First contract deliberately admits only identity/no-operation/no-clip.
    FilteredRect {
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        rect: [f64; 4],
        paint: Paint,
        blur_px: f64,
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
    Surface {
        id: &'static str,
        size: [u32; 2],
        commands: Vec<Command>,
    },
    AppendSurface {
        surface: &'static str,
        commands: Vec<Command>,
    },
    ReleaseSurface {
        surface: &'static str,
    },
    SurfacePatternRect {
        surface: &'static str,
        rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        composite: &'static str,
        opacity: f64,
        smoothing: bool,
        smoothing_quality: &'static str,
    },
    Blit {
        surface: &'static str,
        source_rect: [f64; 4],
        destination_rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        composite: &'static str,
        opacity: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip: Option<Clip>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raster: Option<BlitRaster>,
    },
    Image {
        image: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_rect: Option<[f64; 4]>,
        destination_rect: [f64; 4],
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        composite: &'static str,
        opacity: f64,
        smoothing: bool,
        smoothing_quality: &'static str,
    },
    Text {
        font: String,
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
    TextStroke {
        font: String,
        text: String,
        font_size: f64,
        tracking: f64,
        position: [f64; 2],
        transform: Matrix,
        operations: Vec<Operation>,
        clip: Option<Clip>,
        style: Style,
        width: f64,
        cap: &'static str,
        join: &'static str,
        blur_px: f64,
        // Native measured ink + stroke + CTM, before blur. Budget metadata only.
        raster_bounds: [f64; 4],
        opacity: f64,
        composite: &'static str,
        align: &'static str,
        baseline: &'static str,
    },
}
