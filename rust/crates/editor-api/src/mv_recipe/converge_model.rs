use crate::mv_recipe::model::Color;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Converge {
    pub seed: u32,
    pub white_at_ticks: u64,
    pub beats: Beats,
    pub grain: f64,
    pub palette: Palette,
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
pub struct Palette {
    pub background: [Color; 3],
    pub shadow: Color,
    pub dusk: Color,
    pub verm: Color,
    pub sunset: Color,
    pub glow: Color,
    pub hi: Color,
    pub core: Color,
    pub shard: ShardPalette,
    pub firefly: FireflyPalette,
    pub white: Color,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShardPalette {
    pub body: Color,
    pub rim: Color,
    pub edge: Color,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FireflyPalette {
    pub body: Color,
    pub core: Color,
    pub edge: Color,
}
