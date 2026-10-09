use super::generator_model::Fit;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct MeshVertex {
    /// Projected canvas pixels. The positive homogeneous divisor preserves UV perspective.
    pub position: [f64; 2],
    pub uv: [f64; 2],
    pub w: f64,
}

#[derive(Serialize)]
pub struct MeshFace {
    /// Ordered convex polygon; the raster backend emits a triangle fan.
    pub vertices: Vec<MeshVertex>,
    pub brightness: f64,
    pub opacity: f64,
    pub depth: f64,
    /// Refracted RGB offset in full-canvas UV; original UV retains source alpha.
    #[serde(rename = "colorOffset", skip_serializing_if = "Option::is_none")]
    pub color_offset: Option<[f64; 2]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshImagePlan {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    /// Used by the full-image path only. Mesh faces carry their complete opacity.
    pub opacity: f64,
    pub full_image: bool,
    pub faces: Vec<MeshFace>,
}
