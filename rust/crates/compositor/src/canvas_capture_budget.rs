//! Native-only aggregation of real per-position Canvas preparation estimates.
//! No JS wire budget or parameter deduplication; this is not GPU RSS accounting.
use effects::{CanvasPreparationBudget, MAX_CANVAS_PREPARATION_BYTES, MAX_CANVAS_PREPARATION_WORK};

pub(crate) const MAX_CANVAS_FRAME_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_CANVAS_FRAME_WORK: u64 = 328_000_000;
pub(crate) const MAX_CANVAS_FRAME_POSITIONS: usize = 64;
pub(crate) const MAX_CANVAS_STAGING_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CanvasCaptureBudgetError(pub &'static str);
impl std::fmt::Display for CanvasCaptureBudgetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for CanvasCaptureBudgetError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CanvasCaptureLayout {
    pub position: usize,
    pub dimensions: [u32; 2],
    pub tight_row: u32,
    pub padded_row: u32,
    pub tight_bytes: u64,
    pub padded_bytes: u64,
    /// Four tight targets/copies plus two padded readback/mapped charges.
    /// Intentionally conservative, including overlap that may not coexist.
    pub capture_charge: u64,
}
pub(crate) fn capture_layout(
    position: usize,
    dimensions: [u32; 2],
) -> Result<CanvasCaptureLayout, CanvasCaptureBudgetError> {
    let [width, height] = dimensions;
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err(CanvasCaptureBudgetError(
            "Canvas capture dimensions outside source bounds",
        ));
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or(CanvasCaptureBudgetError("Canvas capture pixel overflow"))?;
    if pixels > 16_777_216 {
        return Err(CanvasCaptureBudgetError(
            "Canvas capture source pixel budget exceeded",
        ));
    }
    let tight_row = width
        .checked_mul(4)
        .ok_or(CanvasCaptureBudgetError("Canvas capture row overflow"))?;
    let padded_row = tight_row
        .checked_add(255)
        .map(|row| row / 256 * 256)
        .ok_or(CanvasCaptureBudgetError(
            "Canvas capture padded row overflow",
        ))?;
    let tight_bytes = u64::from(tight_row)
        .checked_mul(u64::from(height))
        .ok_or(CanvasCaptureBudgetError("Canvas capture byte overflow"))?;
    let padded_bytes =
        u64::from(padded_row)
            .checked_mul(u64::from(height))
            .ok_or(CanvasCaptureBudgetError(
                "Canvas padded capture byte overflow",
            ))?;
    if padded_bytes > MAX_CANVAS_STAGING_BYTES {
        return Err(CanvasCaptureBudgetError(
            "Canvas padded readback staging exceeds 64 MiB",
        ));
    }
    let capture_charge = tight_bytes
        .checked_mul(4)
        .and_then(|v| v.checked_add(padded_bytes.checked_mul(2)?))
        .ok_or(CanvasCaptureBudgetError("Canvas capture peak overflow"))?;
    Ok(CanvasCaptureLayout {
        position,
        dimensions,
        tight_row,
        padded_row,
        tight_bytes,
        padded_bytes,
        capture_charge,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CanvasFrameCaptureTotals {
    pub positions: usize,
    pub preparation_peak_bytes: u64,
    pub capture_peak_bytes: u64,
    pub frame_peak_bytes: u64,
    pub work: u64,
}

/// Caller must feed every actual pass position, inactive branches included, with
/// the native CanvasPreparation::estimate result. Public budget fields are NOT
/// an unforgeable token: no deserialized/JS-provided estimate belongs here.
pub(crate) struct CanvasFrameCaptureBudget {
    totals: CanvasFrameCaptureTotals,
    positions: Vec<CanvasCaptureLayout>,
}
impl CanvasFrameCaptureBudget {
    pub fn new(frame_owned_bytes: u64) -> Result<Self, CanvasCaptureBudgetError> {
        let metadata = std::mem::size_of::<Self>() as u64
            + (MAX_CANVAS_FRAME_POSITIONS * std::mem::size_of::<CanvasCaptureLayout>()) as u64;
        let initial = checked_sum(frame_owned_bytes, metadata)?;
        if initial > MAX_CANVAS_FRAME_BYTES {
            return Err(CanvasCaptureBudgetError(
                "Canvas frame base memory budget exceeded",
            ));
        }
        Ok(Self {
            totals: CanvasFrameCaptureTotals {
                positions: 0,
                preparation_peak_bytes: 0,
                capture_peak_bytes: 0,
                frame_peak_bytes: initial,
                work: 0,
            },
            positions: Vec::with_capacity(MAX_CANVAS_FRAME_POSITIONS),
        })
    }
    pub fn totals(&self) -> CanvasFrameCaptureTotals {
        self.totals
    }
    pub fn positions(&self) -> &[CanvasCaptureLayout] {
        &self.positions
    }
    /// Transactional checked sum. Even equal params or duplicate ordinals charge
    /// separately and retain their authored encounter order; never deduplicated.
    pub fn add(
        &mut self,
        position: usize,
        dimensions: [u32; 2],
        budget: &CanvasPreparationBudget,
    ) -> Result<CanvasCaptureLayout, CanvasCaptureBudgetError> {
        let layout = capture_layout(position, dimensions)?;
        let minimum = checked_sum(budget.captured_capacity_bytes, budget.retained_pass_bytes)?;
        let minimum = checked_sum(minimum, budget.replay_peak_bytes)?;
        if budget.peak_bytes > MAX_CANVAS_PREPARATION_BYTES
            || budget.work == 0
            || budget.work > MAX_CANVAS_PREPARATION_WORK
            || budget.captured_capacity_bytes < layout.tight_bytes
            || minimum > budget.peak_bytes
        {
            return Err(CanvasCaptureBudgetError(
                "Canvas aggregate requires an admitted native per-pass estimate",
            ));
        }
        let positions = self
            .totals
            .positions
            .checked_add(1)
            .ok_or(CanvasCaptureBudgetError("Canvas position count overflow"))?;
        let preparation_peak_bytes =
            checked_sum(self.totals.preparation_peak_bytes, budget.peak_bytes)?;
        let capture_peak_bytes =
            checked_sum(self.totals.capture_peak_bytes, layout.capture_charge)?;
        let frame_peak_bytes = checked_sum(
            checked_sum(self.totals.frame_peak_bytes, budget.peak_bytes)?,
            layout.capture_charge,
        )?;
        let work = checked_sum(self.totals.work, budget.work)?;
        if positions > MAX_CANVAS_FRAME_POSITIONS
            || frame_peak_bytes > MAX_CANVAS_FRAME_BYTES
            || work > MAX_CANVAS_FRAME_WORK
        {
            return Err(CanvasCaptureBudgetError(
                "Canvas whole-frame aggregate budget exceeded",
            ));
        }
        // Header and maximum 64-position storage are already charged in new().
        self.positions.push(layout);
        self.totals = CanvasFrameCaptureTotals {
            positions,
            preparation_peak_bytes,
            capture_peak_bytes,
            frame_peak_bytes,
            work,
        };
        Ok(layout)
    }
}
fn checked_sum(a: u64, b: u64) -> Result<u64, CanvasCaptureBudgetError> {
    a.checked_add(b).ok_or(CanvasCaptureBudgetError(
        "Canvas aggregate arithmetic overflow",
    ))
}

#[cfg(test)]
#[path = "canvas_capture_budget_tests.rs"]
mod tests;
