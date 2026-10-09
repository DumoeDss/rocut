use super::{DT, Error, Event, State, grid::Grid};

fn weight(point: [f64; 2], center: [f64; 2], radius: f64) -> f64 {
    let distance = (point[0] - center[0]).hypot(point[1] - center[1]);
    let q = (1.0 - distance / radius).max(0.0);
    q * q * (3.0 - 2.0 * q)
}

pub(super) fn inject(grid: &Grid, state: &mut State, events: &[Event]) {
    for event in events {
        let center = [
            event.center[0] * grid.domain[0],
            event.center[1] * grid.domain[1],
        ];
        for j in 0..grid.ny {
            for i in 1..grid.nx {
                state.u[grid.u(i, j)] +=
                    event.velocity[0] * weight(grid.u_position(i, j), center, event.radius);
            }
        }
        for j in 1..grid.ny {
            for i in 0..grid.nx {
                state.v[grid.v(i, j)] +=
                    event.velocity[1] * weight(grid.v_position(i, j), center, event.radius);
            }
        }
        for j in 0..grid.ny {
            for i in 0..grid.nx {
                state.dye[grid.cell(i, j)] +=
                    event.dye * weight(grid.cell_position(i, j), center, event.radius);
            }
        }
    }
}

pub(super) fn confine(grid: &Grid, state: &mut State, epsilon: f64) -> Result<(), Error> {
    if epsilon == 0.0 {
        return Ok(());
    }
    let mut curl = vec![0.0; grid.cells()];
    let mut fx = vec![0.0; grid.cells()];
    let mut fy = vec![0.0; grid.cells()];
    let uc = |i, j| 0.5 * state.u[grid.u(i, j)] + 0.5 * state.u[grid.u(i + 1, j)];
    let vc = |i, j| 0.5 * state.v[grid.v(i, j)] + 0.5 * state.v[grid.v(i, j + 1)];
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            let (left, right) = (i.saturating_sub(1), (i + 1).min(grid.nx - 1));
            let (down, up) = (j.saturating_sub(1), (j + 1).min(grid.ny - 1));
            curl[grid.cell(i, j)] = (vc(right, j) - vc(left, j)) / (2.0 * grid.dx)
                - (uc(i, up) - uc(i, down)) / (2.0 * grid.dy);
        }
    }
    if curl.iter().any(|v| !v.is_finite()) {
        return Err(Error("liquid curl exceeds numerical arithmetic range"));
    }
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            let k = grid.cell(i, j);
            let (left, right) = (i.saturating_sub(1), (i + 1).min(grid.nx - 1));
            let (down, up) = (j.saturating_sub(1), (j + 1).min(grid.ny - 1));
            let gx = (curl[grid.cell(right, j)].abs() - curl[grid.cell(left, j)].abs())
                / (2.0 * grid.dx);
            let gy =
                (curl[grid.cell(i, up)].abs() - curl[grid.cell(i, down)].abs()) / (2.0 * grid.dy);
            let norm = gx.hypot(gy);
            if !norm.is_finite() {
                return Err(Error(
                    "liquid curl gradient exceeds numerical arithmetic range",
                ));
            }
            if norm > 0.0 {
                let amount = epsilon * grid.dx.min(grid.dy) * curl[k];
                fx[k] = amount * (gy / norm);
                fy[k] = -amount * (gx / norm);
            }
        }
    }
    if fx.iter().chain(&fy).any(|v| !v.is_finite()) {
        return Err(Error(
            "liquid confinement exceeds numerical arithmetic range",
        ));
    }
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] +=
                DT * (0.5 * fx[grid.cell(i - 1, j)] + 0.5 * fx[grid.cell(i, j)]);
        }
    }
    for j in 1..grid.ny {
        for i in 0..grid.nx {
            state.v[grid.v(i, j)] +=
                DT * (0.5 * fy[grid.cell(i, j - 1)] + 0.5 * fy[grid.cell(i, j)]);
        }
    }
    Ok(())
}
