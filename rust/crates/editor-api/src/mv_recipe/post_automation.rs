//! Bounded source-frame amount curves. The outer recipe clock is intentional:
//! remapping a child scene never rewinds finishing or the native song track.
use super::{
    model::{Ease, Effect, Span},
    validate::range,
};
use serde::Deserialize;
use std::collections::BTreeSet;

pub(super) const MAX_KEYS: usize = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmountKey {
    pub frame: u32,
    pub value: f64,
    /// Easing for the segment leaving this key; endpoints hold.
    pub easing: Ease,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmountCurve {
    pub effect: usize,
    pub keyframes: Vec<AmountKey>,
}

pub fn valid(curves: &[AmountCurve], effects: &[Effect], frames: u32) -> bool {
    curves.len() <= effects.len()
        && curves
            .iter()
            .map(|c| c.effect)
            .collect::<BTreeSet<_>>()
            .len()
            == curves.len()
        && curves.iter().all(|curve| {
            let Some(mut effect) = effects.get(curve.effect).cloned() else {
                return false;
            };
            let Some((_, max)) = effect.audio_amount() else {
                return false;
            };
            !curve.keyframes.is_empty()
                && curve.keyframes.len() <= MAX_KEYS
                && curve
                    .keyframes
                    .iter()
                    .all(|key| key.frame <= frames && range(key.value, 0.0, max))
                && curve
                    .keyframes
                    .windows(2)
                    .all(|keys| keys[0].frame < keys[1].frame)
        })
}

pub fn effect(curves: &[AmountCurve], index: usize, authored: &Effect, frame: u64) -> Effect {
    let mut out = authored.clone();
    let Some(curve) = curves.iter().find(|c| c.effect == index) else {
        return out;
    };
    // Only validated curves reach evaluation; membership is at integer frames.
    let upper = curve
        .keyframes
        .partition_point(|k| u64::from(k.frame) <= frame);
    let value = if upper == 0 {
        curve.keyframes[0].value
    } else if upper == curve.keyframes.len() {
        curve.keyframes[upper - 1].value
    } else {
        let a = &curve.keyframes[upper - 1];
        let b = &curve.keyframes[upper];
        let p = super::evaluate::progress(
            frame as f64,
            &Span {
                start_frame: a.frame,
                duration_frames: b.frame - a.frame,
            },
            a.easing,
        );
        super::evaluate::lerp(a.value, b.value, p)
    };
    if let Some((amount, max)) = out.audio_amount() {
        *amount = value.clamp(0.0, max);
    }
    out
}
