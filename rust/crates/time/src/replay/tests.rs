use super::*;

#[path = "replay_test_model.rs"]
mod test_model;
use test_model::{Parameters, Particles, Spring, clone_cancelled, clone_count, reset_clone_probe};

#[path = "job_tests.rs"]
mod job_tests;
fn budget() -> ReplayBudget {
    ReplayBudget {
        max_steps: 10_000,
        max_work: 100_000,
        max_state_bytes: 4_096,
    }
}

fn run(model: &Spring, ticks: u64) -> ReplayOutput<Parameters, Particles> {
    replay(model, ticks, budget(), None, || false).unwrap()
}

fn rejected(model: &Spring, ticks: u64, limits: ReplayBudget, expected: ReplayError<&str>) {
    assert_eq!(
        replay(model, ticks, limits, None, || false).unwrap_err(),
        expected
    );
    assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
}

#[test]
fn fixed_step_updates_a_damped_spring_and_keeps_fractional_time() {
    let mut model = Spring::default();
    model.identity.step.ticks_per_step = 1_200;
    let output = run(&model, 1_799);
    let state = output.checkpoint.state();
    assert_eq!(
        output.position,
        ReplayPosition {
            completed_steps: 1,
            remainder_ticks: 599,
            step_ticks: 1_200,
        }
    );
    assert!((state.velocity[0] + 0.015).abs() < 1e-15);
    assert!((state.position[0] - 0.99985).abs() < 1e-15);
    assert!((state.velocity[1] - 0.0075).abs() < 1e-15);
    assert!((state.position[1] + 0.499925).abs() < 1e-15);
    assert_eq!(model.advanced.get(), 1);
}

#[test]
fn checkpoints_and_unordered_seeks_equal_full_replay_bit_for_bit() {
    let model = Spring::default();
    let checkpoint = run(&model, 4_500).checkpoint;
    let saved_bits = checkpoint.state().bits();
    for tick in [96_000, 5_000, 4_500, 24_024, 4_999, 120_120, 6_001] {
        let resumed = replay(&model, tick, budget(), Some(&checkpoint), || false).unwrap();
        let direct = run(&model, tick);
        assert_eq!(
            resumed.checkpoint.state().bits(),
            direct.checkpoint.state().bits()
        );
        assert_eq!(resumed.position, direct.position);
        assert_eq!(resumed.executed_steps, tick / 1_000 - 4);
        assert_eq!(checkpoint.state().bits(), saved_bits);
    }
    let forward: Vec<_> = [0, 999, 4_004, 17_017, 70_070]
        .map(|t| run(&model, t).checkpoint.state().bits())
        .into();
    for (index, tick) in [0, 999, 4_004, 17_017, 70_070]
        .into_iter()
        .enumerate()
        .rev()
    {
        assert_eq!(run(&model, tick).checkpoint.state().bits(), forward[index]);
    }
    assert_eq!(
        replay(&model, 3_999, budget(), Some(&checkpoint), || false).unwrap_err(),
        ReplayError::CheckpointAhead
    );
}

#[test]
fn rational_frame_ticks_do_not_accumulate_or_round() {
    let model = Spring::default();
    // 30000/1001 fps has exactly 4004 source ticks per frame.
    for (ticks, steps, remainder) in [
        (4_003, 4, 3),
        (4_004, 4, 4),
        (4_005, 4, 5),
        (4_004 * 249, 996, 996),
        (4_004 * 250, 1_001, 0),
        (4_004 * 251, 1_005, 4),
    ] {
        let output = run(&model, ticks);
        assert_eq!(
            (
                output.position.completed_steps,
                output.position.remainder_ticks
            ),
            (steps, remainder)
        );
        assert_eq!(output.checkpoint.state().steps, steps);
    }
}

#[test]
fn every_identity_component_invalidates_a_checkpoint_before_callbacks() {
    let original = Spring::default();
    let saved = run(&original, 4_000).checkpoint;
    for case in 0..10 {
        let mut model = Spring::default();
        match case {
            0 => model.identity.seed += 1,
            1 => model.identity.parameters.spring = 3.0_f64.to_bits(),
            2 => model.identity.parameters.events[0].1 = 0.7_f64.to_bits(),
            3 => model.identity.resources[0].id = "other".into(),
            4 => model.identity.resources[0].sha256[0] ^= 1,
            5 => model.identity.dimensions[0] += 1,
            6 => model.identity.step.ticks_per_step = 1_001,
            7 => model.identity.engine = "other-engine",
            8 => model.identity.version += 1,
            _ => model.cost.step_work += 1,
        }
        assert_eq!(
            replay(&model, 8_000, budget(), Some(&saved), || false).unwrap_err(),
            ReplayError::CheckpointIdentity
        );
        assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
    }
}

