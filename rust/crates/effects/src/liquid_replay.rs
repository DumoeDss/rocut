use std::num::NonZeroU64;
use time::replay::{
    ReplayBudget, ReplayCost, ReplayError, ReplayIdentity, ReplayJob, ReplayModel, ReplayProgress,
    ReplayStep, StepRule,
};

use crate::liquid_catalog::{MAX_MEMORY, MAX_TICKS, MAX_WORK, STEP_TICKS};
use crate::liquid_sim::{self, Config, Event, State};

#[derive(Clone, Debug)]
struct Simulation {
    fluid: State,
    steps: u64,
    cursor: usize,
}

fn cost(config: &Config, event_count: usize) -> Result<ReplayCost, String> {
    let estimate = liquid_sim::resource_estimate(config, event_count).map_err(|e| e.to_string())?;
    let cells = u64::from(config.columns) * u64::from(config.rows);
    let state_bytes = estimate.state_bytes + std::mem::size_of::<Simulation>() as u64;
    let owned_model_bytes = std::mem::size_of::<Model>() as u64
        + event_count as u64 * std::mem::size_of::<Event>() as u64;
    Ok(ReplayCost {
        state_bytes,
        // Keep the original conservative allowance; it now explicitly includes
        // the request-owned Config/events/model. Identity heaps are charged by
        // time::replay independently. No state/checkpoint clone per chunk.
        scratch_bytes: state_bytes + estimate.scratch_bytes + 4096.max(owned_model_bytes),
        init_work: 32 * cells + 4096,
        step_work: estimate.step_work + 16 * cells + 2 * event_count as u64 + 64,
    })
}

pub(crate) fn validate_budget(
    config: &Config,
    event_count: usize,
    duration: u64,
) -> Result<(), String> {
    if !(STEP_TICKS..=MAX_TICKS).contains(&duration) {
        return Err("Liquid duration is outside the bounded replay range".into());
    }
    let cost = cost(config, event_count)?;
    let work = (duration / STEP_TICKS)
        .checked_mul(cost.step_work)
        .and_then(|work| work.checked_add(cost.init_work))
        .ok_or("Liquid work arithmetic overflow")?;
    if work > MAX_WORK {
        return Err("Liquid simulation work budget exceeded".into());
    }
    if estimate_memory_bytes(config, event_count).map_err(|error| error.to_string())? > MAX_MEMORY {
        return Err("Liquid simulation memory budget exceeded".into());
    }
    Ok(())
}

#[derive(Debug)]
struct Model {
    config: Config,
    events: Box<[Event]>,
    domain: [f64; 2],
    identity: ReplayIdentity<Vec<u8>>,
    cost: ReplayCost,
}

impl ReplayModel for Model {
    type Parameters = Vec<u8>;
    type State = Simulation;
    type Error = String;

    fn identity(&self) -> &ReplayIdentity<Vec<u8>> {
        &self.identity
    }
    fn cost(&self) -> ReplayCost {
        self.cost
    }
    fn initialize(&self) -> Result<Simulation, String> {
        Ok(Simulation {
            fluid: liquid_sim::initialize(&self.config, self.domain).map_err(|e| e.to_string())?,
            steps: 0,
            cursor: 0,
        })
    }
    fn advance(&self, state: &mut Simulation, step: ReplayStep) -> Result<(), String> {
        let end = self.events.partition_point(|e| e.at_ticks < step.end_ticks);
        liquid_sim::advance(
            &self.config,
            self.domain,
            &mut state.fluid,
            &self.events[state.cursor..end],
        )
        .map_err(|e| e.to_string())?;
        state.cursor = end;
        state.steps += 1;
        Ok(())
    }
    fn validate_state(&self, state: &Simulation, completed_steps: u64) -> Option<u64> {
        if state.steps != completed_steps
            || state.cursor
                != self
                    .events
                    .partition_point(|e| e.at_ticks < completed_steps * STEP_TICKS)
            || state.fluid.validate(&self.config, self.domain).is_err()
        {
            return None;
        }
        state
            .fluid
            .memory_bytes()?
            .checked_add((std::mem::size_of::<Simulation>() - std::mem::size_of::<State>()) as u64)
    }
}

