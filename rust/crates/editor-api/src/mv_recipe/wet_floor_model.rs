use crate::programmatic_resources::Resource;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontIds {
    pub mincho800: String,
    pub noto800: String,
    pub dot400: String,
    pub noto400: String,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Beats {
    Manual {
        #[serde(rename = "songTicks")]
        song_ticks: Vec<u64>,
    },
    Analysis,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View {
    #[serde(default = "one")]
    pub zoom: f64,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub rot: f64,
}
fn one() -> f64 {
    1.0
}
fn words() -> Vec<String> {
    ["願い", "ねがい", "祈り", "夢", "明日"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}
fn hud_color() -> String {
    "#FFE3B0".into()
}
fn hud_alpha() -> f64 {
    0.78
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub mode: String,
    pub bg: String,
    pub fonts: FontIds,
    #[serde(default = "words")]
    pub words: Vec<String>,
    pub spots: Option<Vec<[f64; 2]>>,
    pub hero_spot: Option<[f64; 2]>,
    pub hero_at: Option<f64>,
    pub lead: Option<f64>,
    pub shimmer: Option<f64>,
    pub from: Option<View>,
    pub to: Option<View>,
    #[serde(default = "hud_color")]
    pub hud_color: String,
    #[serde(default = "hud_alpha")]
    pub hud_alpha: f64,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: i64,
}
pub struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: &'a [f64],
}
#[derive(Clone)]
pub struct Image {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !["fall", "count"].contains(&self.mode.as_str())
            || self.bg.is_empty()
            || self.bg.len() > 512
            || self.words.is_empty()
            || self.words.len() > 32
            || self
                .words
                .iter()
                .any(|w| w.is_empty() || w.chars().count() > 24 || w.chars().any(char::is_control))
        {
            return Err("invalid wetFloor mode/image/words".into());
        }
        if self.spots.as_ref().is_some_and(|s| {
            s.is_empty()
                || s.len() > 64
                || s.iter()
                    .flatten()
                    .any(|n| !n.is_finite() || n.abs() > 4096.0)
        }) || self
            .hero_spot
            .is_some_and(|s| s.iter().any(|n| !n.is_finite() || n.abs() > 4096.0))
        {
            return Err("invalid wetFloor landing spots".into());
        }
        for view in [self.from, self.to].into_iter().flatten() {
            if !view.zoom.is_finite()
                || !(0.1..=8.0).contains(&view.zoom)
                || [view.x, view.y, view.rot]
                    .iter()
                    .any(|n| !n.is_finite() || n.abs() > 8.0)
            {
                return Err("invalid wetFloor view".into());
            }
        }
        if self
            .hero_at
            .is_some_and(|n| !n.is_finite() || n.abs() > 1e6)
            || self
                .lead
                .is_some_and(|n| !n.is_finite() || !(0.0..=32.0).contains(&n))
            || self
                .shimmer
                .is_some_and(|n| !n.is_finite() || !(0.0..=16.0).contains(&n))
            || !self.bpm.is_finite()
            || !(1.0..=1000.0).contains(&self.bpm)
            || self.downbeat_index0.unsigned_abs() > 8192
            || !self.hud_alpha.is_finite()
            || !(0.0..=1.0).contains(&self.hud_alpha)
            || self.hud_color.len() != 7
            || !self.hud_color.starts_with('#')
            || !self.hud_color[1..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("invalid wetFloor clock/style".into());
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.len() > 8192
                || song_ticks.windows(2).any(|w| w[0] >= w[1])
                || song_ticks.iter().any(|t| *t > 9_007_199_254_740_991)
            {
                return Err("invalid wetFloor manual beats".into());
            }
        }
        Ok(())
    }
}
impl Sample<'_> {
    pub fn validate(&self) -> Result<(), String> {
        if self.shot_end_ticks <= self.shot_start_ticks
            || self.shot_end_ticks - self.shot_start_ticks > 120000 * 300
            || self.song_ticks > 9_007_199_254_740_991
            || self.shot_end_ticks > 9_007_199_254_740_991
            || self.beats.len() > 8192
            || self
                .beats
                .iter()
                .any(|b| !b.is_finite() || *b < 0.0 || *b > 1e9)
            || self.beats.windows(2).any(|w| w[0] >= w[1])
        {
            return Err("invalid wetFloor mapped clock".into());
        }
        Ok(())
    }
    pub fn time(&self) -> f64 {
        self.song_ticks as f64 / 120000.0
    }
    pub fn start(&self) -> f64 {
        self.shot_start_ticks as f64 / 120000.0
    }
    pub fn end(&self) -> f64 {
        self.shot_end_ticks as f64 / 120000.0
    }
    pub fn progress(&self) -> f64 {
        super::math::sat((self.time() - self.start()) / (self.end() - self.start()))
    }
    pub fn selected_beats(&self, lead: f64, tail: f64) -> Result<Vec<f64>, String> {
        let out: Vec<_> = self
            .beats
            .iter()
            .copied()
            .filter(|b| *b >= self.start() + lead && *b < self.end() + tail)
            .collect();
        if out.len() > 128 {
            return Err("wetFloor landing count exceeds budget".into());
        }
        Ok(out)
    }
}
