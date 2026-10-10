//! Pure CPU admission. No resource-content identity proof.
use super::super::raster::{CanvasRasterPayload, MAX_SOURCE_PIXELS};
use super::PackedUniforms;
use crate::EffectsError;
pub(super) fn invalid(message: &str) -> EffectsError {
    EffectsError::CanvasPreparation {
        message: message.into(),
    }
}
pub(super) fn supported(format: wgpu::TextureFormat) -> bool {
    // textureLoad returns logical RGBA for BGRA storage. Do not swizzle again.
    matches!(
        format,
        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm
    )
}
/// CPU admission, before creating any buffer/texture/view/bind group or queue write.
pub(super) fn payload_layout(
    width: u32,
    height: u32,
    p: &CanvasRasterPayload,
    max_dimension: u32,
) -> Result<(u32, u32, u32), EffectsError> {
    let [w, h, nx, ny] = p.uniforms.geometry;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| invalid("source dimensions overflow"))?;
    let bytes = pixels
        .checked_mul(4)
        .ok_or_else(|| invalid("source byte count overflow"))?;
    if width == 0
        || height == 0
        || w != width
        || h != height
        || width > 16384
        || height > 16384
        || width > max_dimension
        || height > max_dimension
        || pixels > MAX_SOURCE_PIXELS
        || usize::try_from(bytes).is_err()
        || !(8..=128).contains(&nx)
        || !(8..=128).contains(&ny)
        || nx > max_dimension
        || ny > max_dimension
        || std::mem::size_of::<PackedUniforms>() != 64
        || std::mem::size_of_val(&p.uniforms) != 64
    {
        return Err(invalid("source/grid/uniform dimensions or budget mismatch"));
    }
    let count = u64::from(nx)
        .checked_mul(u64::from(ny))
        .ok_or_else(|| invalid("grid count overflow"))?;
    let row = nx
        .checked_mul(16)
        .ok_or_else(|| invalid("grid row overflow"))?;
    let total = u64::from(row)
        .checked_mul(u64::from(ny))
        .ok_or_else(|| invalid("grid bytes overflow"))?;
    if usize::try_from(count).ok() != Some(p.pigment_coverage.len())
        || p.height_wetness.len() != p.pigment_coverage.len()
        || u64::try_from(bytemuck::cast_slice::<[f32; 4], u8>(&p.pigment_coverage).len()).ok()
            != Some(total)
        || u64::try_from(bytemuck::cast_slice::<[f32; 4], u8>(&p.height_wetness).len()).ok()
            != Some(total)
    {
        return Err(invalid("exact grid payload byte counts mismatch"));
    }
    let m = p.uniforms.material;
    let l = p.uniforms.light;
    let seed = p.uniforms.metadata;
    let range = |v: f32, lo: f32, hi: f32| v.is_finite() && (lo..=hi).contains(&v);
    let norm = l[..3].iter().map(|v| v * v).sum::<f32>();
    if !range(m[0], 2.0, 128.0)
        || !range(m[1], 0.0, 0.05)
        || !range(m[2], 0.0, 8.0)
        || m[3] != 0.0
        || !l[..3].iter().all(|v| range(*v, -1.0, 1.0))
        || l[3] != 0.0
        || !norm.is_finite()
        || (norm - 1.0).abs() > 1e-5
        || seed[0] > 16_777_215
        || seed[1..] != [0, 0, 0]
    {
        return Err(invalid("material/light/seed uniform finite range invalid"));
    }
    for (pigment, height) in p.pigment_coverage.iter().zip(&p.height_wetness) {
        if !range(pigment[3], 0.0, 1.0)
            || !pigment[..3].iter().all(|v| range(*v, 0.0, pigment[3]))
            || !range(height[0], 0.0, 1.0)
            || !range(height[1], 0.0, 1.0)
            || height[2] != 0.0
            || height[3] != 0.0
        {
            return Err(invalid("material texture finite range invalid"));
        }
    }
    Ok((nx, ny, row))
}

#[cfg(test)]
#[path = "gpu_admission_tests.rs"]
mod tests;
