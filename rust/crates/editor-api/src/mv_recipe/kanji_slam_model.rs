use crate::mv_recipe::model::Color;
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Variant {
    Default,
    Night,
    Hand,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Sky {
    Sunset,
    Night,
    Day,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Lines {
    Ink,
    Light,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Axis {
    Col,
    Row,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Beats {
    Manual { song_ticks: Vec<u64> },
    Analysis {},
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fonts {
    pub monument: String,
    pub lyric: String,
    pub counter: String,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wind {
    pub axis: Axis,
    pub from: f64,
    pub dir: i8,
    pub amp: f64,
    pub freq: f64,
    pub speed: f64,
    pub q: f64,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub x: f64,
    pub y: f64,
    pub s: f64,
    pub r: f64,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reframe {
    pub z: f64,
    pub dx: f64,
    pub dy: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KanjiSlam {
    pub variant: Variant,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
    pub fonts: Fonts,
    pub fire: bool,
    #[serde(rename = "char")]
    pub character: String,
    pub bg: Option<String>,
    pub glyphs: Vec<String>,
    pub char_x: f64,
    pub char_y: f64,
    pub char_h: f64,
    pub face: [f64; 2],
    pub color: Color,
    pub sky: Sky,
    pub sky_grad: Option<Vec<(f64, Color)>>,
    pub rim: Color,
    pub rim_off: [f64; 2],
    pub rim_a: f64,
    pub halo_a: f64,
    pub voice_dir: Option<f64>,
    pub wind: Wind,
    pub slots: Vec<Slot>,
    pub frames: Vec<Reframe>,
    pub lines: Lines,
    pub no_flash: bool,
}
impl KanjiSlam {
    pub(in crate::mv_recipe) fn images(&self) -> Vec<&str> {
        let mut ids = vec![self.character.as_str()];
        if let Some(bg) = &self.bg {
            ids.push(bg);
        }
        ids.sort_unstable();
        ids.dedup();
        ids
    }
    pub(super) fn night(&self) -> bool {
        self.sky == Sky::Night
    }
}
