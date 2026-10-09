use serde::Deserialize;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Variant {
    Intro,
    Outro,
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
    pub title: String,
    pub hud: String,
    pub ruby: String,
    pub subtitle: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hud {
    pub title: String,
    pub when: String,
    pub bpm: String,
    pub geo: String,
    pub place: String,
    pub len: String,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cues {
    pub sun: i8,
    pub hud: i8,
    pub hud2: i8,
    pub zan: i8,
    pub cross: i8,
    pub ko: i8,
    pub split: i8,
    pub neg: i8,
    pub sil: i8,
    pub lock: i8,
    pub exit: i8,
}
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Ruby {
    Disabled(bool),
    Pair([String; 2]),
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View {
    pub zoom: f64,
    pub x: f64,
    pub y: f64,
    pub rot: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recap {
    pub bg: String,
    #[serde(rename = "char")]
    pub character: Option<String>,
    pub view: View,
    pub h: f64,
    pub cx: f64,
    pub cy: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleRiff {
    pub variant: Variant,
    pub beats: Beats,
    pub bpm: f64,
    pub downbeat_index0: u32,
    pub credit: String,
    pub fonts: Fonts,
    #[serde(rename = "char")]
    pub character: String,
    pub sky: String,
    pub glyphs: [String; 2],
    pub ruby: Ruby,
    pub sub: String,
    pub hud: Hud,
    pub cues: Cues,
    pub exit: bool,
    pub grain: f64,
    pub recap: Option<Vec<Recap>>,
    #[serde(rename = "final")]
    pub final_image: Option<String>,
}
// Reuses the exact intro.js Newton/bisection implementation, not TypeCard easing.
#[derive(Clone, Copy)]
pub(super) enum Easing {
    Out,
    In,
    Io,
    Soft,
    Whip,
}

impl TitleRiff {
    pub(super) fn outro(&self) -> bool {
        self.variant == Variant::Outro
    }
    pub(in crate::mv_recipe) fn images(&self) -> Vec<&str> {
        let mut ids = vec![self.character.as_str(), self.sky.as_str()];
        if let Some(items) = &self.recap {
            for item in items {
                ids.push(&item.bg);
                if let Some(id) = &item.character {
                    ids.push(id);
                }
            }
        }
        if let Some(id) = &self.final_image {
            ids.push(id);
        }
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}
