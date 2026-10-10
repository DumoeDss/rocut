use crate::{EffectPass, EffectsError};

/// Checks input allocation limits before a caller imports its source texture.
/// Bubble and Frost reuse their uniform/work admission; other pass validation
/// still belongs to the pipeline and is not made atomic by this check.
pub fn validate_effects_input(
    width: u32,
    height: u32,
    maximum: u32,
    passes: &[EffectPass],
) -> Result<(), EffectsError> {
    if width == 0 || height == 0 || width > maximum || height > maximum {
        return Err(EffectsError::InvalidInputDimensions {
            width,
            height,
            maximum,
        });
    }
    if passes.is_empty() {
        return Err(EffectsError::MissingEffectPasses);
    }
    for pass in passes {
        if pass.shader == "canvas" {
            crate::decode_canvas_pass(pass).map_err(|error| EffectsError::CanvasPreparation {
                message: error.to_string(),
            })?;
        }
        if pass.shader == "bubble" {
            crate::bubble::pack_uniforms(pass, width, height)?;
        }
        if pass.shader == "frost" {
            crate::frost::pack_uniforms(pass, width, height)?;
        }
    }
    Ok(())
}
