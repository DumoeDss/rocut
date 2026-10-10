use super::super::plan::BlitRaster;

/// Conservative filter-stage backing/copy allowance. A contrast pass stays
/// charged alongside blur; adding a chain must not reuse blur-only admission.
pub(super) fn cost(raster: &BlitRaster, rect: &[f64; 4]) -> Result<u64, String> {
    if !raster.blur_px.is_finite()
        || !(0.0..=16.0).contains(&raster.blur_px)
        || raster
            .contrast
            .is_some_and(|v| !v.is_finite() || !(0.0..=32.0).contains(&v))
        || !["low", "medium", "high"].contains(&raster.smoothing_quality)
        || rect.iter().any(|v| !v.is_finite())
    {
        return Err("Invalid explicit blit raster settings".into());
    }
    let stages = u64::from(raster.blur_px != 0.0) + u64::from(raster.contrast.is_some());
    if stages == 0 {
        return Ok(0);
    }
    let pad = (6.0 * raster.blur_px).ceil();
    let width = rect[2].abs().ceil() + pad;
    let height = rect[3].abs().ceil() + pad;
    if width > 8192.0 || height > 8192.0 {
        return Err("Filtered blit exceeds bounded scratch dimensions".into());
    }
    Ok(2 * stages * width as u64 * height as u64)
}