#[test]
fn malformed_identity_is_rejected_before_initialization() {
    for case in 0..8 {
        let mut model = Spring::default();
        match case {
            0 => model.identity.engine = "",
            1 => model.identity.version = 0,
            2 => model.identity.dimensions[0] = 0,
            3 => model.identity.dimensions[1] = 0,
            4 => model.identity.step.ticks_per_step = 0,
            5 => model.identity.resources[0].id.clear(),
            6 => model
                .identity
                .resources
                .push(model.identity.resources[0].clone()),
            _ => model.identity.resources.push(ResourceIdentity {
                id: "aaa".into(),
                sha256: [0; 32],
            }),
        }
        rejected(&model, 4_000, budget(), ReplayError::InvalidIdentity);
    }
}

#[test]
fn budgets_reject_before_any_simulation_and_charge_the_checkpoint_clone() {
    rejected(
        &Spring::default(),
        11_000,
        ReplayBudget {
            max_steps: 10,
            ..budget()
        },
        ReplayError::StepLimit,
    );
    rejected(
        &Spring::default(),
        10_000,
        ReplayBudget {
            max_work: 82,
            ..budget()
        },
        ReplayError::WorkLimit,
    );
    let model = Spring::default();
    let fresh_memory = model.memory_bound(None);
    rejected(
        &model,
        0,
        ReplayBudget {
            max_state_bytes: fresh_memory - 1,
            ..budget()
        },
        ReplayError::MemoryLimit,
    );
    let saved = replay(
        &model,
        9_000,
        ReplayBudget {
            max_state_bytes: fresh_memory,
            ..budget()
        },
        None,
        || false,
    )
    .unwrap()
    .checkpoint;
    let resumed_memory = model.memory_bound(Some(&saved));
    model.initialized.set(0);
    model.advanced.set(0);
    assert_eq!(
        replay(
            &model,
            10_000,
            ReplayBudget {
                max_work: 82,
                ..budget()
            },
            Some(&saved),
            || false
        )
        .unwrap_err(),
        ReplayError::WorkLimit
    );
    assert_eq!(
        replay(
            &model,
            10_000,
            ReplayBudget {
                max_state_bytes: resumed_memory - 1,
                ..budget()
            },
            Some(&saved),
            || false
        )
        .unwrap_err(),
        ReplayError::MemoryLimit
    );
    assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
    let admitted = replay(
        &model,
        10_000,
        ReplayBudget {
            max_steps: 10,
            max_work: 83,
            max_state_bytes: resumed_memory,
        },
        Some(&saved),
        || false,
    )
    .unwrap();
    assert_eq!(admitted.executed_steps, 1);
}

