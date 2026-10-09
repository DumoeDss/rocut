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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Thread {
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
    pub hand: String,
    #[serde(default = "light")]
    pub light: [f64; 2],
    #[serde(default, deserialize_with = "intervals")]
    pub stops: Option<Vec<[f64; 2]>>,
    pub kick_at: Option<f64>,
    pub arrive_at: Option<f64>,
    #[serde(default = "rotation")]
    pub hand_rot: f64,
    #[serde(default = "height")]
    pub hand_h: f64,
    #[serde(default = "x")]
    pub hand_x: f64,
    #[serde(default = "y")]
    pub hand_y: f64,
}
fn light() -> [f64; 2] {
    [1700.0, 250.0]
}
fn rotation() -> f64 {
    0.1
}
fn height() -> f64 {
    1120.0
}
fn x() -> f64 {
    150.0
}
fn y() -> f64 {
    1200.0
}
fn intervals<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<[f64; 2]>>, D::Error> {
    Vec::<[f64; 2]>::deserialize(d).map(Some)
}
