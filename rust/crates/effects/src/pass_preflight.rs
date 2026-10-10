use crate::{EffectPass, EffectsError};

/// CPU-only validation of the same pass decoder/packer used by GPU execution.
/// This admits parameters, not a GPU device, texture or captured input identity.
pub fn validate_effect_pass(pass: &EffectPass, dimensions: [u32; 2]) -> Result<(), EffectsError> {
    match pass.shader.as_str() {
        "flame_wrap" => {
            crate::flame_wrap::pack_uniforms(pass, dimensions[0], dimensions[1]).map(|_| ())
        }
        "canvas" => crate::decode_canvas_pass(pass)
            .map(|_| ())
            .map_err(|error| EffectsError::CanvasPreparation {
                message: error.to_string(),
            }),
        "liquid" => crate::LiquidPreparation::memory_budget(pass).map(|_| ()),
        _ => crate::pipeline::pack_effect_uniforms(pass, dimensions[0], dimensions[1]).map(|_| ()),
    }
}
