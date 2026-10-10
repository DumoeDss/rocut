use crate::{FrameDescriptor, frame::EffectUniformValueDescriptor};
use effects::{CanvasPreparation, EffectsError};

fn error(message: &str) -> EffectsError {
    EffectsError::CanvasPreparation {
        message: message.into(),
    }
}

/// Admit every pass before the first source capture. Frames without Canvas keep
/// their historical preparation policy; device/texture identity is checked later.
pub(crate) fn validate(frame: &FrameDescriptor, base_bytes: u64) -> Result<(), EffectsError> {
    let mut contains_canvas = false;
    crate::effect_positions::visit_passes(frame, |_, pass| {
        contains_canvas |= pass.shader == "canvas";
    });
    if !contains_canvas {
        return Ok(());
    }
    let mut aggregate = crate::canvas_capture_budget::CanvasFrameCaptureBudget::new(base_bytes)
        .map_err(|value| error(&value.to_string()))?;
    let mut result = Ok(());
    crate::effect_positions::visit_groups(frame, |_, groups| {
        if groups.iter().any(Vec::is_empty) {
            result = Err(EffectsError::MissingEffectPasses);
        }
    });
    let capacity = u64::from(frame.width)
        .checked_mul(u64::from(frame.height))
        .and_then(|bytes| bytes.checked_mul(4))
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| error("Canvas frame source byte overflow"))?;
    let mut ordinal = 0usize;
    crate::effect_positions::visit_passes(frame, |_, descriptor| {
        let current = ordinal;
        ordinal += 1;
        if result.is_err() {
            return;
        }
        if descriptor.shader.len() > 128
            || descriptor.uniforms.len() > 512
            || descriptor.uniforms.iter().any(|(key, value)| {
                key.len() > 128
                    || matches!(value, EffectUniformValueDescriptor::Vector(values)
                        if values.len() > 112)
            })
        {
            result = Err(error("Canvas frame pass transport budget exceeded"));
            return;
        }
        let pass = crate::compositor::map_effect_passes(std::slice::from_ref(descriptor)).remove(0);
        result = if pass.shader == "canvas" {
            CanvasPreparation::estimate(&pass, [frame.width, frame.height], capacity)
                .map_err(|value| error(&value.to_string()))
                .and_then(|budget| {
                    aggregate
                        .add(current, [frame.width, frame.height], &budget)
                        .map(|_| ())
                        .map_err(|value| error(&value.to_string()))
                })
        } else {
            effects::validate_effect_pass(&pass, [frame.width, frame.height])
        };
    });
    result
}
