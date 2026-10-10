use super::{
    rebirth_contract::Clock,
    sky::{self, Args, Session},
    BackgroundFact, Sample,
};
pub fn inspect(
    session: &Session,
    a: &Args,
    s: &Sample<'_>,
    character: &BackgroundFact<'_>,
) -> Result<Clock, String> {
    if let Some(issue) = crate::programmatic_resources::validate(s.resources).first() {
        return Err(issue.message.clone());
    }
    if s.resources.iter().find(|r| r.id == a.bg) != Some(&session.source) {
        return Err("Sky retained source descriptor mismatch".into());
    }
    match s.background.as_ref() {
        Some(bg)
            if bg.resource == &session.source && [bg.width, bg.height] == session.dimensions => {}
        _ => return Err("Sky source dimensions must match admitted native fact".into()),
    }
    if s.resources.iter().find(|r| r.id == a.char) != Some(character.resource)
        || character.resource.kind != "image"
    {
        return Err("Sky character dimensions descriptor mismatch".into());
    }
    crate::image_sequence::decoded_image_bytes(character.width, character.height)?;
    if a.seed.unwrap_or(3913) != session.seed
        || a.impact.unwrap_or([1150.0, 300.0]) != session.impact
        || sky::night_color(a.night.as_deref().unwrap_or("#070b1c"))? != session.night_color
    {
        return Err("Sky preparation settings differ from retained session".into());
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
        return Err("Sky requires bounded real beats and whole-song shot clock".into());
    }
    let t = s.song_ticks as f64 / 120000.0;
    let t0 = s.shot_start_ticks as f64 / 120000.0;
    let end = s.shot_end_ticks as f64 / 120000.0;
    Ok(Clock {
        beats: s.beats.iter().map(|v| *v as f64 / 120000.0).collect(),
        t,
        t0,
        end,
        tq: (t * 12.0 + 1e-6).floor() / 12.0,
        progress: (t - t0) / (end - t0),
        spb: 60.0 / s.bpm,
    })
}
