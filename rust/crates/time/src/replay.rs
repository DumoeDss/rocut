//! Bounded, request-local replay on the source clock (120,000 ticks/second).
//! Models own simulation policy; this module owns admission and step ordering.

#[path = "replay/job.rs"]
mod job;
pub use job::{ReplayJob, ReplayProgress};

pub const TICKS_PER_SECOND: u64 = 120_000;

/// Owned canonical parameters. Measure all heap capacity without allocation,
/// using checked arithmetic. Clone must allocate no more than this measured
/// bound and produce independent ownership, without shared mutable storage.
pub trait ReplayParameters: Clone + Eq {
    fn heap_bytes(&self) -> Option<u64>;
}

impl ReplayParameters for Vec<u8> {
    fn heap_bytes(&self) -> Option<u64> {
        u64::try_from(self.capacity()).ok()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceIdentity {
    pub id: String,
    pub sha256: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StepRule {
    pub ticks_per_step: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplayIdentity<P> {
    pub engine: &'static str,
    pub version: u32,
    pub seed: u64,
    /// Complete canonical parameters, including all explicit events. Validated
    /// float parameters can use their bits or canonical bytes; omit no field
    /// affecting the state, its interpretation, or its initial conditions.
    pub parameters: P,
    /// Strictly increasing resource IDs, each bound to the verified bytes.
    pub resources: Vec<ResourceIdentity>,
    pub dimensions: [u32; 2],
    pub step: StepRule,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayCost {
    /// Upper bound including the state's inline storage and all owned heaps.
    pub state_bytes: u64,
    /// Non-identity model heaps owned by the request plus peak temporary
    /// storage required by init, clone, validation, or advance.
    pub scratch_bytes: u64,
    /// Bound for initialization plus validation, or checkpoint validation plus
    /// clone plus validation; also includes final identity copy/publication.
    pub init_work: u64,
    /// Bound for one advance and the subsequent state validation.
    pub step_work: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct ReplayBudget {
    pub max_steps: u64,
    pub max_work: u64,
    /// Logical live bytes: model identity, borrowed checkpoint, output
    /// identity/state/metadata (or the private pending job), and scratch. Includes owned heap capacities,
    /// but not allocator headers or compiler-generated call-stack temporaries.
    pub max_state_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayPosition {
    pub completed_steps: u64,
    pub remainder_ticks: u64,
    pub step_ticks: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayStep {
    /// Zero-based index; models can consume explicit events in a stable order.
    pub index: u64,
    pub start_ticks: u64,
    pub end_ticks: u64,
}

/// Internal deterministic model: identity/cost stay fixed during a request;
/// callbacks use only identity, input state, and the supplied integer step.
pub trait ReplayModel {
    type Parameters: ReplayParameters;
    /// Clone must produce an independent value, without shared mutable storage.
    type State: Clone;
    type Error;

    fn identity(&self) -> &ReplayIdentity<Self::Parameters>;
    fn cost(&self) -> ReplayCost;
    /// Internal ownership accounting: an owned request model charges all of
    /// its inline storage, conservatively including any inline identity again.
    /// Non-identity owned heaps must additionally be covered by scratch_bytes.
    /// The &M adapter returns zero for caller-owned inline storage to preserve
    /// the original synchronous borrowed-model budget; its identity is still
    /// charged separately. Overrides must describe actual request ownership.
    fn request_inline_bytes(&self) -> u64 {
        std::mem::size_of_val(self) as u64
    }
    fn initialize(&self) -> Result<Self::State, Self::Error>;
    fn advance(&self, state: &mut Self::State, step: ReplayStep) -> Result<(), Self::Error>;
    /// Validate shape, finite values, and invariants at the specified step;
    /// return actual state bytes (checked arithmetic), or None if invalid.
    fn validate_state(&self, state: &Self::State, completed_steps: u64) -> Option<u64>;
}

/// Constructed only after successful replay; deliberately has no deserializer
/// or external-state constructor. Owning callers decide its lifetime.
#[derive(Debug)]
pub struct Checkpoint<P, S> {
    identity: ReplayIdentity<P>,
    cost: ReplayCost,
    completed_steps: u64,
    state: S,
}

impl<P, S> Checkpoint<P, S> {
    pub fn state(&self) -> &S {
        &self.state
    }

    pub fn into_state(self) -> S {
        self.state
    }
}

#[derive(Debug)]
pub struct ReplayOutput<P, S> {
    pub checkpoint: Checkpoint<P, S>,
    /// State is at the floor step. No unbudgeted next-step simulation or
    /// variable-length integration is performed for the remainder.
    pub position: ReplayPosition,
    pub executed_steps: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReplayError<E> {
    InvalidIdentity,
    ArithmeticOverflow,
    StepLimit,
    WorkLimit,
    MemoryLimit,
    CheckpointIdentity,
    CheckpointAhead,
    InvalidState,
    Cancelled,
    /// A job cannot publish before its target step is complete.
    Incomplete,
    /// A previous advance failed or was cancelled and discarded its state.
    JobTerminated,
    Model(E),
}

fn identity_bytes<P: ReplayParameters>(identity: &ReplayIdentity<P>) -> Option<u64> {
    let resource_bytes = (identity.resources.capacity() as u64)
        .checked_mul(std::mem::size_of::<ResourceIdentity>() as u64)?;
    let mut bytes = (std::mem::size_of::<ReplayIdentity<P>>() as u64)
        .checked_add(identity.parameters.heap_bytes()?)?
        .checked_add(resource_bytes)?;
    for resource in &identity.resources {
        bytes = bytes.checked_add(resource.id.capacity() as u64)?;
    }
    Some(bytes)
}

fn memory_bytes<M: ReplayModel>(
    model: &M,
    cost: ReplayCost,
    checkpoint: Option<&Checkpoint<M::Parameters, M::State>>,
) -> Option<(u64, u64)> {
    let identity = identity_bytes(model.identity())?;
    let metadata = (std::mem::size_of::<Checkpoint<M::Parameters, M::State>>()
        - std::mem::size_of::<ReplayIdentity<M::Parameters>>()
        - std::mem::size_of::<M::State>()) as u64;
    let output_metadata = (std::mem::size_of::<ReplayOutput<M::Parameters, M::State>>()
        - std::mem::size_of::<Checkpoint<M::Parameters, M::State>>())
        as u64;
    let output = identity
        .checked_add(cost.state_bytes)?
        .checked_add(metadata)?
        .checked_add(output_metadata)?;
    // Pending owns no publication identity yet. Its counters/discriminant fit
    // inside that reserved identity for ordinary models; account for unusual
    // model alignment too. Non-identity model allocations belong in model cost.
    let pending_metadata = (std::mem::size_of::<ReplayJob<M>>()
        - std::mem::size_of::<M>()
        - std::mem::size_of::<M::State>()) as u64;
    let pending = cost.state_bytes.checked_add(pending_metadata)?;
    let mut bytes = identity
        .checked_add(model.request_inline_bytes())?
        .checked_add(output.max(pending))?
        .checked_add(cost.scratch_bytes)?;
    if let Some(saved) = checkpoint {
        bytes = bytes
            .checked_add(identity_bytes(&saved.identity)?)?
            .checked_add(cost.state_bytes)?
            .checked_add(metadata)?;
    }
    Some((bytes, identity))
}

fn admit<M: ReplayModel>(
    model: &M,
    target_ticks: u64,
    budget: ReplayBudget,
    checkpoint: Option<&Checkpoint<M::Parameters, M::State>>,
) -> Result<(ReplayPosition, ReplayCost, u64, u64), ReplayError<M::Error>> {
    let identity = model.identity();
    if identity.engine.is_empty()
        || identity.version == 0
        || identity.dimensions.contains(&0)
        || identity.step.ticks_per_step == 0
        || identity.resources.iter().any(|r| r.id.is_empty())
        || identity.resources.windows(2).any(|r| r[0].id >= r[1].id)
    {
        return Err(ReplayError::InvalidIdentity);
    }
    let cost = model.cost();
    let position = ReplayPosition {
        completed_steps: target_ticks / identity.step.ticks_per_step,
        remainder_ticks: target_ticks % identity.step.ticks_per_step,
        step_ticks: identity.step.ticks_per_step,
    };
    let start = if let Some(saved) = checkpoint {
        if saved.identity != *identity || saved.cost != cost {
            return Err(ReplayError::CheckpointIdentity);
        }
        if saved.completed_steps > position.completed_steps {
            return Err(ReplayError::CheckpointAhead);
        }
        saved.completed_steps
    } else {
        0
    };
    // Charge the total source-age work, not only the resumed suffix, so a
    // checkpoint cannot bypass limits on an otherwise inadmissible request.
    let work = position
        .completed_steps
        .checked_mul(cost.step_work)
        .and_then(|work| work.checked_add(cost.init_work))
        .ok_or(ReplayError::ArithmeticOverflow)?;
    let (memory, identity_bound) =
        memory_bytes(model, cost, checkpoint).ok_or(ReplayError::ArithmeticOverflow)?;
    if position.completed_steps > budget.max_steps {
        return Err(ReplayError::StepLimit);
    }
    if work > budget.max_work {
        return Err(ReplayError::WorkLimit);
    }
    if memory > budget.max_state_bytes {
        return Err(ReplayError::MemoryLimit);
    }
    Ok((position, cost, start, identity_bound))
}

fn validate<M: ReplayModel>(
    model: &M,
    state: &M::State,
    cost: ReplayCost,
    completed_steps: u64,
) -> Result<(), ReplayError<M::Error>> {
    match model.validate_state(state, completed_steps) {
        Some(bytes) if bytes <= cost.state_bytes => Ok(()),
        Some(_) => Err(ReplayError::MemoryLimit),
        None => Err(ReplayError::InvalidState),
    }
}

pub fn replay<M: ReplayModel>(
    model: &M,
    target_ticks: u64,
    budget: ReplayBudget,
    checkpoint: Option<&Checkpoint<M::Parameters, M::State>>,
    mut cancelled: impl FnMut() -> bool,
) -> Result<ReplayOutput<M::Parameters, M::State>, ReplayError<M::Error>> {
    let mut job = ReplayJob::new(model, target_ticks, budget, checkpoint, &mut cancelled)?;
    job.advance(std::num::NonZeroU64::MAX, &mut cancelled)?;
    job.finish(cancelled)
}

#[cfg(test)]
#[path = "replay/tests.rs"]
mod tests;
