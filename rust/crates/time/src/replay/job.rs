use super::*;
use std::num::NonZeroU64;

/// Public progress never grants access to uncommitted simulation state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayProgress {
    /// Absolute source step, including any admitted checkpoint prefix.
    pub completed_steps: u64,
    /// Floor of target_ticks / step_ticks, fixed for the request.
    pub target_steps: u64,
    /// Cumulative steps since admission, NOT the delta of the latest chunk.
    pub executed_steps: u64,
}

impl ReplayProgress {
    pub fn is_complete(self) -> bool {
        self.completed_steps == self.target_steps
    }
}

/// One admitted request, with private pending state and no cross-request cache.
/// Dropping it discards all unpublished work. Chunk quotas count physical
/// steps, not milliseconds: a model's single advance remains indivisible.
#[derive(Debug)]
pub struct ReplayJob<M: ReplayModel> {
    model: M,
    state: Option<M::State>,
    position: ReplayPosition,
    cost: ReplayCost,
    start: u64,
    completed: u64,
    identity_bound: u64,
}

impl<M: ReplayModel> ReplayJob<M> {
    pub fn new(
        model: M,
        target_ticks: u64,
        budget: ReplayBudget,
        checkpoint: Option<&Checkpoint<M::Parameters, M::State>>,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<Self, ReplayError<M::Error>> {
        let (position, cost, start, identity_bound) =
            admit(&model, target_ticks, budget, checkpoint)?;
        if cancelled() {
            return Err(ReplayError::Cancelled);
        }
        let state = match checkpoint {
            Some(saved) => {
                validate(&model, &saved.state, cost, start)?;
                // The only checkpoint-state clone during this entire request.
                saved.state.clone()
            }
            None => model.initialize().map_err(ReplayError::Model)?,
        };
        validate(&model, &state, cost, start)?;
        if cancelled() {
            return Err(ReplayError::Cancelled);
        }
        Ok(Self {
            model,
            state: Some(state),
            position,
            cost,
            start,
            completed: start,
            identity_bound,
        })
    }

    pub fn progress(&self) -> ReplayProgress {
        ReplayProgress {
            completed_steps: self.completed,
            target_steps: self.position.completed_steps,
            executed_steps: self.completed - self.start,
        }
    }

    /// Executes at most the quota and returns cumulative request progress.
    pub fn advance(
        &mut self,
        max_steps: NonZeroU64,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<ReplayProgress, ReplayError<M::Error>> {
        // Taking ownership first makes every error (also unwinding) terminal:
        // no candidate can be resumed or published after a failed chunk.
        let mut state = self.state.take().ok_or(ReplayError::JobTerminated)?;
        let count = max_steps
            .get()
            .min(self.position.completed_steps - self.completed);
        for _ in 0..count {
            if cancelled() {
                return Err(ReplayError::Cancelled);
            }
            let index = self.completed;
            // All operations are bounded by the admitted integer target.
            let step = ReplayStep {
                index,
                start_ticks: index * self.position.step_ticks,
                end_ticks: (index + 1) * self.position.step_ticks,
            };
            self.model
                .advance(&mut state, step)
                .map_err(ReplayError::Model)?;
            validate(&self.model, &state, self.cost, index + 1)?;
            self.completed += 1;
        }
        if cancelled() {
            return Err(ReplayError::Cancelled);
        }
        self.state = Some(state);
        Ok(self.progress())
    }

    pub fn finish(
        self,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<ReplayOutput<M::Parameters, M::State>, ReplayError<M::Error>> {
        let Self {
            model,
            state,
            position,
            cost,
            start,
            completed,
            identity_bound,
        } = self;
        let state = state.ok_or(ReplayError::JobTerminated)?;
        if cancelled() {
            return Err(ReplayError::Cancelled);
        }
        if completed != position.completed_steps {
            return Err(ReplayError::Incomplete);
        }
        let identity = model.identity().clone();
        if identity_bytes(&identity).ok_or(ReplayError::ArithmeticOverflow)? > identity_bound {
            return Err(ReplayError::MemoryLimit);
        }
        if cancelled() {
            return Err(ReplayError::Cancelled);
        }
        Ok(ReplayOutput {
            checkpoint: Checkpoint {
                identity,
                cost,
                completed_steps: completed,
                state,
            },
            position,
            executed_steps: completed - start,
        })
    }
}

// The synchronous API borrows its model; owned async jobs use the same engine.
impl<M: ReplayModel + ?Sized> ReplayModel for &M {
    type Parameters = M::Parameters;
    type State = M::State;
    type Error = M::Error;

    fn identity(&self) -> &ReplayIdentity<Self::Parameters> {
        M::identity(self)
    }
    fn cost(&self) -> ReplayCost {
        M::cost(self)
    }
    fn request_inline_bytes(&self) -> u64 {
        // The model belongs to the caller, not this borrowed request adapter.
        // Its actual identity is independently charged by memory_bytes.
        0
    }
    fn initialize(&self) -> Result<Self::State, Self::Error> {
        M::initialize(self)
    }
    fn advance(&self, state: &mut Self::State, step: ReplayStep) -> Result<(), Self::Error> {
        M::advance(self, state, step)
    }
    fn validate_state(&self, state: &Self::State, completed_steps: u64) -> Option<u64> {
        M::validate_state(self, state, completed_steps)
    }
}
