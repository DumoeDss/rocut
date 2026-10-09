use super::super::model::Color;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Glyph {
    pub text: String,
    pub center: [f64; 2],
    pub font_size: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Text {
    pub font: String,
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
    pub tracking: f64,
    pub opacity: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credit {
    pub font: String,
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
    pub tracking: f64,
    pub opacity: f64,
    pub color: Color,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Circle {
    pub center: [f64; 2],
    pub radius: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Cutout {
    pub image: String,
    pub rect: [f64; 4],
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Afterimage {
    pub cutout: Cutout,
    pub title_font: String,
    pub glyphs: Vec<Glyph>,
    pub circle: Circle,
    pub subtitle: Text,
    pub credit: Credit,
    pub color: Color,
    pub fringe_color: Color,
    pub background: Color,
    pub grain: f64,
    pub time_scale: f64,
    pub motion_scale: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    pub cutout: Cutout,
    pub title_font: String,
    pub glyphs: Vec<Glyph>,
    pub circle: Circle,
    pub subtitle: Text,
}
#[derive(Serialize)]
pub struct Raster {
    pub id: &'static str,
    pub source: &'static str,
    pub size: [u32; 2],
    pub blur: f64,
    pub tint: Option<Color>,
}
#[derive(Serialize)]
pub struct Layer {
    pub raster: &'static str,
    pub opacity: f64,
    pub rect: [f64; 4],
}
#[derive(Serialize)]
pub struct Grain {
    pub size: [u32; 2],
    pub gray: Vec<u8>,
    pub offset: [u32; 2],
    pub opacity: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub mask: Mask,
    pub background: Color,
    pub color: Color,
    pub fringe_color: Color,
    pub transform: [f64; 6],
    pub rasters: Vec<Raster>,
    pub layers: Vec<Layer>,
    pub grain: Option<Grain>,
    pub credit: Credit,
}
