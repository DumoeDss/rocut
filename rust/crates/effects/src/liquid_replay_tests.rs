use crate::liquid_catalog::{MAX_TICKS, STEP_TICKS};
use crate::liquid_sim::{Config, Event, State};
use crate::{liquid_replay, liquid_sim};

#[path = "liquid_replay_job_tests.rs"]
mod job_tests;

fn config() -> Config {
    Config {
        columns: 8,
        rows: 8,
        viscosity: 0.0,
        velocity_damping: 0.0,
        dye_dissipation: 0.0,
        pressure_iterations: 4,
        diffusion_iterations: 2,
        vorticity: 0.0,
    }
}

fn event(at_ticks: u64) -> Event {
    Event {
        at_ticks,
        center: [0.5, 0.5],
        radius: 2.0,
        velocity: [0.0, 0.0],
        dye: 0.1,
    }
}

fn simulate(config: &Config, events: &[Event], elapsed: u64) -> State {
    liquid_replay::simulate(config, events, [640, 360], elapsed, 10_000, || false).unwrap()
}

#[test]
fn replay_uses_floor_steps_and_half_open_event_intervals() {
    let config = config();
    let events: Vec<_> = [0, 999, 1_000, 1_999, 2_000, 2_999].map(event).into();
    for (elapsed, count) in [
        (0, 0),
        (999, 0),
        (1_000, 2),
        (1_999, 2),
        (2_000, 4),
        (2_999, 4),
        (3_000, 6),
    ] {
        let state =
            liquid_replay::simulate(&config, &events, [64, 64], elapsed, 3_000, || false).unwrap();
        for j in 0..8 {
            for i in 0..8 {
                let distance = ((i as f64 + 0.5) / 8.0 - 0.5).hypot((j as f64 + 0.5) / 8.0 - 0.5);
                let q = 1.0 - distance / 2.0;
                let expected = f64::from(count) * 0.1 * q * q * (3.0 - 2.0 * q);
                assert!(
                    (state.dye()[j * 8 + i] - expected).abs() < 1e-14,
                    "elapsed {elapsed}, count {count}"
                );
            }
        }
        assert!(state.u().iter().chain(state.v()).all(|v| *v == 0.0));
    }
}

#[test]
fn final_partial_step_does_not_advance_or_consume_its_events() {
    let config = config();
    let events = [event(1_499)];
    let state =
        liquid_replay::simulate(&config, &events, [64, 64], 1_500, 1_500, || false).unwrap();
    assert_eq!(state, liquid_sim::initialize(&config, [1.0, 1.0]).unwrap());
}

#[test]
fn budget_charges_the_full_declared_duration_even_at_zero_elapsed() {
    let heavy = Config {
        columns: 64,
        rows: 64,
        pressure_iterations: 80,
        diffusion_iterations: 24,
        viscosity: 0.02,
        vorticity: 4.0,
        ..config()
    };
    assert!(liquid_replay::validate_budget(&heavy, 16, STEP_TICKS).is_ok());
    assert!(liquid_replay::validate_budget(&config(), 0, MAX_TICKS).is_ok());
    assert!(
        liquid_replay::validate_budget(&heavy, 0, MAX_TICKS)
            .unwrap_err()
            .contains("work budget")
    );
    for elapsed in [0, 999, 1_000] {
        let mut cancellation_calls = 0;
        let error = liquid_replay::simulate(&heavy, &[], [64, 64], elapsed, MAX_TICKS, || {
            cancellation_calls += 1;
            false
        })
        .unwrap_err();
        assert!(error.contains("work budget"));
        assert_eq!(cancellation_calls, 0);
    }
    for duration in [0, STEP_TICKS - 1, MAX_TICKS + 1, u64::MAX] {
        assert!(liquid_replay::validate_budget(&config(), 0, duration).is_err());
    }
    assert!(liquid_replay::validate_budget(&config(), 17, STEP_TICKS).is_err());
}

