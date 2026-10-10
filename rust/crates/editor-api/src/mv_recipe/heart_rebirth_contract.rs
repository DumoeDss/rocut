//! Author-only gather/sun settings and separately admitted native image facts.
use super::{BackgroundFact, Plan, Sample, Session};
use serde::{Deserialize, Serialize};
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Gather {
    pub heart: String,
    pub char: String,
    #[serde(default)]
    pub bg: Option<String>,
    #[serde(default)]
    pub firefly: Option<bool>,
    #[serde(default)]
    pub n: Option<u32>,
    #[serde(default)]
    pub char_h: Option<f64>,
    #[serde(default)]
    pub char_x: Option<f64>,
    #[serde(default)]
    pub char_y: Option<f64>,
    #[serde(default)]
    pub target: Option<[f64; 2]>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sun {
    pub heart: String,
    pub char: String,
    #[serde(default)]
    pub fuse_at: Option<f64>,
    #[serde(default)]
    pub fuse_beat: Option<u32>,
    #[serde(default)]
    pub sun_x: Option<f64>,
    #[serde(default)]
    pub sun_y: Option<f64>,
    #[serde(default)]
    pub sun_r: Option<f64>,
    #[serde(default)]
    pub char_h: Option<f64>,
    #[serde(default)]
    pub char_x: Option<f64>,
    #[serde(default)]
    pub char_y: Option<f64>,
}
pub struct Clock {
    pub beats: Vec<f64>,
    pub t: f64,
    pub t0: f64,
    pub end: f64,
    pub tq: f64,
    pub progress: f64,
    pub spb: f64,
}
pub fn inspect(
    session: &Session,
    heart: &str,
    char_id: &str,
    bg: Option<&str>,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Clock, String> {
    if let Some(issue) = crate::programmatic_resources::validate(s.resources).first() {
        return Err(issue.message.clone());
    }
    let r = s
        .resources
        .iter()
        .find(|r| r.id == heart)
        .ok_or("Heart source image is missing")?;
    if r != &session.binding.source {
        return Err("Heart prepared source descriptor mismatch".into());
    }
    if s.resources.iter().find(|r| r.id == char_id) != Some(character.resource)
        || character.resource.kind != "image"
    {
        return Err("Heart character dimensions descriptor mismatch".into());
    }
    crate::image_sequence::decoded_image_bytes(character.width, character.height)?;
    match (bg, s.background.as_ref()) {
        (None, None) => {}
        (Some(id), Some(f)) => {
            if s.resources.iter().find(|r| r.id == id) != Some(f.resource)
                || f.resource.kind != "image"
            {
                return Err("Heart background dimensions descriptor mismatch".into());
            }
            crate::image_sequence::decoded_image_bytes(f.width, f.height)?;
        }
        _ => return Err("Heart background facts must match author binding".into()),
    }
    if s.beats.is_empty()
        || s.beats.len() > 21600
        || s.beats.windows(2).any(|p| p[0] >= p[1])
        || s.beats.iter().any(|t| *t > 2_592_000_000)
        || !s.bpm.is_finite()
        || !(1.0..=1000.0).contains(&s.bpm)
        || s.shot_start_ticks >= s.shot_end_ticks
        || s.song_ticks < s.shot_start_ticks
        || s.song_ticks > s.shot_end_ticks
        || s.shot_end_ticks > 2_592_000_000
    {
        return Err("Heart requires bounded real beats and whole-song shot clock".into());
    }
    let t = s.song_ticks as f64 / 120000.0;
    let t0 = s.shot_start_ticks as f64 / 120000.0;
    let end = s.shot_end_ticks as f64 / 120000.0;
    Ok(Clock {
        beats: s.beats.iter().map(|t| *t as f64 / 120000.0).collect(),
        t,
        t0,
        end,
        tq: (t * 12.0 + 1e-6).floor() / 12.0,
        progress: (t - t0) / (end - t0),
        spb: 60.0 / s.bpm,
    })
}
pub fn geometry(values: &[f64]) -> Result<(), String> {
    if values.iter().any(|v| !v.is_finite() || v.abs() > 8192.0) {
        Err("Heart geometry is non-finite or exceeds limits".into())
    } else {
        Ok(())
    }
}
pub fn finish(
    mut plan: Plan,
    session: &Session,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Plan, String> {
    let char_bytes = crate::image_sequence::decoded_image_bytes(character.width, character.height)?
        * 2
        + character.resource.byte_length();
    plan.raster_budget_bytes = super::budget::validate(&plan, session, s.background.as_ref())?
        .checked_add(char_bytes)
        .ok_or("Heart residency overflow")?;
    if plan.raster_budget_bytes > 256 * 1024 * 1024 {
        return Err("Heart joint character/frame residency exceeds ceiling".into());
    }
    Ok(plan)
}
