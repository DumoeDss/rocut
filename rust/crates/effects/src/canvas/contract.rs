use super::{MAX_DURATION_TICKS, MAX_STROKES, STEP_TICKS};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasConfig {
    pub columns: u32,
    pub rows: u32,
    pub duration_ticks: u64,
    pub seed: u32,
    /// Wetness decay rate per second; zero means permanently wet paint.
    pub drying: f64,
    /// Symmetric wet-neighbour transport, normalized cells per second.
    pub diffusion: f64,
    pub weave_frequency: f64,
    pub weave_height: f64,
    pub light: [f64; 3],
    pub relief: f64,
}

/// One continuous linear path. Multiple segments/strokes stay in authored order.
/// Timestamp ties are legal. No inferred gestures, sorting or omitted slot defaults.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CanvasStroke {
    pub start_ticks: u64,
    pub end_ticks: u64,
    /// Coordinates in [0,1] across the source; off-source paths explicitly allowed.
    pub from: [f64; 2],
    pub to: [f64; 2],
    /// Radius measured against the shorter source side, independent of aspect ratio.
    pub radius: f64,
    pub bristles: u32,
    pub opacity: f64,
    pub wetness: f64,
    pub thickness: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanvasError(pub &'static str);
impl std::fmt::Display for CanvasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for CanvasError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayEstimate {
    /// Two cell array payloads (current/scratch), excluding Vec headers.
    pub state_and_scratch_bytes: u64,
    /// Owned exact premultiplied input snapshot payload, 32 bytes/cell.
    pub source_snapshot_bytes: u64,
    /// Core payloads plus state and scratch Vec headers, not a whole replay job.
    /// Use CanvasReplayJob::estimate for the owned schedule and all job headers.
    /// Caller input/output, allocator metadata and call stack are excluded.
    pub replay_peak_bytes: u64,
    /// Conservative full-duration cell/bristle visits; not hardware instruction count.
    pub work: u64,
    pub max_steps: u64,
}

pub(super) fn range(v: f64, lo: f64, hi: f64) -> bool {
    v.is_finite() && (lo..=hi).contains(&v)
}

/// Validate the whole schedule and budget before any replay allocation, even at t<0.
pub fn validate(
    config: &CanvasConfig,
    strokes: &[CanvasStroke],
) -> Result<ReplayEstimate, CanvasError> {
    if !(8..=128).contains(&config.columns)
        || !(8..=128).contains(&config.rows)
        || config.duration_ticks == 0
        || config.duration_ticks > MAX_DURATION_TICKS
        || config.seed > 16_777_215
        || strokes.len() > MAX_STROKES
    {
        return Err(CanvasError(
            "Canvas dimensions, duration, seed or stroke count out of range",
        ));
    }
    if !range(config.drying, 0.0, 20.0)
        || !range(config.diffusion, 0.0, 4.0)
        || !range(config.weave_frequency, 2.0, 128.0)
        || !range(config.weave_height, 0.0, 0.05)
        || !range(config.relief, 0.0, 8.0)
        || !config.light.iter().all(|v| range(*v, -1.0, 1.0))
        || config.light.iter().map(|v| v * v).sum::<f64>() < 0.01
    {
        return Err(CanvasError("Canvas coefficient or lighting invalid"));
    }
    let mut bristles = 0u64;
    for s in strokes {
        if s.start_ticks >= s.end_ticks
            || s.end_ticks > config.duration_ticks
            || !(2..=32).contains(&s.bristles)
            || !range(s.radius, 0.005, 0.25)
            || !range(s.opacity, 0.0, 1.0)
            || !range(s.wetness, 0.0, 1.0)
            || !range(s.thickness, 0.0, 0.1)
            || !s.from.iter().chain(&s.to).all(|v| range(*v, -1.0, 2.0))
        {
            return Err(CanvasError(
                "Canvas stroke requires complete finite path and bounded endpoint",
            ));
        }
        bristles += u64::from(s.bristles);
    }
    let cells = u64::from(config.columns)
        .checked_mul(u64::from(config.rows))
        .ok_or(CanvasError("Canvas cell count overflow"))?;
    // Exact stroke endpoints split anchored steps; allow one final residue.
    let steps = config
        .duration_ticks
        .div_ceil(STEP_TICKS)
        .checked_add((strokes.len() as u64) * 2 + 1)
        .ok_or(CanvasError("Canvas step count overflow"))?;
    let work = cells
        .checked_mul(steps)
        .and_then(|v| v.checked_mul(8 + bristles))
        .ok_or(CanvasError("Canvas replay work overflow"))?;
    if work > 80_000_000 {
        return Err(CanvasError(
            "Canvas replay exceeds 80000000 cell/bristle visit budget",
        ));
    }
    let bytes = cells
        .checked_mul(2 * 6 * 8)
        .ok_or(CanvasError("Canvas memory overflow"))?;
    let source_bytes = cells
        .checked_mul(4 * 8)
        .ok_or(CanvasError("Canvas source memory overflow"))?;
    let peak = bytes
        .checked_add(source_bytes)
        .and_then(|v| v.checked_add(std::mem::size_of::<super::CanvasState>() as u64))
        .and_then(|v| v.checked_add(std::mem::size_of::<Vec<super::CanvasCell>>() as u64))
        .ok_or(CanvasError("Canvas peak memory overflow"))?;
    Ok(ReplayEstimate {
        state_and_scratch_bytes: bytes,
        source_snapshot_bytes: source_bytes,
        replay_peak_bytes: peak,
        work,
        max_steps: steps,
    })
}
