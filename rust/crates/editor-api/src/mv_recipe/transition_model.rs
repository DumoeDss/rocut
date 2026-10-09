use super::model::{Color, Role};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Transition {
    Bend {
        direction: Direction,
        hinge: f64,
        angle: f64,
        perspective: f64,
        shading: f64,
    },
    Cut,
    Xfade,
    Flash {
        color: Color,
    },
    Black,
    Wipe {
        angle: f64,
        #[serde(default)]
        edge: Option<Edge>,
    },
    Iris {
        center: [f64; 2],
        #[serde(default)]
        edge: Option<Edge>,
    },
    IrisClose {
        center: [f64; 2],
    },
    Push {
        direction: Direction,
    },
    Slices {
        count: u32,
    },
    /// Analytical cylindrical page fold.
    Peel {
        direction: Direction,
        curl: f64,
        segments: u32,
        shading: f64,
        perspective: f64,
    },
    Zoom,
    Ink {
        seed: u32,
        blobs: u32,
    },
    Shatter {
        seed: u32,
        center: [f64; 2],
        columns: u32,
        rows: u32,
        #[serde(default)]
        edge: Option<Edge>,
    },
    Barrier {
        pivot: [f64; 2],
        colors: [Color; 2],
        width: f64,
        stripes: u32,
        role: Role,
    },
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub color: Color,
    pub width: f64,
    pub role: Role,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Clip {
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Circle {
        x: f64,
        y: f64,
        radius: f64,
    },
    Polygons {
        points: Vec<Vec<[f64; 2]>>,
    },
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Input {
    From,
    To,
}
#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Blend {
    SourceOver,
    Lighter,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DrawCommand {
    Mesh {
        input: Input,
        vertices: Vec<super::mesh_model::MeshVertex>,
        brightness: f64,
        opacity: f64,
    },
    /// A clipped source triangle mapped by an authoritative affine transform.
    Surface {
        input: Input,
        opacity: f64,
        transform: [f64; 6],
        clip: Clip,
        brightness: f64,
    },
    Image {
        input: Input,
        opacity: f64,
        transform: [f64; 6],
        clip: Option<Clip>,
        replace: bool,
        blend: Blend,
    },
    /// Tint existing coverage, not an opaque flash sheet in every role.
    Tint { color: Color, opacity: f64 },
    Fill {
        color: Color,
        opacity: f64,
        path: Clip,
        role: Role,
    },
    Stroke {
        color: Color,
        opacity: f64,
        width: f64,
        path: Clip,
        role: Role,
        transform: [f64; 6],
    },
}

pub const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
impl DrawCommand {
    pub fn image(input: Input) -> Self {
        Self::Image {
            input,
            opacity: 1.0,
            transform: IDENTITY,
            clip: None,
            replace: false,
            blend: Blend::SourceOver,
        }
    }
}