fn admitted_model(
    config: &Config,
    events: &[Event],
    dimensions: [u32; 2],
    elapsed: u64,
    duration: u64,
) -> Result<Model, String> {
    validate_budget(config, events.len(), duration)?;
    liquid_sim::validate_events(events).map_err(|error| error.to_string())?;
    if dimensions.contains(&0)
        || elapsed > duration
        || events
            .windows(2)
            .any(|pair| pair[0].at_ticks > pair[1].at_ticks)
        || events.iter().any(|event| event.at_ticks >= duration)
    {
        return Err("Invalid Liquid replay dimensions, age or events".into());
    }
    let short = dimensions[0].min(dimensions[1]) as f64;
    let domain = dimensions.map(|v| f64::from(v) / short);
    let mut identity = Vec::with_capacity(128 + events.len() * 56);
    for value in [
        config.columns as f64,
        config.rows as f64,
        config.viscosity,
        config.velocity_damping,
        config.dye_dissipation,
        config.pressure_iterations as f64,
        config.diffusion_iterations as f64,
        config.vorticity,
        duration as f64,
    ] {
        identity.extend(value.to_bits().to_le_bytes());
    }
    for event in events {
        for value in [
            event.at_ticks as f64,
            event.center[0],
            event.center[1],
            event.radius,
            event.velocity[0],
            event.velocity[1],
            event.dye,
        ] {
            identity.extend(value.to_bits().to_le_bytes());
        }
    }
    Ok(Model {
        config: *config,
        events: events.into(),
        domain,
        cost: cost(config, events.len())?,
        // Fluid state has no dependency on source image bytes. The current input
        // is sampled only after replay; no rendered image is stored in a checkpoint.
        identity: ReplayIdentity {
            engine: "liquid-mac",
            version: 1,
            seed: 0,
            parameters: identity,
            resources: Vec::new(),
            dimensions,
            step: StepRule {
                ticks_per_step: STEP_TICKS,
            },
        },
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LiquidReplayError {
    Invalid(String),
    Replay(ReplayError<String>),
}

impl LiquidReplayError {
    pub(crate) fn is_cancelled(&self) -> bool {
        matches!(self, Self::Replay(ReplayError::Cancelled))
    }
}

impl std::fmt::Display for LiquidReplayError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Replay(error) => write!(formatter, "Liquid replay failed: {error:?}"),
        }
    }
}

impl std::error::Error for LiquidReplayError {}

/// Allocation-free, conservative per-request replay peak. Includes owned
/// Config/events/model, state, transactional solver scratch and both identity
/// copies/counters (8192-byte reserve). A compositor must add its own retained
/// raster/pass storage and aggregate this across all simultaneously held jobs.
pub(crate) fn estimate_memory_bytes(
    config: &Config,
    event_count: usize,
) -> Result<u64, LiquidReplayError> {
    let cost = cost(config, event_count).map_err(LiquidReplayError::Invalid)?;
    cost.state_bytes
        .checked_add(cost.scratch_bytes)
        .and_then(|bytes| bytes.checked_add(8192))
        .ok_or_else(|| LiquidReplayError::Invalid("Liquid memory arithmetic overflow".into()))
}

/// Owns exactly one admitted replay; no source image, GPU or shared cache.
#[derive(Debug)]
pub(crate) struct LiquidReplayJob {
    replay: ReplayJob<Model>,
}

impl LiquidReplayJob {
    pub(crate) fn new(
        config: &Config,
        events: &[Event],
        dimensions: [u32; 2],
        elapsed: u64,
        duration: u64,
        cancelled: impl FnMut() -> bool,
    ) -> Result<Self, LiquidReplayError> {
        let model = admitted_model(config, events, dimensions, elapsed, duration)
            .map_err(LiquidReplayError::Invalid)?;
        let replay = ReplayJob::new(
            model,
            elapsed,
            ReplayBudget {
                max_steps: MAX_TICKS / STEP_TICKS,
                max_work: MAX_WORK,
                max_state_bytes: MAX_MEMORY,
            },
            None,
            cancelled,
        )
        .map_err(LiquidReplayError::Replay)?;
        Ok(Self { replay })
    }

    pub(crate) fn advance(
        &mut self,
        max_steps: NonZeroU64,
        cancelled: impl FnMut() -> bool,
    ) -> Result<ReplayProgress, LiquidReplayError> {
        self.replay
            .advance(max_steps, cancelled)
            .map_err(LiquidReplayError::Replay)
    }

    pub(crate) fn finish(
        self,
        cancelled: impl FnMut() -> bool,
    ) -> Result<State, LiquidReplayError> {
        self.replay
            .finish(cancelled)
            .map(|output| output.checkpoint.into_state().fluid)
            .map_err(LiquidReplayError::Replay)
    }
}

pub(crate) fn simulate(
    config: &Config,
    events: &[Event],
    dimensions: [u32; 2],
    elapsed: u64,
    duration: u64,
    mut cancelled: impl FnMut() -> bool,
) -> Result<State, String> {
    let mut job = LiquidReplayJob::new(
        config,
        events,
        dimensions,
        elapsed,
        duration,
        &mut cancelled,
    )
    .map_err(|error| error.to_string())?;
    job.advance(NonZeroU64::MAX, &mut cancelled)
        .map_err(|error| error.to_string())?;
    job.finish(cancelled).map_err(|error| error.to_string())
}