#[test]
fn checked_work_and_memory_arithmetic_never_wraps() {
    let mut multiplication = Spring::default();
    multiplication.cost.step_work = u64::MAX;
    rejected(
        &multiplication,
        2_000,
        budget(),
        ReplayError::ArithmeticOverflow,
    );
    let mut addition = Spring::default();
    addition.cost.init_work = u64::MAX;
    rejected(&addition, 1_000, budget(), ReplayError::ArithmeticOverflow);
    let mut memory = Spring::default();
    memory.cost.state_bytes = u64::MAX;
    rejected(&memory, 0, budget(), ReplayError::ArithmeticOverflow);
    let mut model = Spring::default();
    let mut saved = run(&model, 0).checkpoint;
    model.initialized.set(0);
    model.cost.state_bytes = u64::MAX / 2 + 1;
    model.cost.scratch_bytes = 0;
    saved.cost = model.cost;
    assert_eq!(
        replay(&model, 0, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::ArithmeticOverflow
    );
    assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
}

#[test]
fn a_corrupt_checkpoint_or_underdeclared_state_cannot_be_used() {
    let mut model = Spring::default();
    let mut saved = run(&model, 4_000).checkpoint;
    model.initialized.set(0);
    model.advanced.set(0);
    saved.state.steps += 1;
    assert_eq!(
        replay(&model, 5_000, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::InvalidState
    );
    saved.state.steps -= 1;
    for cursor in [0, 2] {
        saved.state.event_cursor = cursor;
        assert_eq!(
            replay(&model, 5_000, budget(), Some(&saved), || false).unwrap_err(),
            ReplayError::InvalidState
        );
    }
    saved.state.event_cursor = 1;
    saved.state.position[0] = f64::NAN;
    assert_eq!(
        replay(&model, 5_000, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::InvalidState
    );
    saved.state.position[0] = 1.0;
    model.cost.state_bytes = 1;
    saved.cost = model.cost;
    assert_eq!(
        replay(&model, 5_000, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::MemoryLimit
    );
    assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
    assert_eq!(
        replay(&model, 0, budget(), None, || false).unwrap_err(),
        ReplayError::MemoryLimit
    );
    assert_eq!(model.advanced.get(), 0);
}

#[test]
fn cancellation_and_model_failures_never_publish_a_partial_checkpoint() {
    let mut model = Spring::default();
    assert_eq!(
        replay(&model, 5_000, budget(), None, || true).unwrap_err(),
        ReplayError::Cancelled
    );
    assert_eq!((model.initialized.get(), model.advanced.get()), (0, 0));
    let saved = run(&model, 2_000).checkpoint;
    let bits = saved.state().bits();
    model.advanced.set(0);
    assert_eq!(
        replay(&model, 8_000, budget(), Some(&saved), || model
            .advanced
            .get()
            == 2)
        .unwrap_err(),
        ReplayError::Cancelled
    );
    assert_eq!(model.advanced.get(), 2);
    assert_eq!(saved.state().bits(), bits);
    model.advanced.set(0);
    assert_eq!(
        replay(&model, 4_000, budget(), Some(&saved), || model
            .advanced
            .get()
            == 2)
        .unwrap_err(),
        ReplayError::Cancelled
    );
    assert_eq!(saved.state().bits(), bits);
    model.fail_at = Some(3);
    assert_eq!(
        replay(&model, 8_000, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::Model("step failed")
    );
    assert_eq!(saved.state().bits(), bits);
    model.fail_at = None;
    model.corrupt_at = Some(2);
    assert_eq!(
        replay(&model, 8_000, budget(), Some(&saved), || false).unwrap_err(),
        ReplayError::InvalidState
    );
    assert_eq!(saved.state().bits(), bits);
    model.fail_init = true;
    assert_eq!(
        replay(&model, 0, budget(), None, || false).unwrap_err(),
        ReplayError::Model("initialization failed")
    );
}

#[test]
fn large_owned_identity_is_rejected_before_initialization_or_clone() {
    for owner in 0..3 {
        let mut model = Spring::default();
        match owner {
            0 => model.identity.parameters.events = vec![(10_000, 1); 65_536],
            1 => model.identity.resources[0].id = "r".repeat(65_536),
            _ => model.identity.resources.reserve_exact(65_536),
        }
        reset_clone_probe(false);
        rejected(&model, 0, budget(), ReplayError::MemoryLimit);
        assert_eq!(clone_count(), 0);
        let limits = ReplayBudget {
            max_state_bytes: model.memory_bound(None),
            ..budget()
        };
        let saved = replay(&model, 0, limits, None, || false)
            .unwrap()
            .checkpoint;
        assert_eq!(clone_count(), 1);
        model.initialized.set(0);
        reset_clone_probe(false);
        assert_eq!(
            replay(&model, 0, limits, Some(&saved), || false).unwrap_err(),
            ReplayError::MemoryLimit
        );
        assert_eq!(
            (clone_count(), model.initialized.get(), model.advanced.get()),
            (0, 0, 0)
        );
    }
}

#[test]
fn cancellation_during_publication_clone_never_returns_success() {
    let mut model = Spring::default();
    model.identity.parameters.events = vec![(10_000, 1); 4_096];
    model.identity.resources[0].id = "texture".repeat(1_024);
    let limits = ReplayBudget {
        max_state_bytes: model.memory_bound(None),
        ..budget()
    };
    reset_clone_probe(true);
    let result = replay(&model, 0, limits, None, clone_cancelled);
    assert_eq!(clone_count(), 1);
    assert!(clone_cancelled());
    reset_clone_probe(false);
    assert_eq!(result.unwrap_err(), ReplayError::Cancelled);
    assert_eq!((model.initialized.get(), model.advanced.get()), (1, 0));
}
