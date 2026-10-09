use serde::{Deserialize, Deserializer};
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

#[derive(Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Breathe,
    Grow,
    Dark,
}
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Vocal {
    #[default]
    Analysis,
    Zero,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Flame {
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
    #[serde(default)]
    pub mode: Mode,
    pub img: Option<String>,
    pub face: Option<String>,
    pub flame_at: Option<[f64; 6]>,
    #[serde(default, deserialize_with = "intervals")]
    pub stops: Option<Vec<[f64; 2]>>,
    pub zoom_at: Option<f64>,
    #[serde(default = "zoom")]
    pub zoom_to: f64,
    pub ignite_at: Option<f64>,
    #[serde(default = "height")]
    pub h: f64,
    #[serde(default = "face_at")]
    pub face_at: [f64; 2],
    #[serde(default = "face_pos")]
    pub face_pos: [f64; 2],
    #[serde(default)]
    pub vocal: Vocal,
}
fn zoom() -> f64 {
    16.0
}
fn height() -> f64 {
    1190.0
}
fn face_at() -> [f64; 2] {
    [430.0, 330.0]
}
fn face_pos() -> [f64; 2] {
    [930.0, 410.0]
}
fn intervals<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<[f64; 2]>>, D::Error> {
    Vec::<[f64; 2]>::deserialize(d).map(Some)
}
impl Flame {
    pub(in crate::mv_recipe) fn image(&self) -> &str {
        if self.mode == Mode::Dark {
            self.face.as_deref().unwrap_or("assets/char/bust_calm.png")
        } else {
            self.img.as_deref().unwrap_or("assets/char/flame_hands.png")
        }
    }
    pub(super) fn landmarks(&self, width: u32, height: u32) -> [f64; 6] {
        self.flame_at.unwrap_or_else(|| match self.image() {
            "assets/char/flame_hands.png" => [588.0, 632.0, 662.0, 150.0, 235.0, 46.0],
            "assets/char/alt/flame_hands.png" => [527.0, 655.0, 688.0, 130.0, 210.0, 42.0],
            _ => [
                width as f64 * 0.5,
                height as f64 * 0.45,
                height as f64 * 0.48,
                140.0,
                220.0,
                40.0,
            ],
        })
    }
}
