use super::*;
use crate::liquid_replay::{LiquidReplayError, LiquidReplayJob, estimate_memory_bytes};
use std::num::NonZeroU64;
use time::replay::ReplayError;

fn quota(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).unwrap()
}

fn bits(state: &State) -> Vec<u64> {
    state
        .domain()
        .into_iter()
        .chain(state.u().iter().copied())
        .chain(state.v().iter().copied())
        .chain(state.pressure().iter().copied())
        .chain(state.dye().iter().copied())
        .map(f64::to_bits)
        .collect()
}

#[test]
fn chunked_liquid_is_bitwise_equal_for_events_remainders_and_reverse_seek() {
    let config = Config {
        viscosity: 0.01,
        vorticity: 1.0,
        velocity_damping: 0.3,
        dye_dissipation: 0.2,
        ..config()
    };
    let events: Vec<_> = [0, 999, 1_000, 1_000, 1_999, 2_000, 8_999]
        .map(|at_ticks| Event {
            radius: 0.3,
            velocity: [0.7, -0.4],
            ..event(at_ticks)
        })
        .into();
    for elapsed in [9_999, 3_000, 2_999, 1_000, 999, 0, 10_000] {
        let expected = bits(&simulate(&config, &events, elapsed));
        for size in [1, 2, 7, 0] {
            let mut job =
                LiquidReplayJob::new(&config, &events, [640, 360], elapsed, 10_000, || false)
                    .unwrap();
            let mut random = 73_u64;
            let mut previous = 0;
            loop {
                random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
                let count = if size == 0 { 1 + random % 7 } else { size };
                let progress = job.advance(quota(count), || false).unwrap();
                assert!(progress.executed_steps - previous <= count);
                previous = progress.executed_steps;
                if progress.is_complete() {
                    break;
                }
            }
            assert_eq!(bits(&job.finish(|| false).unwrap()), expected);
        }
    }
}

#[test]
fn request_owns_configuration_and_events_and_no_other_request_state() {
    fn send_and_static<T: Send + 'static>() {}
    send_and_static::<LiquidReplayJob>();
    let mut config = config();
    let mut events = vec![Event {
        velocity: [0.6, 0.2],
        radius: 0.3,
        ..event(0)
    }];
    let expected = bits(&simulate(&config, &events, 8_000));
    let mut job =
        LiquidReplayJob::new(&config, &events, [640, 360], 8_000, 10_000, || false).unwrap();
    config.velocity_damping = 4.0;
    events[0].dye = 0.9;
    assert_ne!(bits(&simulate(&config, &events, 8_000)), expected);
    drop(events);
    while !job.advance(quota(2), || false).unwrap().is_complete() {}
    assert_eq!(bits(&job.finish(|| false).unwrap()), expected);
}

#[test]
fn native_second_thread_cancels_an_actual_liquid_job_after_positive_progress() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    };
    use std::time::Duration;

    let config = config();
    let events = [Event {
        radius: 0.3,
        velocity: [0.7, -0.4],
        ..event(0)
    }];
    let mut job =
        LiquidReplayJob::new(&config, &events, [640, 360], 10_000, 10_000, || false).unwrap();
    let cancelled = AtomicBool::new(false);
    let (started_tx, started_rx) = mpsc::channel();
    let (cancelled_tx, cancelled_rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let cancel_flag = &cancelled;
        scope.spawn(move || {
            assert!(started_rx.recv_timeout(Duration::from_secs(5)).unwrap() > 0);
            cancel_flag.store(true, Ordering::Release);
            cancelled_tx.send(()).unwrap();
        });
        let progress = job
            .advance(quota(2), || cancelled.load(Ordering::Acquire))
            .unwrap();
        assert_eq!(progress.executed_steps, 2);
        assert!(!progress.is_complete());
        started_tx.send(progress.executed_steps).unwrap();
        cancelled_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(
            job.advance(quota(7), || cancelled.load(Ordering::Acquire))
                .unwrap_err()
                .is_cancelled()
        );
    });
    assert_eq!(
        job.finish(|| false).unwrap_err(),
        LiquidReplayError::Replay(ReplayError::JobTerminated)
    );
    assert_eq!(
        bits(&simulate(&config, &events, 10_000)),
        bits(&simulate(&config, &events, 10_000))
    );
}

#[test]
fn typed_new_advance_and_finish_failures_never_publish_partial_fluid() {
    let config = config();
    let events = [event(0)];
    let cancelled =
        LiquidReplayJob::new(&config, &events, [64, 64], 4_000, 10_000, || true).unwrap_err();
    assert!(cancelled.is_cancelled());
    let mut calls = 0;
    assert!(
        LiquidReplayJob::new(&config, &events, [64, 64], 4_000, 10_000, || {
            calls += 1;
            calls == 2
        })
        .unwrap_err()
        .is_cancelled()
    );
    let mut job =
        LiquidReplayJob::new(&config, &events, [64, 64], 4_000, 10_000, || false).unwrap();
    let progress = job.advance(quota(2), || false).unwrap();
    assert_eq!(progress.executed_steps, 2);
    assert!(!progress.is_complete());
    assert!(job.advance(quota(7), || true).unwrap_err().is_cancelled());
    assert_eq!(
        job.finish(|| false).unwrap_err(),
        LiquidReplayError::Replay(ReplayError::JobTerminated)
    );
    let job = LiquidReplayJob::new(&config, &events, [64, 64], 4_000, 10_000, || false).unwrap();
    let incomplete = job.finish(|| false).unwrap_err();
    assert_eq!(
        incomplete,
        LiquidReplayError::Replay(ReplayError::Incomplete)
    );
    assert!(!incomplete.is_cancelled());
    let mut job =
        LiquidReplayJob::new(&config, &events, [64, 64], 4_000, 10_000, || false).unwrap();
    assert!(job.advance(quota(7), || false).unwrap().is_complete());
    assert!(job.finish(|| true).unwrap_err().is_cancelled());
    assert_eq!(
        bits(&simulate(&config, &events, 4_000)),
        bits(&simulate(&config, &events, 4_000))
    );
}

#[test]
fn new_preserves_full_duration_and_future_event_admission_before_callbacks() {
    let heavy = Config {
        columns: 64,
        rows: 64,
        pressure_iterations: 80,
        diffusion_iterations: 24,
        viscosity: 0.02,
        vorticity: 4.0,
        ..config()
    };
    let invalid = Event {
        dye: f64::NAN,
        ..event(9_000)
    };
    for (config, events, duration) in [
        (&heavy, &[][..], MAX_TICKS),
        (&config(), &[invalid][..], 10_000),
    ] {
        let mut calls = 0;
        let error = LiquidReplayJob::new(config, events, [64, 64], 0, duration, || {
            calls += 1;
            false
        })
        .unwrap_err();
        assert!(matches!(error, LiquidReplayError::Invalid(_)));
        assert_eq!(calls, 0);
    }
    let empty = estimate_memory_bytes(&config(), 0).unwrap();
    let full = estimate_memory_bytes(&config(), 16).unwrap();
    assert!(full >= empty);
    assert!(full <= crate::liquid_catalog::MAX_MEMORY);
    assert!(estimate_memory_bytes(&config(), 17).is_err());
    assert!(
        estimate_memory_bytes(
            &Config {
                columns: 0,
                ..config()
            },
            0
        )
        .is_err()
    );
}
