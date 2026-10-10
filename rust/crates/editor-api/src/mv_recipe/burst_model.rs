use crate::{mv_recipe::model::Color, programmatic_resources::Resource};
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub zoom: Option<f64>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub rot: Option<f64>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Wave {
    pub amp: f64,
    pub from: f64,
    pub freq: f64,
    pub speed: f64,
    pub drawing_fps: u32,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Character {
    pub image: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub h: Option<f64>,
    #[serde(default)]
    pub flip: bool,
    pub anchor: Option<[f64; 2]>,
    pub rot: Option<f64>,
    pub sway: Option<f64>,
    pub breathe: Option<f64>,
    pub phase: Option<f64>,
    pub alpha: Option<f64>,
    pub wave: Option<Wave>,
    #[serde(default)]
    pub disable_wave: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lamps {
    pub a: Vec<[f64; 2]>,
    pub b: Vec<[f64; 2]>,
    pub radius: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tint {
    pub color: Color,
    pub amount: f64,
    pub composite: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cut {
    pub bg: Option<String>,
    pub color: Option<Color>,
    pub view: Option<View>,
    pub view_to: Option<View>,
    pub character: Option<Character>,
    pub dir: Option<i32>,
    pub line_color: Option<Color>,
    pub rim: Option<Color>,
    #[serde(default)]
    pub disable_rim: bool,
    pub rim_dir: Option<i32>,
    pub rim_a: Option<f64>,
    pub lamps: Option<Lamps>,
    #[serde(default)]
    pub tint: Vec<Tint>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Flash {
    Mode(String),
    Cuts(Vec<u32>),
    Enabled(bool),
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    pub cuts: Vec<Cut>,
    pub every: Option<u32>,
    pub lead: Option<f64>,
    pub flash: Option<Flash>,
    pub flash_color: Option<Color>,
    pub speed: Option<bool>,
    pub grade: Option<String>,
    pub roll: Option<f64>,
    pub rim: Option<Color>,
    #[serde(default)]
    pub disable_rim: bool,
    pub hud_font: Option<String>,
}
fn range(v: f64, lo: f64, hi: f64) -> bool {
    v.is_finite() && (lo..=hi).contains(&v)
}
fn color(c: &Color) -> bool {
    c.iter().all(|v| range(*v, 0.0, 1.0))
}
fn view(v: &View) -> bool {
    v.zoom.is_none_or(|v| range(v, 0.01, 16.0))
        && [v.x, v.y]
            .into_iter()
            .flatten()
            .all(|v| range(v, -16.0, 16.0))
        && v.rot.is_none_or(|v| range(v, -100.0, 100.0))
}
pub fn valid(a: &Args, r: &[Resource]) -> bool {
    if !crate::programmatic_resources::validate(r).is_empty() {
        return false;
    }
    let image = |id: &str| r.iter().any(|r| r.id == id && r.kind == "image");
    !a.cuts.is_empty()
        && a.cuts.len() <= 64
        && a.every.is_none_or(|v| (1..=21600).contains(&v))
        && a.lead.is_none_or(|v| range(v, 0.0, 1.0))
        && a.roll.is_none_or(|v| range(v, -1.0, 1.0))
        && a.grade.as_deref().is_none_or(|v| v == "night2dawn")
        && a.rim.as_ref().is_none_or(color)
        && a.flash_color.as_ref().is_none_or(color)
        && a.flash.as_ref().is_none_or(|v| match v {
            Flash::Mode(s) => ["alt", "all", "none"].contains(&s.as_str()),
            Flash::Cuts(v) => v.len() <= 21600 && v.iter().all(|v| *v <= 21600),
            Flash::Enabled(_) => true,
        })
        && a.hud_font
            .as_ref()
            .is_none_or(|id| r.iter().any(|r| r.id == *id && r.kind == "font"))
        && a.cuts.iter().all(|c| {
            c.bg.as_deref().is_none_or(image)
                && c.color.as_ref().is_none_or(color)
                && c.view.as_ref().is_none_or(view)
                && c.view_to.as_ref().is_none_or(view)
                && c.dir.is_none_or(|v| v == 1 || v == -1)
                && c.rim_dir.is_none_or(|v| v == 1 || v == -1)
                && c.rim.as_ref().is_none_or(color)
                && c.line_color.as_ref().is_none_or(color)
                && c.rim_a.is_none_or(|v| range(v, 0.0, 1.0))
                && c.tint.len() <= 16
                && c.tint.iter().all(|v| {
                    color(&v.color)
                        && range(v.amount, 0.0, 1.0)
                        && [
                            "multiply",
                            "screen",
                            "soft-light",
                            "overlay",
                            "color",
                            "source-over",
                            "lighter",
                        ]
                        .contains(&v.composite.as_str())
                })
                && c.lamps.as_ref().is_none_or(|l| {
                    c.bg.is_some()
                        && l.a.len() + l.b.len() <= 64
                        && range(l.radius, 0.1, 4096.0)
                        && l.a
                            .iter()
                            .chain(&l.b)
                            .flatten()
                            .all(|v| range(*v, -8192.0, 8192.0))
                })
                && c.character.as_ref().is_none_or(|c| {
                    image(&c.image)
                        && [c.x, c.y]
                            .into_iter()
                            .flatten()
                            .all(|v| range(v, -8192.0, 8192.0))
                        && c.h.is_none_or(|v| range(v, 1.0, 8192.0))
                        && c.anchor
                            .is_none_or(|v| v.iter().all(|v| range(*v, 0.0, 1.0)))
                        && c.alpha.is_none_or(|v| range(v, 0.0, 1.0))
                        && [c.rot, c.sway, c.breathe, c.phase]
                            .into_iter()
                            .flatten()
                            .all(|v| range(v, -100.0, 100.0))
                        && c.wave.as_ref().is_none_or(|w| {
                            range(w.amp, 0.0, 256.0)
                                && range(w.from, 0.0, 0.99)
                                && range(w.freq, 0.0, 16.0)
                                && range(w.speed, 0.0, 100.0)
                                && (1..=120).contains(&w.drawing_fps)
                        })
                })
        })
}
