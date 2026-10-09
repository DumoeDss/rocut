//! Deterministic, short-side-normalized MAC fluid simulation.
//!
//! All arrays are row-major. Events are instantaneous velocity/concentration
//! increments, evaluated in physical domain coordinates. The caller selects
//! events in each half-open replay step; timestamps never select wall-clock time.

mod forces;
mod grid;
mod solve;
mod transport;
mod validation;

use grid::Grid;

pub(crate) const DT: f64 = 1.0 / 120.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Config {
    pub columns: u32,
    pub rows: u32,
    pub viscosity: f64,
    pub velocity_damping: f64,
    pub dye_dissipation: f64,
    pub pressure_iterations: u32,
    pub diffusion_iterations: u32,
    pub vorticity: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Event {
    pub at_ticks: u64,
    pub center: [f64; 2],
    pub radius: f64,
    pub velocity: [f64; 2],
    pub dye: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct State {
    columns: u32,
    rows: u32,
    domain: [f64; 2],
    u: Vec<f64>,
    v: Vec<f64>,
    pressure: Vec<f64>,
    dye: Vec<f64>,
}

impl State {
    pub fn columns(&self) -> u32 {
        self.columns
    }

    pub fn rows(&self) -> u32 {
        self.rows
    }

    pub fn domain(&self) -> [f64; 2] {
        self.domain
    }

    /// Horizontal velocity at (i * dx, (j + 0.5) * dy).
    pub fn u(&self) -> &[f64] {
        &self.u
    }

    /// Vertical velocity at ((i + 0.5) * dx, j * dy).
    pub fn v(&self) -> &[f64] {
        &self.v
    }

    pub fn pressure(&self) -> &[f64] {
        &self.pressure
    }

    pub fn dye(&self) -> &[f64] {
        &self.dye
    }

    /// Owned allocation capacity plus the State header; allocator metadata is excluded.
    pub fn memory_bytes(&self) -> Option<u64> {
        let mut bytes = u64::try_from(std::mem::size_of::<Self>()).ok()?;
        for capacity in [
            self.u.capacity(),
            self.v.capacity(),
            self.pressure.capacity(),
            self.dye.capacity(),
        ] {
            bytes = bytes.checked_add(u64::try_from(capacity).ok()?.checked_mul(8)?)?;
        }
        Some(bytes)
    }

    pub fn validate(&self, config: &Config, domain: [f64; 2]) -> Result<(), Error> {
        let grid = Grid::new(config, domain)?;
        validation::state(self, &grid)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Error(pub &'static str);

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for Error {}

/// Array payload bytes, excluding allocator metadata and stack/Vec headers.
/// Let C = nx*ny and F = (nx+1)*ny + nx*(ny+1).
/// Resident state = 8*(F+2*C); scratch = 16*F (diffusion RHS + iteration).
/// Peak = 2*resident + scratch: advance preserves its input until success.
/// `step_work` counts conservative weighted grid visits, not CPU instructions:
/// F*(64+events+active_diffusion_iterations) +
/// C*(32+events+pressure_iterations+32*active_vorticity).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ResourceEstimate {
    pub state_bytes: u64,
    pub scratch_bytes: u64,
    pub peak_bytes: u64,
    pub step_work: u64,
}

pub(crate) fn resource_estimate(
    config: &Config,
    event_count: usize,
) -> Result<ResourceEstimate, Error> {
    validation::config(config)?;
    if event_count > 16 {
        return Err(Error("liquid event count exceeds 16"));
    }
    let cells = u64::from(config.columns) * u64::from(config.rows);
    let faces = 2 * cells + u64::from(config.columns) + u64::from(config.rows);
    let state_bytes = (faces + 2 * cells) * 8;
    let scratch_bytes = 2 * faces * 8;
    let diffusion = if config.viscosity > 0.0 {
        u64::from(config.diffusion_iterations)
    } else {
        0
    };
    let confinement = if config.vorticity > 0.0 { 32 } else { 0 };
    let events = event_count as u64;
    Ok(ResourceEstimate {
        state_bytes,
        scratch_bytes,
        peak_bytes: 2 * state_bytes + scratch_bytes,
        step_work: faces * (64 + events + diffusion)
            + cells * (32 + events + u64::from(config.pressure_iterations) + confinement),
    })
}

pub(crate) fn initialize(config: &Config, domain: [f64; 2]) -> Result<State, Error> {
    let grid = Grid::new(config, domain)?;
    Ok(State {
        columns: config.columns,
        rows: config.rows,
        domain,
        u: vec![0.0; grid.u_len()],
        v: vec![0.0; grid.v_len()],
        pressure: vec![0.0; grid.cells()],
        dye: vec![0.0; grid.cells()],
    })
}

/// Validate the complete schedule even when replay has not reached an event yet.
pub(crate) fn validate_events(events: &[Event]) -> Result<(), Error> {
    validation::events(events)
}

/// Fixed step, transactional on numerical/configuration failure.
/// Event ordering and the caller's [step_start, step_end) selection are preserved.
pub(crate) fn advance(
    config: &Config,
    domain: [f64; 2],
    state: &mut State,
    events: &[Event],
) -> Result<(), Error> {
    let grid = Grid::new(config, domain)?;
    validation::state(state, &grid)?;
    validation::events(events)?;
    let mut next = state.clone();
    forces::inject(&grid, &mut next, events);
    validation::finite(&next)?;
    transport::velocity(&grid, &mut next)?;
    solve::diffuse(&grid, &mut next, config);
    validation::finite(&next)?;
    forces::confine(&grid, &mut next, config.vorticity)?;
    solve::project(&grid, &mut next, config.pressure_iterations);
    validation::finite(&next)?;
    let damping = (-config.velocity_damping * DT).exp();
    next.u
        .iter_mut()
        .chain(&mut next.v)
        .for_each(|v| *v *= damping);
    transport::dye(&grid, &mut next, config.dye_dissipation)?;
    validation::state(&next, &grid)?;
    *state = next;
    Ok(())
}

#[cfg(test)]
mod tests;
