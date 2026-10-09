use super::constraints::{self, Constraint};
use super::{Cloth, DT, MAX_IDENTITY_BYTES, MAX_MEMORY, STEP_TICKS};
use crate::mv_recipe::replay::{
    ReplayCost, ReplayIdentity, ReplayModel, ReplayStep, ResourceIdentity, StepRule,
};
use crate::mv_recipe::transitions::random;
use crate::programmatic_resources::Resource;
use std::mem::size_of;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Particle {
    pub position: [f64; 3],
    pub previous: [f64; 3],
    pub velocity: [f64; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct State {
    pub points: Vec<Particle>,
    pub lambdas: Vec<f64>,
    pub steps: u64,
    pub event_cursor: usize,
}

pub(super) struct Model<'a> {
    pub settings: &'a Cloth,
    pub identity: ReplayIdentity<Vec<u8>>,
    pub rect: [f64; 4],
    pub short: f64,
    pub size: [f64; 2],
    pub constraints: Vec<Constraint>,
    cost: ReplayCost,
}

/// A unit is a bounded particle pass, constraint visit, event dispatch or byte
/// copied into the identity. Iteration and worst-case event costs are explicit.
pub(super) fn work_cost(settings: &Cloth) -> Option<(u64, u64)> {
    let vertices = u64::from(settings.columns + 1).checked_mul(u64::from(settings.rows + 1))?;
    let edges = constraints::count(settings.columns, settings.rows);
    let events = settings.events.len() as u64;
    let init = vertices
        .checked_mul(4)?
        .checked_add(edges.checked_mul(3)?)?
        .checked_add(events.checked_mul(2)?)?
        .checked_add(3 * MAX_IDENTITY_BYTES)?;
    let step = edges
        .checked_mul(u64::from(settings.solver_iterations) + 2)?
        .checked_add(vertices.checked_mul(8 + events)?)?
        .checked_add(events.checked_mul(2)?)?
        .checked_add(32)?;
    Some((init, step))
}

impl<'a> Model<'a> {
    pub fn new(
        settings: &'a Cloth,
        seed: u32,
        width: u32,
        height: u32,
        resource: &Resource,
    ) -> Result<Self, String> {
        if !settings.valid()
            || !(1..=4096).contains(&width)
            || !(1..=4096).contains(&height)
            || resource.id != settings.image
            || resource.kind != "image"
        {
            return Err("Invalid Cloth model inputs".into());
        }
        let vertices = (settings.columns as u64 + 1) * (settings.rows as u64 + 1);
        let edges = constraints::count(settings.columns, settings.rows);
        // Shape admission precedes identity, grid, and constraint allocations.
        let upper_memory = vertices * size_of::<Particle>() as u64 * 3
            + edges * (size_of::<Constraint>() as u64 + 24)
            + 4 * MAX_IDENTITY_BYTES
            + 4096;
        if upper_memory > MAX_MEMORY {
            return Err("Cloth model shape exceeds memory budget".into());
        }
        let sha = resource.sha256().as_bytes();
        if sha.len() != 64
            || !sha
                .iter()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
        {
            return Err("Cloth image needs a lowercase SHA-256 identity".into());
        }
        let mut sha256 = [0; 32];
        for (target, bytes) in sha256.iter_mut().zip(sha.chunks_exact(2)) {
            let nibble = |b: u8| if b <= b'9' { b - b'0' } else { b - b'a' + 10 };
            *target = nibble(bytes[0]) * 16 + nibble(bytes[1]);
        }
        let parameters = serde_json::to_vec(settings).map_err(|error| error.to_string())?;
        if parameters.capacity() as u64 > MAX_IDENTITY_BYTES {
            return Err("Cloth identity exceeds bounded parameter storage".into());
        }
        let rect = [
            settings.rect[0] * f64::from(width),
            settings.rect[1] * f64::from(height),
            settings.rect[2] * f64::from(width),
            settings.rect[3] * f64::from(height),
        ];
        let short = rect[2].min(rect[3]);
        let size = [rect[2] / short, rect[3] / short];
        let constraints = constraints::build(settings, size);
        let (init_work, step_work) = work_cost(settings).ok_or("Cloth work overflow")?;
        let cost = ReplayCost {
            state_bytes: size_of::<State>() as u64
                + vertices * size_of::<Particle>() as u64
                + edges * 8,
            // Replay already counts model identity. Account for remaining model
            // storage, including the persistent constraint heap, in scratch.
            scratch_bytes: (size_of::<Self>() - size_of::<ReplayIdentity<Vec<u8>>>()) as u64
                + constraints.capacity() as u64 * size_of::<Constraint>() as u64,
            init_work,
            step_work,
        };
        Ok(Self {
            settings,
            rect,
            short,
            size,
            constraints,
            cost,
            identity: ReplayIdentity {
                engine: "cloth-xpbd",
                version: 1,
                seed: u64::from(seed),
                parameters,
                resources: vec![ResourceIdentity {
                    id: resource.id.clone(),
                    sha256,
                }],
                dimensions: [width, height],
                step: StepRule {
                    ticks_per_step: STEP_TICKS,
                },
            },
        })
    }

    fn acceleration(&self, ticks: u64) -> [f64; 3] {
        let s = self.settings;
        let phase = std::f64::consts::TAU * random(self.identity.seed as u32, 0xc107);
        let angle = phase + std::f64::consts::TAU * s.gust_frequency * ticks as f64 / 120_000.0;
        [
            s.wind[0] + s.gust * angle.sin(),
            s.gravity + s.wind[1] + s.gust * 0.25 * (angle + 1.7).sin(),
            s.wind[2] + s.gust * (angle + 0.8).cos(),
        ]
    }

    pub(super) fn apply_events(
        &self,
        state: &mut State,
        step: ReplayStep,
    ) -> Result<(), &'static str> {
        let settings = self.settings;
        while let Some(event) = settings.events.get(state.event_cursor) {
            if event.at_ticks >= step.end_ticks {
                break;
            }
            if event.at_ticks < step.start_ticks {
                return Err("Cloth event cursor mismatch");
            }
            for (index, point) in state.points.iter_mut().enumerate() {
                if settings.pinned(index) {
                    continue;
                }
                let uv = settings.uv(index);
                let radius = (((uv[0] - event.center[0]) * self.size[0]).powi(2)
                    + ((uv[1] - event.center[1]) * self.size[1]).powi(2))
                .sqrt();
                let t = (1.0 - radius / event.radius).max(0.0);
                let falloff = t * t * (3.0 - 2.0 * t);
                for axis in 0..3 {
                    point.velocity[axis] += event.velocity[axis] * falloff;
                }
            }
            state.event_cursor += 1;
        }
        Ok(())
    }
}

