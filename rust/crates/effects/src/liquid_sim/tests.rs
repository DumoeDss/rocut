use super::*;

mod behavior;
mod numerics;
mod sampling;

fn config() -> Config {
    Config {
        columns: 16,
        rows: 12,
        viscosity: 0.0,
        velocity_damping: 0.0,
        dye_dissipation: 0.0,
        pressure_iterations: 80,
        diffusion_iterations: 24,
        vorticity: 0.0,
    }
}

fn impulse() -> Event {
    Event {
        at_ticks: 0,
        center: [0.4, 0.55],
        radius: 0.3,
        velocity: [0.9, -0.4],
        dye: 0.8,
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.16e}, expected {expected:.16e}, tolerance {tolerance:.4e}"
    );
}

fn energy(state: &State) -> f64 {
    state.u.iter().chain(&state.v).map(|v| v * v).sum()
}

fn divergence_norm(grid: &Grid, state: &State) -> f64 {
    let mut sum = 0.0;
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            sum += solve::divergence(grid, state, i, j).powi(2);
        }
    }
    sum.sqrt()
}

#[test]
fn zero_field_is_an_exact_fixed_point() {
    let mut config = config();
    config.viscosity = 0.02;
    config.vorticity = 4.0;
    config.velocity_damping = 10.0;
    config.dye_dissipation = 10.0;
    let mut state = initialize(&config, [2.0, 1.0]).unwrap();
    let zero = state.clone();
    for _ in 0..12 {
        advance(&config, [2.0, 1.0], &mut state, &[]).unwrap();
    }
    assert_eq!(state, zero);
}

#[test]
fn memory_and_work_are_explicit_and_bounded() {
    let mut config = config();
    config.columns = 64;
    config.rows = 64;
    config.viscosity = 0.02;
    config.vorticity = 4.0;
    let cost = resource_estimate(&config, 16).unwrap();
    assert_eq!(cost.state_bytes, 132096);
    assert_eq!(cost.scratch_bytes, 133120);
    assert_eq!(cost.peak_bytes, 397312);
    assert_eq!(cost.step_work, 1520640);
    let state = initialize(&config, [1.0, 1.0]).unwrap();
    assert_eq!(
        state.memory_bytes(),
        Some(cost.state_bytes + std::mem::size_of::<State>() as u64)
    );
    assert!(resource_estimate(&config, 17).is_err());
}

#[test]
fn rejects_invalid_config_events_shape_domain_and_nonfinite_state() {
    let config = config();
    let mut state = initialize(&config, [1.0, 1.0]).unwrap();
    let original = state.clone();
    let mut bad_event = impulse();
    bad_event.velocity[0] = f64::NAN;
    assert!(advance(&config, [1.0, 1.0], &mut state, &[bad_event]).is_err());
    assert_eq!(state, original);
    assert!(
        initialize(
            &Config {
                columns: u32::MAX,
                ..config
            },
            [1.0, 1.0]
        )
        .is_err()
    );
    assert!(
        initialize(
            &Config {
                viscosity: -0.1,
                ..config
            },
            [1.0, 1.0]
        )
        .is_err()
    );
    assert!(
        initialize(
            &Config {
                pressure_iterations: 0,
                ..config
            },
            [1.0, 1.0]
        )
        .is_err()
    );
    for domain in [
        [0.0, 1.0],
        [2.0, 2.0],
        [f64::INFINITY, 1.0],
        [f64::MAX, 1.0],
    ] {
        assert!(initialize(&config, domain).is_err());
    }
    assert!(state.validate(&config, [2.0, 1.0]).is_err());
    state.dye.pop();
    assert!(state.validate(&config, [1.0, 1.0]).is_err());
    state = original;
    state.u[1] = f64::INFINITY;
    assert!(state.validate(&config, [1.0, 1.0]).is_err());
}
