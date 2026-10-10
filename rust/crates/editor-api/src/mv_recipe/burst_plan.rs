#[path = "ember_plan.rs"]
pub(in crate::mv_recipe) mod native;
use crate::mv_recipe::model::Color;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sprite {
    pub image: String,
    pub transform: [f64; 6],
    pub strips: Vec<Strip>,
    pub opacity: f64,
    pub rim: Option<Color>,
    pub rim_offset: [f64; 2],
    pub rim_opacity: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Strip {
    pub source: [f64; 4],
    pub destination: [f64; 4],
}
#[derive(Serialize)]
pub struct Placement {
    pub transform: [f64; 6],
    pub opacity: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub before: native::Plan,
    pub character: Option<Sprite>,
    pub after: native::Plan,
    pub placements: Vec<Placement>,
    pub overlay: native::Plan,
    pub cut_index: u32,
    pub cut_start_ticks: f64,
    pub cut_end_ticks: f64,
    pub allocation_bytes: u64,
}