#[test]
fn invalid_dimensions_age_order_and_terminal_events_are_rejected() {
    for dimensions in [[0, 360], [640, 0], [0, 0]] {
        assert!(liquid_replay::simulate(&config(), &[], dimensions, 0, 2_000, || false).is_err());
    }
    assert!(liquid_replay::simulate(&config(), &[], [64, 64], 2_001, 2_000, || false).is_err());
    for events in [vec![event(2_000)], vec![event(1_000), event(999)]] {
        assert!(liquid_replay::simulate(&config(), &events, [64, 64], 0, 2_000, || false).is_err());
    }
}

#[test]
fn all_future_event_payloads_are_validated_even_before_the_first_step() {
    let valid = event(1_500);
    let invalid = [
        Event {
            center: [f64::NAN, 0.5],
            ..valid
        },
        Event {
            center: [0.5, 1.1],
            ..valid
        },
        Event {
            radius: 0.0,
            ..valid
        },
        Event {
            radius: f64::INFINITY,
            ..valid
        },
        Event {
            velocity: [3.01, 0.0],
            ..valid
        },
        Event {
            velocity: [0.0, f64::NEG_INFINITY],
            ..valid
        },
        Event { dye: -0.1, ..valid },
        Event {
            dye: f64::NAN,
            ..valid
        },
    ];
    for event in invalid {
        for elapsed in [0, 999, 1_000] {
            assert!(
                liquid_replay::simulate(&config(), &[event], [64, 64], elapsed, 2_000, || false)
                    .is_err(),
                "invalid future event accepted at {elapsed}: {event:?}"
            );
        }
    }
}

#[test]
fn cancellation_before_and_during_replay_publishes_no_partial_state() {
    let config = config();
    let events = [Event {
        velocity: [0.8, -0.2],
        ..event(0)
    }];
    let error =
        liquid_replay::simulate(&config, &events, [640, 360], 5_000, 10_000, || true).unwrap_err();
    assert!(error.contains("Cancelled"));
    let mut calls = 0;
    let error = liquid_replay::simulate(&config, &events, [640, 360], 5_000, 10_000, || {
        calls += 1;
        calls == 3
    })
    .unwrap_err();
    assert!(error.contains("Cancelled"));
    assert_eq!(calls, 3);
    assert_eq!(
        simulate(&config, &events, 5_000),
        simulate(&config, &events, 5_000)
    );
}

#[test]
fn repeated_scrubbing_and_different_inputs_do_not_share_replay_state() {
    let config = config();
    let events = [
        Event {
            radius: 0.3,
            velocity: [1.0, -0.4],
            ..event(0)
        },
        event(2_000),
    ];
    let earlier = simulate(&config, &events, 2_000);
    let later = simulate(&config, &events, 8_000);
    assert_ne!(earlier, later);
    assert_eq!(simulate(&config, &events, 2_999), earlier);
    assert_eq!(simulate(&config, &events, 8_999), later);
    let portrait =
        liquid_replay::simulate(&config, &events, [360, 640], 2_000, 10_000, || false).unwrap();
    assert_eq!(portrait.domain(), [1.0, 640.0 / 360.0]);
    assert_ne!(portrait, earlier);
    let damped = Config {
        velocity_damping: 4.0,
        ..config
    };
    assert_ne!(simulate(&damped, &events, 2_000), earlier);
    assert_eq!(simulate(&config, &events, 2_000), earlier);
}

#[test]
fn replay_is_reentrant_even_inside_a_cancellation_callback() {
    let config = config();
    let events = [Event {
        radius: 0.3,
        velocity: [0.9, 0.4],
        ..event(0)
    }];
    let mut nested = None;
    let outer = liquid_replay::simulate(&config, &events, [640, 360], 5_000, 10_000, || {
        if nested.is_none() {
            nested = Some(simulate(&config, &events, 2_000));
        }
        false
    })
    .unwrap();
    assert_eq!(nested.unwrap(), simulate(&config, &events, 2_000));
    assert_eq!(outer, simulate(&config, &events, 5_000));
}
