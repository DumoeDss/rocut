use super::{
    CanvasCell, CanvasConfig, CanvasError, CanvasState, CanvasStroke, STEP_TICKS, frame_floor,
    validate,
};
use std::num::NonZeroU64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanvasReplayProgress {
    pub completed_ticks: u64,
    pub target_ticks: u64,
    pub executed_steps: u64,
}
impl CanvasReplayProgress {
    pub fn is_complete(self) -> bool {
        self.completed_ticks == self.target_ticks
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CanvasReplayEstimate {
    /// Current/scratch/source payloads, owned schedule and all job/Vec headers.
    /// Caller source, allocator metadata, output and stack are excluded.
    pub peak_bytes: u64,
    pub step_work: u64,
    pub full_duration_work: u64,
    pub max_steps: u64,
}

/// Owned pending request. Drop cancels unpublished work; no partial state getter.
/// Upper layers may yield/cancel between budgeted calls. A physical step is indivisible.
#[derive(Debug)]
pub struct CanvasReplayJob {
    state: CanvasState,
    scratch: Vec<CanvasCell>,
    strokes: Vec<CanvasStroke>,
    cursor: u64,
    target: u64,
    steps: u64,
    estimate: CanvasReplayEstimate,
}
impl CanvasReplayJob {
    pub fn estimate(
        c: &CanvasConfig,
        strokes: &[CanvasStroke],
    ) -> Result<CanvasReplayEstimate, CanvasError> {
        let admitted = validate(c, strokes)?;
        let cells = u64::from(c.columns)
            .checked_mul(u64::from(c.rows))
            .ok_or(CanvasError("Canvas replay cells overflow"))?;
        let stroke_bytes = (strokes.len() as u64)
            .checked_mul(std::mem::size_of::<CanvasStroke>() as u64)
            .ok_or(CanvasError("Canvas replay schedule memory overflow"))?;
        let peak_bytes = cells
            .checked_mul(128)
            .and_then(|v| v.checked_add(stroke_bytes))
            .and_then(|v| v.checked_add(std::mem::size_of::<Self>() as u64))
            .ok_or(CanvasError("Canvas replay job memory overflow"))?;
        let bristles = strokes.iter().map(|s| u64::from(s.bristles)).sum::<u64>();
        let step_work = cells
            .checked_mul(8 + bristles)
            .ok_or(CanvasError("Canvas replay step work overflow"))?;
        Ok(CanvasReplayEstimate {
            peak_bytes,
            step_work,
            full_duration_work: admitted.work,
            max_steps: admitted.max_steps,
        })
    }
    pub fn new(
        c: &CanvasConfig,
        strokes: &[CanvasStroke],
        source: &[[f64; 4]],
        local_ticks: i64,
        numerator: u32,
        denominator: u32,
    ) -> Result<Self, CanvasError> {
        let estimate = Self::estimate(c, strokes)?;
        super::simulation::source_valid(c, source)?;
        let sampled = frame_floor(local_ticks, numerator, denominator)?;
        // Every rejection above precedes source/schedule/material allocation.
        Ok(Self {
            state: CanvasState::initialize_admitted(c, source, sampled),
            scratch: vec![CanvasCell::default(); source.len()],
            strokes: strokes.to_vec(),
            cursor: 0,
            target: sampled.max(0).min(c.duration_ticks as i64) as u64,
            steps: 0,
            estimate,
        })
    }
    pub fn progress(&self) -> CanvasReplayProgress {
        CanvasReplayProgress {
            completed_ticks: self.cursor,
            target_ticks: self.target,
            executed_steps: self.steps,
        }
    }
    pub fn minimum_step_work(&self) -> NonZeroU64 {
        NonZeroU64::new(self.estimate.step_work).expect("admitted nonempty grid")
    }
    pub fn memory_bytes(&self) -> Option<u64> {
        self.state
            .owned_payload_bytes()?
            .checked_add(
                (self.scratch.capacity() as u64)
                    .checked_mul(std::mem::size_of::<CanvasCell>() as u64)?,
            )?
            .checked_add(
                (self.strokes.capacity() as u64)
                    .checked_mul(std::mem::size_of::<CanvasStroke>() as u64)?,
            )?
            .checked_add(std::mem::size_of::<Self>() as u64)
    }
    /// Budget is conservative cell/bristle visits, not milliseconds or instructions.
    /// A too-small quota is rejected without mutation; zero cannot inhabit the API.
    pub fn advance(
        &mut self,
        work_budget: NonZeroU64,
    ) -> Result<CanvasReplayProgress, CanvasError> {
        if work_budget.get() < self.estimate.step_work {
            return Err(CanvasError(
                "Canvas replay quota is smaller than one admitted step",
            ));
        }
        let count = work_budget.get() / self.estimate.step_work;
        for _ in 0..count {
            if self.cursor == self.target {
                break;
            }
            let mut next = ((self.cursor / STEP_TICKS + 1) * STEP_TICKS).min(self.target);
            for s in &self.strokes {
                for boundary in [s.start_ticks, s.end_ticks] {
                    if boundary > self.cursor && boundary < next {
                        next = boundary;
                    }
                }
            }
            self.state
                .advance_admitted(&self.strokes, self.cursor, next, &mut self.scratch);
            self.cursor = next;
            self.steps += 1;
        }
        Ok(self.progress())
    }
    pub fn finish(self) -> Result<CanvasState, CanvasError> {
        if self.cursor != self.target {
            return Err(CanvasError("Canvas replay job is incomplete"));
        }
        Ok(self.state)
    }
}
