use super::{Config, Error, Event, State, grid::Grid};

fn in_range(value: f64, low: f64, high: f64) -> bool {
    value.is_finite() && (low..=high).contains(&value)
}

pub(super) fn config(config: &Config) -> Result<(), Error> {
    if !(8..=64).contains(&config.columns) || !(8..=64).contains(&config.rows) {
        return Err(Error("liquid grid dimensions must be in 8..=64"));
    }
    if !in_range(config.viscosity, 0.0, 0.02)
        || !in_range(config.velocity_damping, 0.0, 10.0)
        || !in_range(config.dye_dissipation, 0.0, 10.0)
        || !in_range(config.vorticity, 0.0, 4.0)
    {
        return Err(Error(
            "liquid coefficient is non-finite or outside its range",
        ));
    }
    if !(4..=80).contains(&config.pressure_iterations)
        || !(2..=24).contains(&config.diffusion_iterations)
    {
        return Err(Error("liquid solver iteration count is outside its range"));
    }
    Ok(())
}

pub(super) fn events(events: &[Event]) -> Result<(), Error> {
    if events.len() > 16 {
        return Err(Error("liquid event count exceeds 16"));
    }
    let mut last_tick = 0;
    for event in events {
        if event.at_ticks < last_tick
            || !event.center.iter().all(|v| in_range(*v, 0.0, 1.0))
            || !in_range(event.radius, 0.01, 2.0)
            || !event.velocity.iter().all(|v| in_range(*v, -3.0, 3.0))
            || !in_range(event.dye, 0.0, 1.0)
        {
            return Err(Error(
                "liquid event is unordered, non-finite, or outside its range",
            ));
        }
        last_tick = event.at_ticks;
    }
    Ok(())
}

pub(super) fn finite(state: &State) -> Result<(), Error> {
    if state
        .u
        .iter()
        .chain(&state.v)
        .chain(&state.pressure)
        .chain(&state.dye)
        .any(|v| !v.is_finite())
    {
        return Err(Error("liquid numerical arithmetic is not finite"));
    }
    Ok(())
}

pub(super) fn state(state: &State, grid: &Grid) -> Result<(), Error> {
    if state.columns as usize != grid.nx
        || state.rows as usize != grid.ny
        || state.domain != grid.domain
        || state.u.len() != grid.u_len()
        || state.v.len() != grid.v_len()
        || state.pressure.len() != grid.cells()
        || state.dye.len() != grid.cells()
    {
        return Err(Error(
            "liquid state shape/domain does not match its configuration",
        ));
    }
    finite(state)?;
    if state.dye.iter().any(|v| *v < 0.0) {
        return Err(Error("liquid dye concentration must be nonnegative"));
    }
    for j in 0..grid.ny {
        if state.u[grid.u(0, j)] != 0.0 || state.u[grid.u(grid.nx, j)] != 0.0 {
            return Err(Error("liquid state violates horizontal no-through walls"));
        }
    }
    for i in 0..grid.nx {
        if state.v[grid.v(i, 0)] != 0.0 || state.v[grid.v(i, grid.ny)] != 0.0 {
            return Err(Error("liquid state violates vertical no-through walls"));
        }
    }
    Ok(())
}
