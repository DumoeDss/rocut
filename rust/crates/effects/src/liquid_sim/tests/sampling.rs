use super::*;

#[test]
fn bilinear_constant_linear_and_edge_extension() {
    let constant = vec![2.5; 12];
    for p in [[-2.0, 4.0], [1.25, 1.5], [3.0, 0.0]] {
        close(grid::bilinear(&constant, 4, 3, p[0], p[1]), 2.5, 0.0);
    }
    let values: Vec<_> = (0..3)
        .flat_map(|j| (0..4).map(move |i| 2.0 + 3.0 * i as f64 - j as f64))
        .collect();
    close(grid::bilinear(&values, 4, 3, 1.25, 1.5), 4.25, 1e-14);
    close(grid::bilinear(&values, 4, 3, -2.0, 1.5), 0.5, 1e-14);
}

#[test]
fn staggered_sampling_uses_physical_rectangular_spacing() {
    let config = Config {
        columns: 16,
        rows: 8,
        ..config()
    };
    let grid = Grid::new(&config, [4.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    let linear = |p: [f64; 2]| 2.0 + 0.7 * p[0] - 1.3 * p[1];
    for j in 0..grid.ny {
        for i in 0..=grid.nx {
            state.u[grid.u(i, j)] = linear(grid.u_position(i, j));
        }
    }
    for j in 0..=grid.ny {
        for i in 0..grid.nx {
            state.v[grid.v(i, j)] = linear(grid.v_position(i, j));
        }
    }
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            state.dye[grid.cell(i, j)] = linear(grid.cell_position(i, j));
        }
    }
    for p in [[1.12, 0.27], [2.43, 0.71], [0.6, 0.5]] {
        close(grid.sample_u(&state.u, p), linear(p), 1e-14);
        close(grid.sample_v(&state.v, p), linear(p), 1e-14);
        close(grid.sample_cell(&state.dye, p), linear(p), 1e-14);
    }
}

#[test]
fn event_radius_is_circular_in_physical_space_and_dye_is_additive() {
    let config = Config {
        columns: 32,
        rows: 8,
        ..config()
    };
    let grid = Grid::new(&config, [4.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    let event = Event {
        center: [0.5, 0.5],
        radius: 0.8,
        velocity: [3.0, 3.0],
        dye: 1.0,
        ..impulse()
    };
    forces::inject(&grid, &mut state, &[event, event]);
    close(
        state.dye[grid.cell(17, 4)],
        state.dye[grid.cell(16, 5)],
        1e-14,
    );
    assert!(state.dye[grid.cell(16, 4)] > 1.0);
    state.validate(&config, grid.domain).unwrap();
    let wall_event = Event {
        center: [0.0, 0.0],
        ..event
    };
    forces::inject(&grid, &mut state, &[wall_event]);
    state.validate(&config, grid.domain).unwrap();
    assert!(state.u.iter().any(|v| *v > 0.0));
}
