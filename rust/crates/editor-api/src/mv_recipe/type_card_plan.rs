use crate::mv_recipe::model::Color;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Text {
    pub font: String,
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
    pub tracking: f64,
    pub color: Color,
    pub opacity: f64,
    pub blur: f64,
}
#[derive(Serialize)]
pub struct Rect {
    pub rect: [f64; 4],
    pub color: Color,
    pub opacity: f64,
}
#[derive(Serialize)]
pub struct Stop {
    pub offset: f64,
    pub color: Color,
}
#[derive(Serialize)]
pub struct Glow {
    pub center: [f64; 2],
    pub radius: f64,
    pub rect: [f64; 4],
    pub stops: Vec<Stop>,
}
#[derive(Serialize)]
pub struct Frame {
    pub rect: [f64; 4],
    pub color: Color,
    pub width: f64,
}
#[derive(Serialize)]
pub struct Eraser {
    pub rect: [f64; 4],
    pub opacity: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub source_rect: [f64; 4],
    pub destination_rect: [f64; 4],
    pub opacity: f64,
}
#[derive(Serialize)]
pub struct Morse {
    pub elements: Vec<Rect>,
    pub label: Text,
}
#[derive(Serialize)]
pub struct Quiet {
    pub glyphs: Vec<Text>,
    pub rule: Vec<Rect>,
    pub subtitle: Option<Text>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Flicker {
    pub transform: [f64; 6],
    pub text: Vec<Text>,
    pub frame: Option<Frame>,
    pub indicator: Option<Rect>,
    pub erasers: Vec<Eraser>,
    pub bands: Vec<Band>,
    pub blocks: Vec<Rect>,
    pub kick_glow: Option<Glow>,
    pub idle_scan: Option<Rect>,
    pub morse: Morse,
}
#[derive(Serialize)]
pub struct Grain {
    pub size: [u32; 2],
    pub gray: Vec<u8>,
    pub offset: [u32; 2],
    pub opacity: f64,
}
#[derive(Serialize)]
pub struct Plan {
    pub mode: &'static str,
    pub background: Color,
    pub quiet: Option<Quiet>,
    pub flicker: Option<Flicker>,
    pub grain: Option<Grain>,
    pub flood: Option<Glow>,
    pub white: Option<Color>,
    pub negative: Option<Text>,
}
pub(super) fn text(value: &super::model::Text, s: &super::Sample<'_>, opacity: f64) -> Text {
    Text {
        font: value.font.clone(),
        text: value.text.clone(),
        position: s.point(value.position),
        font_size: value.font_size * s.height,
        tracking: value.tracking * s.height,
        color: value.color,
        opacity,
        blur: 0.0,
    }
}
