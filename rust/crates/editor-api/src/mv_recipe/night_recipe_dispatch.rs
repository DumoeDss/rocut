//! Include as evaluate::native_scene::night, retaining the mapped clock.
use super::{Clock, Span};
use crate::mv_recipe::night_recipe::{Night, PreparationRequest, Traversal};

pub(super) fn request(
    settings: &Night,
    span: &Span,
    clock: Clock<'_>,
    node_id: &str,
    traversal: &mut Traversal,
) -> Result<PreparationRequest, String> {
    let sample = clock.ember_sample(span)?;
    traversal.issue(
        settings.request(
            node_id,
            clock.width as u32,
            clock.height as u32,
            clock.resources,
            sample.analysis,
        )?,
        sample.song_ticks,
        sample.shot_start_ticks,
        sample.shot_end_ticks,
    )
}

pub(super) fn preflight(settings: &Night, clock: Clock<'_>, node_id: &str) -> Result<(), String> {
    settings.request(
        node_id,
        clock.width as u32,
        clock.height as u32,
        clock.resources,
        clock.audio,
    )?;
    Ok(())
}
