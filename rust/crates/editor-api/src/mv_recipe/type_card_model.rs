use crate::mv_recipe::model::Color;
use serde::{Deserialize, Deserializer};

fn required<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum TypeCard {
    Quiet(Quiet),
    Flicker(Flicker),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Text {
    pub font: String,
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
    pub tracking: f64,
    pub color: Color,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Glyph {
    pub text: String,
    pub optical_scale: f64,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Orientation {
    Horizontal,
    Vertical,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub color: Color,
    pub offset: f64,
    pub length_scale: f64,
    pub length_padding: f64,
    pub width: f64,
    pub tick_length: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quiet {
    pub font: String,
    pub glyphs: Vec<Glyph>,
    pub font_size: f64,
    pub center: [f64; 2],
    pub orientation: Orientation,
    pub gap: f64,
    pub lead: f64,
    pub stagger: f64,
    pub fade: f64,
    pub color: Color,
    pub background: Color,
    #[serde(deserialize_with = "required")]
    pub rule: Option<Rule>,
    #[serde(deserialize_with = "required")]
    pub subtitle: Option<Text>,
    pub grain: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Part {
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Hold {
    Pulse { seconds: f64 },
    Sustain,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Indicator {
    pub rect: [f64; 4],
    pub color: Color,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Frame {
    pub rect: [f64; 4],
    pub color: Color,
    pub width: f64,
    pub indicator: Indicator,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Glow {
    pub center: [f64; 2],
    pub radius: f64,
    pub color: Color,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    pub parts: Vec<Part>,
    pub hold: Hold,
    pub glitch: f64,
    #[serde(deserialize_with = "required")]
    pub frame: Option<Frame>,
    #[serde(deserialize_with = "required")]
    pub kick_glow: Option<Glow>,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Beats {
    Analysis {},
    Manual { song_ticks: Vec<u64> },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Morse {
    pub elements: Vec<u8>,
    pub position: [f64; 2],
    pub unit: f64,
    pub gap: f64,
    pub height: f64,
    pub lit_color: Color,
    pub unlit_color: Color,
    pub label: Text,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Flood {
    pub center: [f64; 2],
    pub radius_from: f64,
    pub radius_to: f64,
    pub colors: [Color; 4],
    pub white: Color,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Negative {
    pub text: String,
    pub position: [f64; 2],
    pub font_size: f64,
    pub color: Color,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Flicker {
    pub font: String,
    pub background: Color,
    pub beats: Beats,
    pub layouts: [Layout; 4],
    pub rgb_colors: [Color; 3],
    pub noise_colors: [Color; 3],
    pub scanline_opacity: f64,
    pub idle_scan_color: Color,
    pub morse: Morse,
    pub flood: Flood,
    pub negative: Negative,
    pub grain: f64,
}
