use super::*;
use std::cell::Cell;

thread_local! {
    static CLONES: Cell<u64> = const { Cell::new(0) };
    static CANCEL_IN_CLONE: Cell<bool> = const { Cell::new(false) };
    static CLONE_CANCELLED: Cell<bool> = const { Cell::new(false) };
    static STATE_CLONES: Cell<u64> = const { Cell::new(0) };
}

pub(super) fn reset_clone_probe(cancel: bool) {
    CLONES.set(0);
    CANCEL_IN_CLONE.set(cancel);
    CLONE_CANCELLED.set(false);
}

pub(super) fn clone_count() -> u64 {
    CLONES.get()
}

pub(super) fn clone_cancelled() -> bool {
    CLONE_CANCELLED.get()
}

pub(super) fn reset_state_clones() {
    STATE_CLONES.set(0);
}

pub(super) fn state_clones() -> u64 {
    STATE_CLONES.get()
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Parameters {
    pub(super) spring: u64,
    pub(super) damping: u64,
    pub(super) events: Vec<(u64, u64)>,
}

impl Clone for Parameters {
    fn clone(&self) -> Self {
        let events = self.events.clone();
        CLONES.set(CLONES.get() + 1);
        if CANCEL_IN_CLONE.get() {
            CLONE_CANCELLED.set(true);
        }
        Self {
            spring: self.spring,
            damping: self.damping,
            events,
        }
    }
}

impl ReplayParameters for Parameters {
    fn heap_bytes(&self) -> Option<u64> {
        (self.events.capacity() as u64).checked_mul(std::mem::size_of::<(u64, u64)>() as u64)
    }
}

#[derive(Debug)]
pub(super) struct Particles {
    pub(super) position: [f64; 2],
    pub(super) velocity: [f64; 2],
    pub(super) steps: u64,
    pub(super) event_cursor: usize,
}

impl Clone for Particles {
    fn clone(&self) -> Self {
        STATE_CLONES.set(STATE_CLONES.get() + 1);
        Self {
            position: self.position,
            velocity: self.velocity,
            steps: self.steps,
            event_cursor: self.event_cursor,
        }
    }
}

impl Particles {
    pub(super) fn bits(&self) -> ([u64; 2], [u64; 2], u64, usize) {
        (
            self.position.map(f64::to_bits),
            self.velocity.map(f64::to_bits),
            self.steps,
            self.event_cursor,
        )
    }
}

pub(super) struct Spring {
    pub(super) identity: ReplayIdentity<Parameters>,
    pub(super) cost: ReplayCost,
    pub(super) initialized: Cell<u64>,
    pub(super) advanced: Cell<u64>,
    pub(super) fail_init: bool,
    pub(super) fail_at: Option<u64>,
    pub(super) corrupt_at: Option<u64>,
}

impl Default for Spring {
    fn default() -> Self {
        Self {
            identity: ReplayIdentity {
                engine: "test-spring",
                version: 1,
                seed: 1,
                parameters: Parameters {
                    spring: 2.0_f64.to_bits(),
                    damping: 0.25_f64.to_bits(),
                    events: vec![(3_000, 0.5_f64.to_bits()), (5_000, (-0.2_f64).to_bits())],
                },
                resources: vec![ResourceIdentity {
                    id: "texture".into(),
                    sha256: [17; 32],
                }],
                dimensions: [192, 108],
                step: StepRule {
                    ticks_per_step: 1_000,
                },
            },
            cost: ReplayCost {
                state_bytes: 64,
                scratch_bytes: 16,
                init_work: 3,
                step_work: 8,
            },
            initialized: Cell::new(0),
            advanced: Cell::new(0),
            fail_init: false,
            fail_at: None,
            corrupt_at: None,
        }
    }
}

impl Spring {
    pub(super) fn memory_bound(&self, saved: Option<&Checkpoint<Parameters, Particles>>) -> u64 {
        fn heap(identity: &ReplayIdentity<Parameters>) -> u64 {
            (identity.parameters.events.capacity() * std::mem::size_of::<(u64, u64)>()
                + identity.resources.capacity() * std::mem::size_of::<ResourceIdentity>()
                + identity
                    .resources
                    .iter()
                    .map(|r| r.id.capacity())
                    .sum::<usize>()) as u64
        }
        let state_heap = self.cost.state_bytes - std::mem::size_of::<Particles>() as u64;
        let model = std::mem::size_of::<ReplayIdentity<Parameters>>() as u64 + heap(&self.identity);
        let output = std::mem::size_of::<ReplayOutput<Parameters, Particles>>() as u64
            + heap(&self.identity)
            + state_heap;
        model
            + output
            + self.cost.scratch_bytes
            + saved.map_or(0, |saved| {
                std::mem::size_of::<Checkpoint<Parameters, Particles>>() as u64
                    + heap(&saved.identity)
                    + state_heap
            })
    }
}

impl ReplayModel for Spring {
    type Parameters = Parameters;
    type State = Particles;
    type Error = &'static str;

    fn identity(&self) -> &ReplayIdentity<Parameters> {
        &self.identity
    }
    fn cost(&self) -> ReplayCost {
        self.cost
    }
    fn initialize(&self) -> Result<Particles, Self::Error> {
        self.initialized.set(self.initialized.get() + 1);
        if self.fail_init {
            return Err("initialization failed");
        }
        Ok(Particles {
            position: [self.identity.seed as f64, -0.5],
            velocity: [0.0; 2],
            steps: 0,
            event_cursor: 0,
        })
    }
    fn advance(&self, state: &mut Particles, step: ReplayStep) -> Result<(), Self::Error> {
        self.advanced.set(self.advanced.get() + 1);
        assert_eq!(state.steps, step.index);
        assert_eq!(
            step.start_ticks,
            state.steps * self.identity.step.ticks_per_step
        );
        assert_eq!(
            step.end_ticks - step.start_ticks,
            self.identity.step.ticks_per_step
        );
        let p = &self.identity.parameters;
        while let Some(&(tick, impulse)) = p.events.get(state.event_cursor) {
            if tick >= step.end_ticks {
                break;
            }
            assert!(tick >= step.start_ticks);
            state.velocity[0] += f64::from_bits(impulse);
            state.event_cursor += 1;
        }
        let dt = (step.end_ticks - step.start_ticks) as f64 / TICKS_PER_SECOND as f64;
        for particle in 0..2 {
            let force = -f64::from_bits(p.spring) * state.position[particle];
            state.velocity[particle] =
                (state.velocity[particle] + force * dt) * (1.0 - f64::from_bits(p.damping));
            state.position[particle] += state.velocity[particle] * dt;
        }
        state.steps += 1;
        if self.corrupt_at == Some(step.index) {
            state.position[0] = f64::NAN;
        }
        if self.fail_at == Some(step.index) {
            return Err("step failed");
        }
        Ok(())
    }
    fn validate_state(&self, state: &Particles, completed_steps: u64) -> Option<u64> {
        let elapsed = completed_steps.checked_mul(self.identity.step.ticks_per_step)?;
        let expected_cursor = self
            .identity
            .parameters
            .events
            .partition_point(|e| e.0 < elapsed);
        (state
            .position
            .iter()
            .chain(&state.velocity)
            .all(|v| v.is_finite())
            && state.event_cursor == expected_cursor
            && state.steps == completed_steps)
            .then_some(std::mem::size_of::<Particles>() as u64)
    }
}
