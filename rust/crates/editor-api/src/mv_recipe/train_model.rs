use crate::programmatic_resources::Resource;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fonts {
    pub mincho800: String,
    pub noto800: String,
    pub mincho700: String,
    pub noto700: String,
    pub dot400: String,
    pub noto400: String,
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
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Beats {
    Manual {
        #[serde(rename = "songTicks")]
        song_ticks: Vec<u64>,
    },
    Analysis,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub bg: String,
    pub fonts: Fonts,
    pub chars: Option<Vec<String>>,
    pub window_chars: Option<Vec<String>>,
    pub freeze: Option<[f64; 2]>,
    pub exit_at: Option<f64>,
    pub hero_x: Option<f64>,
    pub hero: Option<usize>,
    pub cars: Option<usize>,
    pub shutter: Option<f64>,
    pub taps: Option<usize>,
    pub from: Option<View>,
    pub to: Option<View>,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: i64,
}
pub const DEFAULT_CHARS: [&str; 4] = [
    "assets/char/bust_sing.png",
    "assets/char/bust_calm.png",
    "assets/char/eyes_ecu.png",
    "assets/char/smile_dawn.png",
];
impl Settings {
    pub fn characters(&self) -> Vec<&str> {
        self.chars
            .as_ref()
            .or(self.window_chars.as_ref())
            .map(|v| v.iter().map(String::as_str).collect())
            .unwrap_or_else(|| DEFAULT_CHARS.to_vec())
    }
    pub fn freeze(&self) -> [f64; 2] {
        self.freeze.unwrap_or([116.76, 116.93])
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.bg.is_empty()
            || self.bg.len() > 512
            || self.cars.is_some_and(|n| n == 0 || n > 16)
            || self.taps.is_some_and(|n| n == 0 || n > 32)
            || self
                .shutter
                .is_some_and(|v| !v.is_finite() || !(0.0..=4.0).contains(&v))
            || self.hero.is_some_and(|n| n > 8192)
            || !self.bpm.is_finite()
            || !(1.0..=1000.0).contains(&self.bpm)
            || self.downbeat_index0.unsigned_abs() > 8192
        {
            return Err("Train invalid bounded author settings".into());
        }
        for chars in [&self.chars, &self.window_chars].into_iter().flatten() {
            if chars.is_empty()
                || chars.len() > 32
                || chars.iter().any(|s| s.is_empty() || s.len() > 512)
            {
                return Err("Train invalid character IDs".into());
            }
        }
        let f = self.freeze();
        if f.iter().any(|v| !v.is_finite() || *v < 0.0 || *v > 1e9)
            || f[1] < f[0]
            || f[1] - f[0] > 30.0
            || self
                .exit_at
                .is_some_and(|v| !v.is_finite() || v.abs() > 1e9)
            || self
                .hero_x
                .is_some_and(|v| !v.is_finite() || v.abs() > 8192.0)
        {
            return Err("Train invalid freeze/exit geometry".into());
        }
        for v in [self.from, self.to].into_iter().flatten() {
            if !v.zoom.is_finite()
                || !(0.1..=8.0).contains(&v.zoom)
                || [v.x, v.y, v.rot]
                    .iter()
                    .any(|n| !n.is_finite() || n.abs() > 8.0)
            {
                return Err("Train invalid camera view".into());
            }
        }
        if let Beats::Manual { song_ticks } = &self.beats {
            if song_ticks.len() > 8192
                || song_ticks.windows(2).any(|w| w[0] >= w[1])
                || song_ticks.iter().any(|t| *t > 9_007_199_254_740_991)
            {
                return Err("Train invalid manual beat ticks".into());
            }
        }
        Ok(())
    }
}
pub struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: &'a [f64],
}
impl Sample<'_> {
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
    pub fn validate(&self) -> Result<(), String> {
        if self.shot_end_ticks <= self.shot_start_ticks
            || self.shot_end_ticks - self.shot_start_ticks > 120000 * 300
            || [self.song_ticks, self.shot_end_ticks]
                .iter()
                .any(|t| *t > 9_007_199_254_740_991)
            || self.beats.len() > 8192
            || self
                .beats
                .iter()
                .any(|t| !t.is_finite() || *t < 0.0 || *t > 1e9)
            || self.beats.windows(2).any(|w| w[0] >= w[1])
        {
            return Err("Train invalid mapped clock".into());
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct Image {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
}
