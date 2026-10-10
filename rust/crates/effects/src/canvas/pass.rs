use super::{CanvasConfig, CanvasError, CanvasStroke};
use crate::{EffectPass, UniformValue};
use std::collections::BTreeMap;

/// Fully admitted f64 material input, not a source snapshot or playback cache.
#[derive(Clone, Debug)]
pub struct CanvasPass {
    config: CanvasConfig,
    strokes: Vec<CanvasStroke>,
    parameters: BTreeMap<String, f64>,
    sampled_ticks: i64,
}
impl CanvasPass {
    pub fn config(&self) -> &CanvasConfig {
        &self.config
    }
    pub fn strokes(&self) -> &[CanvasStroke] {
        &self.strokes
    }
    pub fn parameters(&self) -> &BTreeMap<String, f64> {
        &self.parameters
    }
    pub fn sampled_ticks(&self) -> i64 {
        self.sampled_ticks
    }
}

/// IEEE754 bits, four little-significance-first unsigned 16-bit words.
/// Every word is exactly representable in the shared f32 Vector transport.
pub(super) fn encode(value: f64) -> [f32; 4] {
    let bits = value.to_bits();
    std::array::from_fn(|index| ((bits >> (index * 16)) & 65535) as f32)
}
fn decode(value: &UniformValue) -> Result<f64, CanvasError> {
    let UniformValue::Vector(words) = value else {
        return Err(CanvasError(
            "Canvas pass requires four-word f64 vectors, not scalar uniforms",
        ));
    };
    if words.len() != 4 {
        return Err(CanvasError(
            "Canvas f64 vector must have exactly four words",
        ));
    }
    let mut bits = 0u64;
    for (index, word) in words.iter().copied().enumerate() {
        if !word.is_finite() || word.is_sign_negative() || word > 65535.0 || word.fract() != 0.0 {
            return Err(CanvasError(
                "Canvas f64 words must be finite unsigned 16-bit integers",
            ));
        }
        bits |= (word as u64) << (index * 16);
    }
    let value = f64::from_bits(bits);
    if !value.is_finite() {
        return Err(CanvasError("Canvas decoded numeric fields must be finite"));
    }
    Ok(value)
}

pub fn decode_pass(pass: &EffectPass) -> Result<CanvasPass, CanvasError> {
    if pass.shader != "canvas" {
        return Err(CanvasError("Canvas pass shader must be canvas"));
    }
    if pass.uniforms.len() > 191 {
        return Err(CanvasError("Canvas pass field budget exceeded"));
    }
    let fields = super::definition().fields;
    for key in pass.uniforms.keys() {
        if key != "sampledTicks" && !fields.iter().any(|field| field.key == key) {
            return Err(CanvasError("Unknown Canvas pass field"));
        }
    }
    let sampled = decode(
        pass.uniforms
            .get("sampledTicks")
            .ok_or(CanvasError("Canvas pass requires sampledTicks"))?,
    )?;
    if sampled.is_sign_negative() || sampled > 9_007_199_254_740_991.0 || sampled.fract() != 0.0 {
        return Err(CanvasError(
            "Canvas sampledTicks must be nonnegative safe integer ticks",
        ));
    }
    let parameters = pass
        .uniforms
        .iter()
        .filter(|(key, _)| key.as_str() != "sampledTicks")
        .map(|(key, value)| decode(value).map(|value| (key.clone(), value)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let (config, strokes) = super::parse(&parameters)?;
    Ok(CanvasPass {
        config,
        strokes,
        parameters,
        sampled_ticks: sampled as i64,
    })
}
