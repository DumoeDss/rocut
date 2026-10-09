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
pub struct Fall {
    pub beats: Beats,
    #[serde(rename = "char")]
    pub image: String,
    #[serde(default, deserialize_with = "intervals")]
    pub freeze: Option<Vec<[f64; 2]>>,
    #[serde(default, deserialize_with = "pulses")]
    pub pulse: Option<Vec<f64>>,
    #[serde(default = "vp")]
    pub vp: [f64; 2],
    #[serde(default = "speed")]
    pub speed: f64,
    #[serde(default = "height")]
    pub h: f64,
}
fn vp() -> [f64; 2] {
    [1040.0, 84.0]
}
fn speed() -> f64 {
    1.0
}
fn height() -> f64 {
    940.0
}
fn intervals<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<[f64; 2]>>, D::Error> {
    Vec::<[f64; 2]>::deserialize(d).map(Some)
}
fn pulses<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<f64>>, D::Error> {
    Vec::<f64>::deserialize(d).map(Some)
}
