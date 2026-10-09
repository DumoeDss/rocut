use super::*;

#[test]
fn dye_rk2_transport_and_exponential_decay_follow_current_velocity() {
    let config = config();
    let grid = Grid::new(&config, [2.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    let slope = 0.8;
    for j in 0..grid.ny {
        for i in 1..grid.nx {
            state.u[grid.u(i, j)] = slope * grid.u_position(i, j)[0];
        }
        for i in 0..grid.nx {
            state.dye[grid.cell(i, j)] = 1.0 + grid.cell_position(i, j)[0];
        }
    }
    let dissipation = 2.0;
    transport::dye(&grid, &mut state, dissipation).unwrap();
    let factor = 1.0 - DT * slope + 0.5 * (DT * slope).powi(2);
    for j in 0..grid.ny {
        for i in 3..grid.nx - 3 {
            let back_x = grid.cell_position(i, j)[0] * factor;
            close(
                state.dye[grid.cell(i, j)],
                (1.0 + back_x) * (-dissipation * DT).exp(),
                1e-14,
            );
        }
    }
}

#[test]
fn static_dye_decay_and_velocity_damping_are_independent_rates() {
    let config = config();
    let grid = Grid::new(&config, [1.0, 1.0]).unwrap();
    let mut state = initialize(&config, grid.domain).unwrap();
    state.dye.fill(0.7);
    let dye_config = Config {
        dye_dissipation: 3.0,
        velocity_damping: 10.0,
        ..config
    };
    advance(&dye_config, grid.domain, &mut state, &[]).unwrap();
    for value in state.dye() {
        close(*value, 0.7 * (-3.0 * DT).exp(), 1e-15);
    }
    close(energy(&state), 0.0, 0.0);

    let mut undamped = initialize(&config, grid.domain).unwrap();
    let mut damped = undamped.clone();
    advance(&config, grid.domain, &mut undamped, &[impulse()]).unwrap();
    let damping_config = Config {
        velocity_damping: 4.0,
        ..config
    };
    advance(&damping_config, grid.domain, &mut damped, &[impulse()]).unwrap();
    let factor = (-4.0 * DT).exp();
    for (actual, prior) in damped
        .u
        .iter()
        .chain(&damped.v)
        .zip(undamped.u.iter().chain(&undamped.v))
    {
        close(*actual, *prior * factor, 1e-14);
    }
    assert_eq!(damped.pressure(), undamped.pressure());
}

#[test]
fn viscosity_and_vorticity_change_the_actual_velocity_solution() {
    let config = config();
    let grid = Grid::new(&config, [2.0, 1.0]).unwrap();
    let mut plain = initialize(&config, grid.domain).unwrap();
    let mut viscous = plain.clone();
    let mut vortical = plain.clone();
    advance(&config, grid.domain, &mut plain, &[impulse()]).unwrap();
    let viscous_config = Config {
        viscosity: 0.02,
        ..config
    };
    advance(&viscous_config, grid.domain, &mut viscous, &[impulse()]).unwrap();
    let vortical_config = Config {
        vorticity: 4.0,
        ..config
    };
    advance(&vortical_config, grid.domain, &mut vortical, &[impulse()]).unwrap();
    assert!(energy(&viscous) < energy(&plain));
    let difference = vortical
        .u
        .iter()
        .zip(&plain.u)
        .chain(vortical.v.iter().zip(&plain.v))
        .map(|(a, b)| (a - b).abs())
        .sum::<f64>();
    assert!(difference > 1e-5);
    viscous.validate(&viscous_config, grid.domain).unwrap();
    vortical.validate(&vortical_config, grid.domain).unwrap();
}

#[test]
fn identical_ordered_events_replay_bit_for_bit() {
    let config = Config {
        viscosity: 0.015,
        velocity_damping: 0.2,
        dye_dissipation: 0.1,
        vorticity: 2.0,
        ..config()
    };
    let domain = [1.0, 1.7];
    let mut first = initialize(&config, domain).unwrap();
    let mut second = first.clone();
    for step in 0..60 {
        let mut events = Vec::new();
        if step % 7 == 0 {
            events.push(Event {
                at_ticks: step,
                ..impulse()
            });
            events.push(Event {
                at_ticks: step,
                center: [0.7, 0.3],
                velocity: [-0.7, 0.6],
                ..impulse()
            });
        }
        advance(&config, domain, &mut first, &events).unwrap();
        advance(&config, domain, &mut second, &events).unwrap();
        for (a, b) in first
            .u
            .iter()
            .chain(&first.v)
            .chain(&first.pressure)
            .chain(&first.dye)
            .zip(
                second
                    .u
                    .iter()
                    .chain(&second.v)
                    .chain(&second.pressure)
                    .chain(&second.dye),
            )
        {
            assert_eq!(a.to_bits(), b.to_bits());
        }
        first.validate(&config, domain).unwrap();
    }
    assert!(first.dye.iter().any(|v| *v > 0.0));
    assert!(energy(&first) > 0.0);
}

#[test]
fn event_order_and_failed_advance_do_not_mutate_the_input() {
    let config = config();
    let mut state = initialize(&config, [1.0, 1.0]).unwrap();
    let before = state.clone();
    let events = [
        Event {
            at_ticks: 2,
            ..impulse()
        },
        Event {
            at_ticks: 1,
            ..impulse()
        },
    ];
    assert!(advance(&config, [1.0, 1.0], &mut state, &events).is_err());
    assert_eq!(state, before);
}
