use crate::{CompositorError, FrameDescriptor, FrameItemDescriptor, LayerDescriptor};

fn invalid(message: &'static str) -> CompositorError {
    CompositorError::InvalidGroup { message }
}

/// Canvas-only whole-graph metadata/availability admission. No GPU access or
/// resource-content identity proof; the caller must pin source revisions separately.
pub(super) fn validate(
    frame: &FrameDescriptor,
    lookup: &mut impl FnMut(&str) -> bool,
) -> Result<(), CompositorError> {
    if !contains_canvas(frame) {
        return Ok(());
    }
    crate::group_admission::validate(frame)?;
    if frame.width == 0
        || frame.height == 0
        || !frame
            .clear
            .color
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
    {
        return Err(invalid("Canvas frame dimensions/clear metadata invalid"));
    }
    let mut pending = vec![frame.items.as_slice()];
    while let Some(items) = pending.pop() {
        for item in items {
            match item {
                FrameItemDescriptor::Layer(value) => layer(value, lookup)?,
                FrameItemDescriptor::Group(group) => pending.push(&group.items),
                FrameItemDescriptor::SceneTransition(transition) => {
                    if !transition.progress.is_finite()
                        || !(0.0..=1.0).contains(&transition.progress)
                    {
                        return Err(CompositorError::InvalidTransitionProgress(
                            transition.progress,
                        ));
                    }
                    pending.push(&transition.incoming.items);
                    pending.push(&transition.outgoing.items);
                }
                FrameItemDescriptor::Transition {
                    outgoing,
                    incoming,
                    progress,
                } => {
                    if !progress.is_finite() || !(0.0..=1.0).contains(progress) {
                        return Err(CompositorError::InvalidTransitionProgress(*progress));
                    }
                    for value in outgoing.iter().chain(incoming) {
                        layer(value, lookup)?;
                    }
                }
                FrameItemDescriptor::SceneEffect { .. } => {}
            }
        }
    }
    Ok(())
}

// Detect before admission without recursive descent into an untrusted graph.
fn contains_canvas(frame: &FrameDescriptor) -> bool {
    let has = |groups: &[Vec<crate::EffectPassDescriptor>]| {
        groups.iter().flatten().any(|pass| pass.shader == "canvas")
    };
    let mut pending = vec![frame.items.as_slice()];
    while let Some(items) = pending.pop() {
        for item in items {
            match item {
                FrameItemDescriptor::Layer(layer) => {
                    if has(&layer.effect_pass_groups) {
                        return true;
                    }
                }
                FrameItemDescriptor::Group(group) => {
                    if has(&group.effect_pass_groups) {
                        return true;
                    }
                    pending.push(&group.items);
                }
                FrameItemDescriptor::SceneTransition(transition) => {
                    for group in [&transition.outgoing, &transition.incoming] {
                        if has(&group.effect_pass_groups) {
                            return true;
                        }
                        pending.push(&group.items);
                    }
                }
                FrameItemDescriptor::Transition {
                    outgoing, incoming, ..
                } => {
                    if outgoing
                        .iter()
                        .chain(incoming)
                        .any(|layer| has(&layer.effect_pass_groups))
                    {
                        return true;
                    }
                }
                FrameItemDescriptor::SceneEffect { effect_pass_groups } => {
                    if has(effect_pass_groups) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn layer(
    value: &LayerDescriptor,
    lookup: &mut impl FnMut(&str) -> bool,
) -> Result<(), CompositorError> {
    let t = &value.transform;
    if ![
        t.center_x,
        t.center_y,
        t.width,
        t.height,
        t.rotation_degrees,
        value.opacity,
    ]
    .iter()
    .all(|v| v.is_finite())
        || t.width <= 0.0
        || t.height <= 0.0
        || !(0.0..=1.0).contains(&value.opacity)
    {
        return Err(invalid("Canvas layer transform/opacity metadata invalid"));
    }
    if !lookup(&value.texture_id) {
        return Err(CompositorError::MissingTexture {
            texture_id: value.texture_id.clone(),
        });
    }
    if let Some(mask) = &value.mask {
        if !mask.feather.is_finite() || mask.feather < 0.0 {
            return Err(invalid("Canvas mask feather metadata invalid"));
        }
        if !lookup(&mask.texture_id) {
            return Err(CompositorError::MissingTexture {
                texture_id: mask.texture_id.clone(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "canvas_graph_preflight_tests.rs"]
mod tests;
