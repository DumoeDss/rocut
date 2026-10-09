use super::{DT, Error, State, grid::Grid};

fn backtrace(grid: &Grid, state: &State, p: [f64; 2]) -> Result<[f64; 2], Error> {
    let first = grid.sample_velocity(state, p);
    let midpoint = grid.clamp([p[0] - 0.5 * DT * first[0], p[1] - 0.5 * DT * first[1]])?;
    let middle = grid.sample_velocity(state, midpoint);
    grid.clamp([p[0] - DT * middle[0], p[1] - DT * middle[1]])
}

pub(super) fn velocity(grid: &Grid, state: &mut State) -> Result<(), Error> {
    let mut u = vec![0.0; grid.u_len()];
    let mut v = vec![0.0; grid.v_len()];
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            let p = backtrace(grid, state, grid.u_position(i, j))?;
            u[grid.u(i, j)] = grid.sample_u(&state.u, p);
        }
    }
    for j in 1..grid.ny {
        for i in 0..grid.nx {
            let p = backtrace(grid, state, grid.v_position(i, j))?;
            v[grid.v(i, j)] = grid.sample_v(&state.v, p);
        }
    }
    state.u = u;
    state.v = v;
    Ok(())
}

pub(super) fn dye(grid: &Grid, state: &mut State, dissipation: f64) -> Result<(), Error> {
    let decay = (-dissipation * DT).exp();
    let mut values = vec![0.0; grid.cells()];
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            let p = backtrace(grid, state, grid.cell_position(i, j))?;
            values[grid.cell(i, j)] = grid.sample_cell(&state.dye, p) * decay;
        }
    }
    state.dye = values;
    Ok(())
}
