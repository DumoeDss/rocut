use super::super::{
    burst::{Character, Tint, View},
    model::{Color, Ease, Role},
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Gradient {
    pub stops: Vec<(f64, Color)>,
    pub amount: Option<f64>,
    pub composite: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entrance {
    pub at: Option<f64>,
    pub duration: Option<f64>,
    pub dx: Option<f64>,
    pub dy: Option<f64>,
    pub ds: Option<f64>,
    pub rotation: Option<f64>,
    pub alpha: Option<bool>,
    pub easing: Option<Ease>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Underlay {
    pub color: Option<Color>,
    pub offset: Option<[f64; 2]>,
    pub amount: Option<f64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Actor {
    pub sprite: Character,
    pub to: Option<[f64; 3]>,
    pub easing: Option<Ease>,
    pub drawing_fps: Option<u32>,
    pub entrance: Option<Entrance>,
    pub exit: Option<Entrance>,
    pub beat_bump: Option<f64>,
    pub shadow: Option<Underlay>,
    pub rim: Option<Underlay>,
    pub silhouette: Option<Color>,
    pub glow_at: Option<[f64; 3]>,
    pub glow_color: Option<Color>,
    pub glow_amount: Option<f64>,
    pub role: Option<Role>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub image: String,
    pub from: [f64; 3],
    pub to: Option<[f64; 3]>,
    pub easing: Option<Ease>,
    pub anchor: Option<[f64; 2]>,
    pub alpha: Option<f64>,
    pub rotation: Option<f64>,
    pub role: Option<Role>,
}
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Fx {
    Embers {
        n: Option<u32>,
        seed: Option<u32>,
        area: Option<[f64; 4]>,
        color: Option<Color>,
        rise: Option<f64>,
        size: Option<f64>,
        wind: Option<f64>,
        alpha: Option<f64>,
    },
    Fireflies {
        n: Option<u32>,
        seed: Option<u32>,
        area: Option<[f64; 4]>,
        color: Option<Color>,
        size: Option<f64>,
        alpha: Option<f64>,
    },
    Rain {
        n: Option<u32>,
        seed: Option<u32>,
        angle: Option<f64>,
        speed: Option<f64>,
        len: Option<f64>,
        width: Option<f64>,
        color: Option<Color>,
    },
    Dust {
        n: Option<u32>,
        seed: Option<u32>,
        color: Option<Color>,
    },
    Feathers {
        n: Option<u32>,
        seed: Option<u32>,
        size: Option<f64>,
        color: Option<Color>,
        line: Option<Color>,
    },
    Rays {
        x: f64,
        y: f64,
        n: Option<u32>,
        len: Option<f64>,
        color: Option<Color>,
        amount: Option<f64>,
        seed: Option<u32>,
    },
    Glow {
        x: f64,
        y: f64,
        r: f64,
        color: Option<Color>,
        amount: Option<f64>,
        beat: Option<f64>,
    },
    Cracks {
        seed: Option<u32>,
        x: Option<f64>,
        y: Option<f64>,
        n: Option<u32>,
        reach: Option<f64>,
        progress: Option<f64>,
        at: Option<f64>,
        duration: Option<f64>,
        color: Option<Color>,
        width: Option<f64>,
        glow: Option<Color>,
    },
    Grad {
        gradient: Gradient,
    },
    Fill {
        color: Color,
        amount: Option<f64>,
        composite: Option<String>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    pub bg: Option<String>,
    pub bg_from: Option<View>,
    pub bg_to: Option<View>,
    pub bg_ease: Option<Ease>,
    pub beat_zoom: Option<f64>,
    pub shake: Option<f64>,
    pub color: Option<Color>,
    pub grad: Option<Gradient>,
    #[serde(default)]
    pub tint: Vec<Tint>,
    pub overlay_grad: Option<Gradient>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub chars: Vec<Actor>,
    #[serde(default)]
    pub fx_back: Vec<Fx>,
    #[serde(default)]
    pub fx: Vec<Fx>,
    pub vignette: Option<f64>,
}
pub fn range(v: f64, lo: f64, hi: f64) -> bool {
    v.is_finite() && (lo..=hi).contains(&v)
}
pub fn color(c: &Color) -> bool {
    c.iter().all(|v| range(*v, 0.0, 1.0))
}
pub fn composite(s: Option<&str>) -> bool {
    s.is_none_or(|s| {
        [
            "multiply",
            "screen",
            "soft-light",
            "overlay",
            "color",
            "source-over",
            "lighter",
            "lighten",
        ]
        .contains(&s)
    })
}
fn gradient(g: &Gradient) -> bool {
    !g.stops.is_empty()
        && g.stops.len() <= 32
        && g.stops.iter().all(|(p, c)| range(*p, 0.0, 1.0) && color(c))
        && g.amount.is_none_or(|v| range(v, 0.0, 1.0))
        && composite(g.composite.as_deref())
}
fn view(v: &View) -> bool {
    v.zoom.is_none_or(|v| range(v, 0.01, 16.0))
        && [v.x, v.y]
            .into_iter()
            .flatten()
            .all(|v| range(v, -16.0, 16.0))
        && v.rot.is_none_or(|v| range(v, -100.0, 100.0))
}
fn underlay(u: &Underlay) -> bool {
    u.color.as_ref().is_none_or(color)
        && u.offset
            .is_none_or(|v| v.iter().all(|v| range(*v, -8192.0, 8192.0)))
        && u.amount.is_none_or(|v| range(v, 0.0, 1.0))
}
fn entrance(e: &Entrance) -> bool {
    e.at.is_none_or(|v| range(v, -21600.0, 21600.0))
        && e.duration.is_none_or(|v| range(v, 0.001, 21600.0))
        && [e.dx, e.dy]
            .into_iter()
            .flatten()
            .all(|v| range(v, -8192.0, 8192.0))
        && e.ds.is_none_or(|v| range(v, -0.99, 8.0))
        && e.rotation.is_none_or(|v| range(v, -100.0, 100.0))
}
pub(in crate::mv_recipe) fn valid(
    a: &Args,
    resources: &[crate::programmatic_resources::Resource],
) -> bool {
    let image = |s: &str| resources.iter().any(|r| r.id == s && r.kind == "image");
    crate::programmatic_resources::validate(resources).is_empty()
        && a.bg.as_deref().is_none_or(image)
        && a.bg_from.as_ref().is_none_or(view)
        && a.bg_to.as_ref().is_none_or(view)
        && a.color.as_ref().is_none_or(color)
        && a.grad.as_ref().is_none_or(gradient)
        && a.overlay_grad.as_ref().is_none_or(gradient)
        && a.beat_zoom.is_none_or(|v| range(v, 0.0, 2.0))
        && a.shake.is_none_or(|v| range(v, 0.0, 256.0))
        && a.vignette.is_none_or(|v| range(v, 0.0, 1.0))
        && a.tint.len() <= 16
        && a.tint
            .iter()
            .all(|t| color(&t.color) && range(t.amount, 0.0, 1.0) && composite(Some(&t.composite)))
        && a.layers.len() <= 32
        && a.layers.iter().all(|l| {
            image(&l.image)
                && l.from[..2].iter().all(|v| range(*v, -8192.0, 8192.0))
                && range(l.from[2], 1.0, 8192.0)
                && l.to.is_none_or(|v| {
                    v[..2].iter().all(|v| range(*v, -8192.0, 8192.0)) && range(v[2], 1.0, 8192.0)
                })
                && l.anchor
                    .is_none_or(|v| v.iter().all(|v| range(*v, 0.0, 1.0)))
                && l.alpha.is_none_or(|v| range(v, 0.0, 1.0))
                && l.rotation.is_none_or(|v| range(v, -100.0, 100.0))
        })
        && a.chars.len() <= 32
        && a.chars.iter().all(|c| {
            super::sprite::valid(c, resources)
                && c.entrance.as_ref().is_none_or(entrance)
                && c.exit.as_ref().is_none_or(entrance)
                && c.shadow.as_ref().is_none_or(underlay)
                && c.rim.as_ref().is_none_or(underlay)
                && c.to.is_none_or(|v| {
                    v[..2].iter().all(|v| range(*v, -8192.0, 8192.0)) && range(v[2], 1.0, 8192.0)
                })
                && c.drawing_fps.is_none_or(|v| v <= 120)
                && c.beat_bump.is_none_or(|v| range(v, 0.0, 2.0))
                && c.silhouette.as_ref().is_none_or(color)
                && c.glow_at.is_none_or(|v| {
                    v[..2].iter().all(|v| range(*v, -8.0, 8.0)) && range(v[2], 0.001, 16.0)
                })
                && c.glow_color.as_ref().is_none_or(color)
                && c.glow_amount.is_none_or(|v| range(v, 0.0, 1.0))
        })
        && a.fx_back.len() + a.fx.len() <= 32
        && a.fx_back.iter().chain(&a.fx).all(super::fx::valid)
        && expanded_work(a) <= 4096
}
pub(in crate::mv_recipe) fn image_ids(a: &Args) -> Vec<&str> {
    a.bg.as_deref()
        .into_iter()
        .chain(a.layers.iter().map(|l| l.image.as_str()))
        .chain(a.chars.iter().map(|c| c.sprite.image.as_str()))
        .collect()
}
pub(in crate::mv_recipe) fn scratch_pixels(
    a: &Args,
    images: Option<&crate::mv_image_dimensions::Context>,
) -> Result<u64, String> {
    let mut pixels = 0;
    if let Some(images) = images {
        for c in &a.chars {
            if c.shadow.is_some() || c.rim.is_some() || c.silhouette.is_some() {
                let d = images.image(&c.sprite.image)?;
                pixels = pixels.max(u64::from(d.width) * u64::from(d.height));
            }
        }
    }
    if a.chars.iter().any(|c| c.rim.is_some())
        || a.fx_back
            .iter()
            .chain(&a.fx)
            .any(|f| matches!(f, Fx::Cracks { .. }))
    {
        pixels = pixels
            .checked_add(2 * 1920 * 1080)
            .ok_or("IllustNative native filter scratch overflow")?;
    }
    Ok(pixels)
}
pub(in crate::mv_recipe) fn expanded_work(a: &Args) -> u32 {
    let actors = a
        .chars
        .iter()
        .map(|c| {
            (if c.sprite.disable_wave { 1 } else { 90 })
                * (1 + u32::from(c.shadow.is_some()) + u32::from(c.rim.is_some()))
                + 4
        })
        .fold(0u32, u32::saturating_add);
    let effects = a
        .fx_back
        .iter()
        .chain(&a.fx)
        .map(super::fx::work)
        .fold(0u32, u32::saturating_add);
    32u32
        .saturating_add(u32::try_from(a.layers.len()).unwrap_or(u32::MAX))
        .saturating_add(actors)
        .saturating_add(effects)
}
pub(in crate::mv_recipe) fn plan_bytes_bound(_a: &Args) -> u64 {
    4 * 1024 * 1024
}
