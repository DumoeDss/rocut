use crate::{EffectPassDescriptor, frame::EffectUniformValueDescriptor};

/// Bound the raw descriptor before cloning its transport into the effects crate.
/// Full schema, bit-word and schedule admission still belongs to Canvas decode.
pub(crate) fn validate(descriptor: &EffectPassDescriptor) -> Result<(), effects::EffectsError> {
    if descriptor.uniforms.len() > 191
        || descriptor.uniforms.keys().any(|key| key.len() > 128)
        || descriptor.uniforms.values().any(|value| {
            !matches!(value, EffectUniformValueDescriptor::Vector(words) if words.len() == 4)
        })
    {
        return Err(effects::EffectsError::CanvasPreparation {
            message: "Canvas descriptor requires bounded four-word transport".into(),
        });
    }
    Ok(())
}
