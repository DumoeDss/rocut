use super::{
    model::{Camera, Ease, PlanNode, Span},
    transition_model::Edge,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Panel {
    pub input: String,
    /// Strictly convex polygon, either winding, in normalized output space.
    pub polygon: Vec<[f64; 2]>,
    pub opening: Opening,
    pub camera: PanelCamera,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Opening {
    pub span: Span,
    pub angle: f64,
    pub easing: Ease,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PanelCamera {
    pub motion: Span,
    pub from: Camera,
    pub to: Camera,
    pub easing: Ease,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collapse {
    pub span: Span,
    pub hero: usize,
    pub easing: Ease,
}
#[derive(Serialize)]
pub struct PanelPlan {
    pub input: Box<PlanNode>,
    pub polygon: Vec<[f64; 2]>,
    pub transform: [f64; 6],
    pub border: Option<Edge>,
}
