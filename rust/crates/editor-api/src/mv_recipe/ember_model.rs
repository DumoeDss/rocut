use crate::mv_recipe::model::Color;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Ember {
    Breathe(Breathe),
    Ignite(Ignite),
    Collapse(Collapse),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Palette {
    pub background: Color,
    pub aura: Color,
    pub dusk: Color,
    pub verm: Color,
    pub sunset: Color,
    pub glow: Color,
    pub hi: Color,
    pub core: Color,
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
#[serde(deny_unknown_fields)]
pub struct Hud {
    pub font: String,
    pub title: String,
    pub clock: Timecode,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timecode {
    pub hour: u32,
    pub minute: u32,
    pub fps: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Breathe {
    pub palette: Palette,
    pub grain: f64,
    pub beats: Beats,
    pub hud: Hud,
    pub stops_ticks: Vec<[u64; 2]>,
    pub flares_ticks: Vec<[u64; 2]>,
    pub thumps_ticks: Vec<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ignite {
    pub palette: Palette,
    pub grain: f64,
    pub beats: Beats,
    pub hud: Hud,
    pub stops_ticks: Vec<[u64; 2]>,
    pub black_from: BlackFrom,
    pub crack_at_ticks: u64,
    pub ring: f64,
    pub seed: u32,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BlackFrom {
    LastBeat {},
    At { song_ticks: u64 },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collapse {
    pub palette: Palette,
    pub grain: f64,
    pub image: String,
    pub focus: [f64; 2],
    pub end_ticks: u64,
    pub keys: Keys,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Keys {
    Manual { values: Vec<Key> },
    Analysis { beats: Beats },
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Key {
    pub song_ticks: u64,
    pub factor: f64,
    pub easing: Easing,
    pub hit: bool,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Easing {
    Out,
    In,
    Io,
    Soft,
    Whip,
}