impl ReplayModel for Model<'_> {
    type Parameters = Vec<u8>;
    type State = State;
    type Error = &'static str;

    fn identity(&self) -> &ReplayIdentity<Vec<u8>> {
        &self.identity
    }
    fn cost(&self) -> ReplayCost {
        self.cost
    }

    fn initialize(&self) -> Result<State, Self::Error> {
        let count = (self.settings.columns as usize + 1) * (self.settings.rows as usize + 1);
        let mut points = Vec::with_capacity(count);
        for index in 0..count {
            let position = constraints::rest(self.settings, self.size, index);
            points.push(Particle {
                position,
                previous: position,
                velocity: [0.0; 3],
            });
        }
        Ok(State {
            points,
            lambdas: vec![0.0; self.constraints.len()],
            steps: 0,
            event_cursor: 0,
        })
    }

    fn advance(&self, state: &mut State, step: ReplayStep) -> Result<(), Self::Error> {
        if state.steps != step.index {
            return Err("Cloth step order mismatch");
        }
        let settings = self.settings;
        self.apply_events(state, step)?;
        let acceleration = self.acceleration(step.start_ticks);
        let damping = (-settings.damping * DT).exp();
        for (index, point) in state.points.iter_mut().enumerate() {
            point.previous = point.position;
            if settings.pinned(index) {
                continue;
            }
            for (axis, force) in acceleration.iter().enumerate() {
                point.velocity[axis] = (point.velocity[axis] + force * DT) * damping;
                point.position[axis] += point.velocity[axis] * DT;
            }
        }
        state.lambdas.fill(0.0);
        for _ in 0..settings.solver_iterations {
            for (constraint, lambda) in self.constraints.iter().zip(&mut state.lambdas) {
                constraints::solve(settings, &mut state.points, *constraint, lambda);
            }
        }
        for (index, point) in state.points.iter_mut().enumerate() {
            if settings.pinned(index) {
                point.position = constraints::rest(settings, self.size, index);
                point.previous = point.position;
                point.velocity = [0.0; 3];
            } else {
                for axis in 0..3 {
                    point.velocity[axis] = (point.position[axis] - point.previous[axis]) / DT;
                }
            }
        }
        state.steps += 1;
        Ok(())
    }

    fn validate_state(&self, state: &State, completed_steps: u64) -> Option<u64> {
        let settings = self.settings;
        let count = (settings.columns as usize + 1) * (settings.rows as usize + 1);
        let elapsed = completed_steps.checked_mul(STEP_TICKS)?;
        if state.steps != completed_steps
            || state.points.len() != count
            || state.lambdas.len() != self.constraints.len()
            || state.event_cursor
                != settings
                    .events
                    .partition_point(|event| event.at_ticks < elapsed)
            || !state.lambdas.iter().all(|v| v.is_finite())
        {
            return None;
        }
        for (index, point) in state.points.iter().enumerate() {
            if !point
                .position
                .iter()
                .chain(&point.previous)
                .chain(&point.velocity)
                .all(|v| v.is_finite())
            {
                return None;
            }
            if settings.pinned(index)
                && (point.position != constraints::rest(settings, self.size, index)
                    || point.previous != point.position
                    || point.velocity != [0.0; 3])
            {
                return None;
            }
        }
        (size_of::<State>() as u64)
            .checked_add(
                (state.points.capacity() as u64).checked_mul(size_of::<Particle>() as u64)?,
            )?
            .checked_add((state.lambdas.capacity() as u64).checked_mul(8)?)
    }
}
