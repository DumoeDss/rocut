use serde::Deserialize;
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
pub struct Ink {
    pub char: String,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
    #[serde(default = "seed")]
    pub seed: u32,
    #[serde(default = "height")]
    pub h: f64,
    #[serde(default = "x")]
    pub x: f64,
    #[serde(default = "y")]
    pub y: f64,
}
fn seed() -> u32 {
    7
}
fn height() -> f64 {
    880.0
}
fn x() -> f64 {
    960.0
}
fn y() -> f64 {
    992.0
}
impl Ink {
    pub(super) fn network_seed(&self) -> u32 {
        if self.seed == 0 { 7 } else { self.seed }
    }
}
