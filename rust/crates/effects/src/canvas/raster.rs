//! Frozen full-resolution source bridge. RGBA8 is straight sRGB (not an sRGB
//! texture view); grid samples are bilinear, clamp-to-edge, linear premultiplied.
//! Grid center (x+.5,y+.5) maps to source ((x+.5)*width/columns,
//! (y+.5)*height/rows). Rectangular axes scale independently, no square crop.
//! Shader uses the inverse center convention for material textures. Grid-center
//! ridge/weave geometry agrees with core, apart from f32; output agreement also
//! requires the full-resolution source pixel to equal its sampled grid value.
//! Heterogeneous images do not generally satisfy that additional condition.
//! Between centers material/height is explicitly bilinear; this is not a claim
//! that the core's discrete shaded image is a full-resolution oracle.
use super::{CanvasConfig, CanvasError, CanvasState, validate};

pub const MAX_SOURCE_PIXELS: u64 = 16_777_216;
pub const MAX_SAMPLE_TAPS: u64 = 65_536;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasRasterUniforms {
    /// source width, height; grid columns, rows. Four 16-byte WGSL headers.
    pub geometry: [u32; 4],
    /// weave frequency, weave height, relief, zero padding.
    pub material: [f32; 4],
    /// normalized light xyz, zero padding.
    pub light: [f32; 4],
    /// exact seed, three reserved zeros.
    pub metadata: [u32; 4],
}

#[derive(Clone, Debug, PartialEq)]
pub struct CanvasRasterPayload {
    pub uniforms: CanvasRasterUniforms,
    /// RGBA32Float nonfilterable texture: linear premultiplied pigment, coverage.
    pub pigment_coverage: Vec<[f32; 4]>,
    /// RGBA32Float nonfilterable texture: height, wetness, zero, zero.
    pub height_wetness: Vec<[f32; 4]>,
}

pub(super) fn dimensions(width: u32, height: u32, bytes: usize) -> Result<(), CanvasError> {
    let count = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or(CanvasError("Canvas raster dimensions overflow"))?;
    let required = count
        .checked_mul(4)
        .ok_or(CanvasError("Canvas raster byte overflow"))?;
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || count > MAX_SOURCE_PIXELS
        || usize::try_from(required).ok() != Some(bytes)
    {
        return Err(CanvasError(
            "Canvas raster exact dimensions/byte budget invalid",
        ));
    }
    Ok(())
}

fn linear(value: u8) -> f64 {
    let v = f64::from(value) / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub fn sample_rgba8_grid(
    c: &CanvasConfig,
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<[f64; 4]>, CanvasError> {
    validate(c, &[])?;
    dimensions(width, height, rgba.len())?;
    let cells = u64::from(c.columns)
        .checked_mul(u64::from(c.rows))
        .ok_or(CanvasError("Canvas raster grid overflow"))?;
    if cells
        .checked_mul(4)
        .filter(|v| *v <= MAX_SAMPLE_TAPS)
        .is_none()
    {
        return Err(CanvasError("Canvas raster sampling work budget exceeded"));
    }
    let tap = |x: i64, y: i64| {
        let x = x.clamp(0, i64::from(width) - 1) as usize;
        let y = y.clamp(0, i64::from(height) - 1) as usize;
        let i = (y * width as usize + x) * 4;
        let a = f64::from(rgba[i + 3]) / 255.0;
        [
            linear(rgba[i]) * a,
            linear(rgba[i + 1]) * a,
            linear(rgba[i + 2]) * a,
            a,
        ]
    };
    let mut out = Vec::with_capacity(cells as usize);
    for y in 0..c.rows {
        for x in 0..c.columns {
            let sx = (f64::from(x) + 0.5) * f64::from(width) / f64::from(c.columns) - 0.5;
            let sy = (f64::from(y) + 0.5) * f64::from(height) / f64::from(c.rows) - 0.5;
            let ix = sx.floor() as i64;
            let iy = sy.floor() as i64;
            let fx = sx - sx.floor();
            let fy = sy - sy.floor();
            let taps = [
                tap(ix, iy),
                tap(ix + 1, iy),
                tap(ix, iy + 1),
                tap(ix + 1, iy + 1),
            ];
            let weights = [
                (1.0 - fx) * (1.0 - fy),
                fx * (1.0 - fy),
                (1.0 - fx) * fy,
                fx * fy,
            ];
            let mut p = [0.0; 4];
            for k in 0..4 {
                for t in 0..4 {
                    p[k] += taps[t][k] * weights[t];
                }
            }
            out.push(p);
        }
    }
    Ok(out)
}

fn checked_f32(value: f64, lo: f64, hi: f64) -> Result<f32, CanvasError> {
    let result = value as f32;
    if !value.is_finite() || !(lo..=hi).contains(&value) || !result.is_finite() {
        return Err(CanvasError("Canvas GPU payload finite range invalid"));
    }
    Ok(result)
}

/// Re-samples the supplied full image, then admits only its numerical grid-source
/// and config identity before material extraction. This does not prove exact
/// full-source-byte ownership or dynamic effect history; caller must bind those.
pub fn raster_payload(
    c: &CanvasConfig,
    state: &CanvasState,
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<CanvasRasterPayload, CanvasError> {
    let source = sample_rgba8_grid(c, rgba, width, height)?;
    // Actual core admission checks the state's owned numerical source and config.
    super::simulation::validate_state_source(c, state, &source)?;
    let mut pigment_coverage = Vec::with_capacity(source.len());
    let mut height_wetness = Vec::with_capacity(source.len());
    for cell in state.cells() {
        pigment_coverage.push([
            checked_f32(cell.pigment[0], 0.0, cell.coverage)?,
            checked_f32(cell.pigment[1], 0.0, cell.coverage)?,
            checked_f32(cell.pigment[2], 0.0, cell.coverage)?,
            checked_f32(cell.coverage, 0.0, 1.0)?,
        ]);
        height_wetness.push([
            checked_f32(cell.height, 0.0, 1.0)?,
            checked_f32(cell.wetness, 0.0, 1.0)?,
            0.0,
            0.0,
        ]);
    }
    let ln = c.light.iter().map(|v| v * v).sum::<f64>().sqrt();
    Ok(CanvasRasterPayload {
        uniforms: CanvasRasterUniforms {
            geometry: [width, height, c.columns, c.rows],
            material: [
                checked_f32(c.weave_frequency, 2.0, 128.0)?,
                checked_f32(c.weave_height, 0.0, 0.05)?,
                checked_f32(c.relief, 0.0, 8.0)?,
                0.0,
            ],
            light: [
                checked_f32(c.light[0] / ln, -1.0, 1.0)?,
                checked_f32(c.light[1] / ln, -1.0, 1.0)?,
                checked_f32(c.light[2] / ln, -1.0, 1.0)?,
                0.0,
            ],
            metadata: [c.seed, 0, 0, 0],
        },
        pigment_coverage,
        height_wetness,
    })
}

#[cfg(test)]
#[path = "raster_tests.rs"]
mod tests;
