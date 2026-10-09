use super::*;

#[test]
fn neumann_laplacian_matches_staggered_divergence_of_gradient() {
    let config = Config {
        columns: 13,
        rows: 9,
        ..config()
    };
    let grid = Grid::new(&config, [3.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    let p: Vec<_> = (0..grid.cells())
        .map(|k| (k as f64 * 0.731).sin())
        .collect();
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] = (p[grid.cell(i, j)] - p[grid.cell(i - 1, j)]) / grid.dx;
        }
    }
    for j in 1..grid.ny {
        for i in 0..grid.nx {
            state.v[grid.v(i, j)] = (p[grid.cell(i, j)] - p[grid.cell(i, j - 1)]) / grid.dy;
        }
    }
    let mut total_divergence = 0.0;
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            let (sum, diagonal) = solve::pressure_stencil(&grid, &p, i, j);
            let expected = sum - diagonal * p[grid.cell(i, j)];
            let actual = solve::divergence(&grid, &state, i, j);
            close(actual, expected, 2e-13);
            total_divergence += actual;
        }
    }
    close(total_divergence, 0.0, 1e-12);
}

#[test]
fn projection_reduces_divergence_on_non_square_grid_and_preserves_walls() {
    let config = config();
    let grid = Grid::new(&config, [3.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    forces::inject(&grid, &mut state, &[impulse()]);
    let before = divergence_norm(&grid, &state);
    solve::project(&grid, &mut state, config.pressure_iterations);
    let after = divergence_norm(&grid, &state);
    assert!(before > 0.0);
    assert!(after < before * 0.35, "divergence {before} -> {after}");
    close(state.pressure.iter().sum::<f64>(), 0.0, 1e-10);
    state.validate(&config, grid.domain).unwrap();
}

#[test]
fn projection_damps_the_neumann_checkerboard_mode() {
    let config = Config {
        columns: 8,
        rows: 8,
        ..config()
    };
    let grid = Grid::new(&config, [1.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] = if (i + j) % 2 == 0 { 1.0 } else { -1.0 };
        }
    }
    let before = divergence_norm(&grid, &state);
    solve::project(&grid, &mut state, 80);
    assert!(divergence_norm(&grid, &state) < before * 0.01);
}

#[test]
fn implicit_viscosity_matches_a_discrete_eigenmode_and_free_slip() {
    let config = Config {
        viscosity: 0.02,
        ..config()
    };
    let grid = Grid::new(&config, [2.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] = (std::f64::consts::PI * i as f64 / grid.nx as f64).sin();
        }
    }
    let before = state.clone();
    solve::diffuse(&grid, &mut state, &config);
    let lambda = 4.0
        * (std::f64::consts::PI / (2.0 * grid.nx as f64))
            .sin()
            .powi(2)
        / grid.dx.powi(2);
    let multiplier = 1.0 / (1.0 + config.viscosity * DT * lambda);
    for j in 0..grid.ny {
        for i in 0..=grid.nx {
            close(
                state.u[grid.u(i, j)],
                before.u[grid.u(i, j)] * multiplier,
                1e-12,
            );
        }
    }
    assert!(energy(&state) < energy(&before));
    state.validate(&config, grid.domain).unwrap();
}

#[test]
fn rk2_velocity_advection_matches_a_linear_characteristic() {
    let config = config();
    let grid = Grid::new(&config, [2.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    let slope = 0.8;
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] = slope * grid.u_position(i, j)[0];
        }
    }
    transport::velocity(&grid, &mut state).unwrap();
    let factor = 1.0 - DT * slope + 0.5 * (DT * slope).powi(2);
    for j in 0..grid.ny {
        for i in 3..grid.nx - 3 {
            close(
                state.u[grid.u(i, j)],
                slope * grid.u_position(i, j)[0] * factor,
                1e-14,
            );
        }
    }
}
