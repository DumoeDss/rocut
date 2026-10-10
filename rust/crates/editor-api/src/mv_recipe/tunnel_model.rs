use serde::Deserialize;
use std::collections::BTreeMap;
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
pub struct Tunnel {
    pub fonts: super::fonts::Fonts,
    /// Original preload-only resource; it is not drawn by tunnel.
    pub reveal: Option<String>,
    /// Original authored hint, currently visually inert.
    #[serde(default = "toward")]
    pub toward: String,
    #[serde(default = "words")]
    pub words: Vec<String>,
    /// Absolute song seconds, preserving original ordered comparison semantics.
    pub plan: Option<Vec<(f64, String)>>,
    #[serde(default = "f")]
    pub f: f64,
    #[serde(default = "v0")]
    pub v0: f64,
    #[serde(default = "v1")]
    pub v1: f64,
    #[serde(default = "fade")]
    pub fade_in: f64,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
}
fn words() -> Vec<String> {
    [
        "暗闇の果てで",
        "まだ遅くない",
        "あなたに会いたい",
        "光",
        "残光",
    ]
    .map(String::from)
    .to_vec()
}
fn toward() -> String {
    "dawn".into()
}
fn f() -> f64 {
    820.0
}
fn v0() -> f64 {
    3.1
}
fn v1() -> f64 {
    9.5
}
fn fade() -> f64 {
    0.18
}
/// Native measureText advances at exactly 100px with the complete fallback stack.
/// No estimated widths or synthetic fallback are admitted.
pub struct Metrics {
    pub(super) stacks: BTreeMap<String, super::fonts::Stack>,
    pub(super) mincho_800: BTreeMap<String, f64>,
    pub(super) dot_400: BTreeMap<String, f64>,
}
pub(super) const LATIN: [&str; 5] = [
    "AT THE END OF THE DARKNESS",
    "IT IS NOT TOO LATE",
    "I STILL WANT TO SEE YOU",
    "ZANKŌ — AFTERGLOW",
    "HOLD ON TO THE LAST LIGHT",
];
impl Tunnel {
    pub(super) fn validate(&self) -> Result<(), String> {
        let text = |s: &String| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control);
        let ids = [
            &self.fonts.mincho800,
            &self.fonts.dot400,
            &self.fonts.heavy900,
            &self.fonts.noto400,
            &self.fonts.noto800,
            &self.fonts.noto900,
        ];
        if !ids.iter().all(|id| text(id))
            || ids
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != 6
        {
            return Err("tunnel requires six distinct declared font role IDs".into());
        }
        if self.words.is_empty()
            || self.words.len() > 32
            || !self.words.iter().all(text)
            || !text(&self.toward)
            || self.reveal.as_ref().is_some_and(|r| !text(r))
            || !self.f.is_finite()
            || !(1.0..=4096.0).contains(&self.f)
            || !self.v0.is_finite()
            || !(0.01..=100.0).contains(&self.v0)
            || !self.v1.is_finite()
            || !(0.01..=100.0).contains(&self.v1)
            || !self.fade_in.is_finite()
            || !(0.0..=60.0).contains(&self.fade_in)
            || !self.bpm.is_finite()
            || !(1.0..=1000.0).contains(&self.bpm)
            || self.plan.as_ref().is_some_and(|p| {
                p.is_empty()
                    || p.len() > 256
                    || p.iter()
                        .any(|(t, w)| !t.is_finite() || !(0.0..=21600.0).contains(t) || !text(w))
            })
        {
            return Err("tunnel settings exceed bounded native admission".into());
        }
        Ok(())
    }
}
impl Metrics {
    pub(super) fn stack(&self, role: &str) -> super::fonts::Stack {
        self.stacks[role].clone()
    }
    pub(super) fn width(&self, ch: char, latin: bool) -> Result<f64, String> {
        let map = if latin {
            &self.dot_400
        } else {
            &self.mincho_800
        };
        map.get(&ch.to_string())
            .copied()
            .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 4096.0)
            .ok_or_else(|| format!("tunnel missing native 100px advance for {ch:?}"))
    }
}
