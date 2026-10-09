use super::{Config, DT, State, grid::Grid};

pub(super) fn diffuse(grid: &Grid, state: &mut State, config: &Config) {
    if config.viscosity == 0.0 {
        return;
    }
    let ax = config.viscosity * DT * grid.dx.recip().powi(2);
    let ay = config.viscosity * DT * grid.dy.recip().powi(2);
    let rhs_u = state.u.clone();
    let rhs_v = state.v.clone();
    let mut u = vec![0.0; grid.u_len()];
    let mut v = vec![0.0; grid.v_len()];
    for _ in 0..config.diffusion_iterations {
        for j in 0..grid.ny {
            for i in 1..grid.nx {
                let k = grid.u(i, j);
                let mut sum =
                    rhs_u[k] + ax * (state.u[grid.u(i - 1, j)] + state.u[grid.u(i + 1, j)]);
                let mut diagonal = 1.0 + 2.0 * ax;
                if j > 0 {
                    sum += ay * state.u[grid.u(i, j - 1)];
                    diagonal += ay;
                }
                if j + 1 < grid.ny {
                    sum += ay * state.u[grid.u(i, j + 1)];
                    diagonal += ay;
                }
                u[k] = sum / diagonal;
            }
        }
        for j in 1..grid.ny {
            for i in 0..grid.nx {
                let k = grid.v(i, j);
                let mut sum =
                    rhs_v[k] + ay * (state.v[grid.v(i, j - 1)] + state.v[grid.v(i, j + 1)]);
                let mut diagonal = 1.0 + 2.0 * ay;
                if i > 0 {
                    sum += ax * state.v[grid.v(i - 1, j)];
                    diagonal += ax;
                }
                if i + 1 < grid.nx {
                    sum += ax * state.v[grid.v(i + 1, j)];
                    diagonal += ax;
                }
                v[k] = sum / diagonal;
            }
        }
        std::mem::swap(&mut state.u, &mut u);
        std::mem::swap(&mut state.v, &mut v);
    }
}

pub(super) fn divergence(grid: &Grid, state: &State, i: usize, j: usize) -> f64 {
    (state.u[grid.u(i + 1, j)] - state.u[grid.u(i, j)]) / grid.dx
        + (state.v[grid.v(i, j + 1)] - state.v[grid.v(i, j)]) / grid.dy
}

/// Neumann graph stencil: missing neighbors contribute neither off-diagonal
/// nor diagonal coefficients. This is exactly divergence(gradient(pressure)).
pub(super) fn pressure_stencil(grid: &Grid, p: &[f64], i: usize, j: usize) -> (f64, f64) {
    let ax = grid.dx.recip().powi(2);
    let ay = grid.dy.recip().powi(2);
    let mut sum = 0.0;
    let mut diagonal = 0.0;
    if i > 0 {
        sum += ax * p[grid.cell(i - 1, j)];
        diagonal += ax;
    }
    if i + 1 < grid.nx {
        sum += ax * p[grid.cell(i + 1, j)];
        diagonal += ax;
    }
    if j > 0 {
        sum += ay * p[grid.cell(i, j - 1)];
        diagonal += ay;
    }
    if j + 1 < grid.ny {
        sum += ay * p[grid.cell(i, j + 1)];
        diagonal += ay;
    }
    (sum, diagonal)
}

pub(super) fn project(grid: &Grid, state: &mut State, iterations: u32) {
    grid.walls(state);
    let mut rhs = vec![0.0; grid.cells()];
    let mut next = vec![0.0; grid.cells()];
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            rhs[grid.cell(i, j)] = divergence(grid, state, i, j) / DT;
        }
    }
    let mean = rhs.iter().sum::<f64>() / grid.cells() as f64;
    rhs.iter_mut().for_each(|v| *v -= mean);
    state.pressure.fill(0.0);
    for _ in 0..iterations {
        for j in 0..grid.ny {
            for i in 0..grid.nx {
                let k = grid.cell(i, j);
                let (sum, diagonal) = pressure_stencil(grid, &state.pressure, i, j);
                let jacobi = (sum - rhs[k]) / diagonal;
                // Damping removes the undamped Neumann checkerboard mode.
                next[k] = state.pressure[k] / 3.0 + (2.0 / 3.0) * jacobi;
            }
        }
        std::mem::swap(&mut state.pressure, &mut next);
    }
    let pressure_mean = state.pressure.iter().sum::<f64>() / grid.cells() as f64;
    state.pressure.iter_mut().for_each(|p| *p -= pressure_mean);
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            let gradient =
                (state.pressure[grid.cell(i, j)] - state.pressure[grid.cell(i - 1, j)]) / grid.dx;
            state.u[grid.u(i, j)] -= DT * gradient;
        }
    }
    for j in 1..grid.ny {
        for i in 0..grid.nx {
            let gradient =
                (state.pressure[grid.cell(i, j)] - state.pressure[grid.cell(i, j - 1)]) / grid.dy;
            state.v[grid.v(i, j)] -= DT * gradient;
        }
    }
}
