use super::{
    model::{Camera, Effect, Pose},
    validate::range,
};
use crate::mv_audio::{Data, Signal};
use serde::Deserialize;
use std::collections::BTreeSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub resource: String,
    pub input_sha256: String,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CameraTarget {
    X,
    Y,
    Zoom,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpriteTarget {
    X,
    Y,
    Scale,
    Rotation,
    Opacity,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response<T> {
    pub target: T,
    pub signal: Signal,
    pub amount: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostResponse {
    pub effect: usize,
    pub signal: Signal,
    pub amount: f64,
}
pub fn valid<T: Ord>(items: &[Response<T>], max: usize, amount: impl Fn(&T, f64) -> bool) -> bool {
    items.len() <= max
        && items
            .iter()
            .map(|r| &r.target)
            .collect::<BTreeSet<_>>()
            .len()
            == items.len()
        && items
            .iter()
            .all(|r| r.signal.valid() && amount(&r.target, r.amount))
}
pub fn camera_valid(items: &[Response<CameraTarget>]) -> bool {
    valid(items, 3, |t, v| match t {
        CameraTarget::Zoom => range(v, 0.0, 1.0),
        _ => range(v, -1.0, 1.0),
    })
}
pub fn sprite_valid(items: &[Response<SpriteTarget>]) -> bool {
    valid(items, 5, |t, v| match t {
        SpriteTarget::Scale => range(v, -0.5, 1.0),
        _ => range(v, -1.0, 1.0),
    })
}
pub fn camera(
    items: &[Response<CameraTarget>],
    mut p: Camera,
    data: Option<&Data>,
    song: f64,
    source: f64,
) -> Result<Camera, String> {
    for r in items {
        let v = r.amount * r.signal.sample(data, song, source)?;
        match r.target {
            CameraTarget::X => p.x = (p.x + v).clamp(-1.0, 1.0),
            CameraTarget::Y => p.y = (p.y + v).clamp(-1.0, 1.0),
            CameraTarget::Zoom => p.zoom = (p.zoom * (1.0 + v)).clamp(1.0, 8.0),
        }
    }
    Ok(p)
}
pub fn sprite(
    items: &[Response<SpriteTarget>],
    p: &mut Pose,
    data: Option<&Data>,
    song: f64,
    source: f64,
) -> Result<(), String> {
    for r in items {
        let v = r.amount * r.signal.sample(data, song, source)?;
        match r.target {
            SpriteTarget::X => p.x += v,
            SpriteTarget::Y => p.y += v,
            SpriteTarget::Scale => p.height *= 1.0 + v,
            SpriteTarget::Rotation => p.rotation += v,
            SpriteTarget::Opacity => p.opacity = (p.opacity + v).clamp(0.0, 1.0),
        }
    }
    Ok(())
}
impl Effect {
    pub(super) fn audio_amount(&mut self) -> Option<(&mut f64, f64)> {
        match self {
            Self::Vignette { amount }
            | Self::LightLeak { amount, .. }
            | Self::Invert { amount }
            | Self::Flash { amount, .. }
            | Self::Fade { amount }
            | Self::Letterbox { amount, .. }
            | Self::QuantizationDither { amount }
            | Self::Grain { amount, .. }
            | Self::Glitch { amount, .. }
            | Self::ZoomBlur { amount, .. } => Some((amount, 1.0)),
            Self::LineBoil { amount, .. } => Some((amount, 32.0)),
            Self::ChromaticAberration { amount, .. } => Some((amount, 64.0)),
            Self::Bloom { amount, .. } => Some((amount, 4.0)),
            _ => None,
        }
    }
}
pub fn post_valid(items: &[PostResponse], effects: &[Effect]) -> bool {
    items.len() <= effects.len()
        && items
            .iter()
            .map(|r| r.effect)
            .collect::<BTreeSet<_>>()
            .len()
            == items.len()
        && items.iter().all(|r| {
            r.signal.valid()
                && effects.get(r.effect).is_some_and(|e| {
                    e.clone()
                        .audio_amount()
                        .is_some_and(|(_, max)| range(r.amount, -max, max))
                })
        })
}
pub fn effect(
    items: &[PostResponse],
    index: usize,
    effect: &Effect,
    data: Option<&Data>,
    song: f64,
) -> Result<Effect, String> {
    let mut out = effect.clone();
    if let Some(r) = items.iter().find(|r| r.effect == index) {
        let v = r.amount * r.signal.sample(data, song, song)?;
        if let Some((amount, max)) = out.audio_amount() {
            *amount = (*amount + v).clamp(0.0, max);
        }
    }
    Ok(out)
}
