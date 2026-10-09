use super::model::Color;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlyphRain {
    pub font: String,
    pub glyphs: String,
    pub columns: u32,
    pub rows: u32,
    pub trail: u32,
    pub speed: f64,
    pub drawing_fps: u32,
    pub color: Color,
    pub head_color: Color,
    pub opacity: f64,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    Contain,
    Cover,
    Stretch,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    In,
    Out,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParticleReveal {
    pub image: String,
    pub columns: u32,
    pub rows: u32,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub scatter: f64,
    pub stagger: f64,
    pub spin: f64,
    pub start_scale: f64,
    pub opacity: f64,
    pub direction: Direction,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphRainPlan {
    pub font: String,
    pub font_size: f64,
    pub cell_width: f64,
    pub color: Color,
    pub head_color: Color,
    pub glyphs: Vec<Glyph>,
}
#[derive(Serialize)]
pub struct Glyph {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub opacity: f64,
    pub head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleRevealPlan {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub opacity: f64,
    pub full_image: bool,
    pub particles: Vec<Particle>,
}
#[derive(Serialize)]
pub struct Particle {
    pub uv: [f64; 4],
    pub offset: [f64; 2],
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}
