//! Original meta.js reference-shot sampling and style plans. No JS author facts.
#[path = "meta_crack.rs"]
mod crack;
#[path = "meta_rewind.rs"]
mod rewind;
pub use rewind::{Rewind, RewindPlan, ShotCandidate};
#[path = "meta_melt.rs"]
mod melt;
pub use melt::{Melt, MeltPlan};
#[path = "meta_panels.rs"]
mod panels;
pub use panels::{Panels, PanelsPlan};
#[path = "meta_catalog.rs"]
mod catalog;
/// Complete occurrence accounting, including hidden styles; no cap increases.
#[derive(Clone, Copy)]
pub enum Kind {
    Freeze,
    Rewind,
    Melt,
    Panels,
}
/// Static worst-case ceiling; configurable leaves must use their settings method.
/// These ceilings intentionally may exceed the graph cap for maximal authors.
pub fn expanded_work(kind: Kind) -> usize {
    match kind {
        Kind::Freeze => 2048,
        Kind::Rewind => 512,
        Kind::Melt => 480 * 13 + 256 * 2 + 16,
        Kind::Panels => 4 * (16 + 64) + 246,
    }
}
pub fn plan_bytes_bound(kind: Kind) -> u64 {
    match kind {
        Kind::Freeze => 256 * 1024,
        Kind::Rewind => 4 * 1024 * 1024,
        Kind::Melt => 512 * 1024,
        Kind::Panels => 8 * 1024 * 1024,
    }
}
pub fn scratch_pixels(kind: Kind) -> u64 {
    match kind {
        Kind::Freeze => 1920 * 1080 * 3,
        Kind::Rewind => 1920 * 1080 * 3 + 960 * 1080 + 200 * 112 + 640 * 256,
        Kind::Melt => 1920 * 1080 * 4 + 1920 * 60,
        Kind::Panels => 1920 * 1080 * 2 + 960 * 540,
    }
}
#[path = "meta_freeze.rs"]
mod freeze;
#[path = "converge_math.rs"]
mod math;
pub use freeze::{Freeze, FreezePlan};
use serde::Serialize;
pub struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildSample {
    pub input: String,
    pub song_ticks: i64,
}
pub(super) fn time(s: &Sample<'_>) -> Result<(f64, f64, f64), String> {
    if s.shot_start_ticks >= s.shot_end_ticks
        || s.shot_end_ticks > 2_592_000_000
        || s.song_ticks > 2_592_000_000
    {
        return Err("Meta invalid mapped integer clock".into());
    }
    Ok((
        s.song_ticks as f64 / 120000.0,
        s.shot_start_ticks as f64 / 120000.0,
        s.shot_end_ticks as f64 / 120000.0,
    ))
}
pub(super) fn child(input: &str, t: f64) -> Result<ChildSample, String> {
    if input.is_empty()
        || input.len() > 64
        || !input
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || !t.is_finite()
        || t.abs() > 21600.0
    {
        return Err("Meta invalid local child identity/time".into());
    }
    Ok(ChildSample {
        input: input.into(),
        song_ticks: (t * 120000.0).round() as i64,
    })
}
pub(super) fn inv(a: f64, b: f64, t: f64) -> f64 {
    ((t - a) / (b - a)).clamp(0.0, 1.0)
}
pub(super) fn out_cubic(k: f64) -> f64 {
    1.0 - (1.0 - k).powi(3)
}
/// ECMAScript Uint8ClampedArray conversion, including ties-to-even.
pub(super) fn clamped_byte(v: f64) -> u8 {
    let v = v.clamp(0.0, 255.0);
    let low = v.floor();
    let frac = v - low;
    if frac > 0.5 || (frac == 0.5 && low as u32 % 2 == 1) {
        (low + 1.0) as u8
    } else {
        low as u8
    }
}
pub(super) fn out_expo(k: f64) -> f64 {
    if k >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * k)
    }
}
pub(super) fn rnd(xs: &[f64]) -> f64 {
    f64::from(math::hash(xs)) / 4294967296.0
}
pub(super) fn rnds(xs: &[f64]) -> f64 {
    rnd(xs) * 2.0 - 1.0
}
#[cfg(test)]
#[path = "meta_reference_tests.rs"]
mod tests;
