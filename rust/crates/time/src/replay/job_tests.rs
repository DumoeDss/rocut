use super::*;
use std::num::NonZeroU64;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

fn quota(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).unwrap()
}

struct InlineModel<'a> {
    inner: Spring,
    initialized: &'a std::cell::Cell<u64>,
    payload: [u8; 8192],
}

impl ReplayModel for InlineModel<'_> {
    type Parameters = Parameters;
    type State = Particles;
    type Error = &'static str;

    fn identity(&self) -> &ReplayIdentity<Parameters> {
        self.inner.identity()
    }
    fn cost(&self) -> ReplayCost {
        self.inner.cost()
    }
    fn initialize(&self) -> Result<Particles, Self::Error> {
        assert_eq!(self.payload[0], 0);
        self.initialized.set(self.initialized.get() + 1);
        self.inner.initialize()
    }
    fn advance(&self, state: &mut Particles, step: ReplayStep) -> Result<(), Self::Error> {
        self.inner.advance(state, step)
    }
    fn validate_state(&self, state: &Particles, completed_steps: u64) -> Option<u64> {
        self.inner.validate_state(state, completed_steps)
    }
}

#[test]
fn owned_large_nonidentity_inline_storage_is_rejected_before_initialization() {
    let initialized = std::cell::Cell::new(0);
    let model = InlineModel {
        inner: Spring::default(),
        initialized: &initialized,
        payload: [0; 8192],
    };
    assert_eq!(
        model.request_inline_bytes(),
        std::mem::size_of_val(&model) as u64
    );
    assert!(model.request_inline_bytes() > budget().max_state_bytes);
    assert!(matches!(
        ReplayJob::new(model, 0, budget(), None, || false),
        Err(ReplayError::MemoryLimit)
    ));
    assert_eq!(initialized.get(), 0);
}

#[test]
fn borrowed_large_inline_model_preserves_the_exact_legacy_memory_boundary() {
    let initialized = std::cell::Cell::new(0);
    let model = InlineModel {
        inner: Spring::default(),
        initialized: &initialized,
        payload: [0; 8192],
    };
    let original_bound = model.inner.memory_bound(None);
    let limits = ReplayBudget {
        max_state_bytes: original_bound,
        ..budget()
    };
    assert!(matches!(
        replay(
            &model,
            1_000,
            ReplayBudget {
                max_state_bytes: original_bound - 1,
                ..limits
            },
            None,
            || false
        ),
        Err(ReplayError::MemoryLimit)
    ));
    assert_eq!(initialized.get(), 0);
    let sync = replay(&model, 1_000, limits, None, || false).unwrap();
    let mut chunked = ReplayJob::new(&model, 1_000, limits, None, || false).unwrap();
    assert!(chunked.advance(quota(1), || false).unwrap().is_complete());
    assert_eq!(
        chunked.finish(|| false).unwrap().checkpoint.state().bits(),
        sync.checkpoint.state().bits()
    );
    assert_eq!(initialized.get(), 2);
}

#[test]
fn all_chunk_sizes_and_reverse_seeks_are_bitwise_identical() {
    let model = Spring::default();
    for ticks in [70_070, 17_017, 4_004, 999, 0, 120_120] {
        let expected = run(&model, ticks);
        for size in [1, 2, 7, 0] {
            let mut job = ReplayJob::new(&model, ticks, budget(), None, || false).unwrap();
            let mut random = 23_u64;
            loop {
                random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
                let count = if size == 0 { 1 + random % 11 } else { size };
                let before = job.progress().executed_steps;
                let progress = job.advance(quota(count), || false).unwrap();
                assert!(progress.executed_steps - before <= count);
                if progress.is_complete() {
                    break;
                }
            }
            let output = job.finish(|| false).unwrap();
            assert_eq!(
                output.checkpoint.state().bits(),
                expected.checkpoint.state().bits()
            );
            assert_eq!(output.position, expected.position);
            assert_eq!(output.executed_steps, expected.executed_steps);
        }
    }
}

#[test]
fn checkpoint_is_cloned_only_once_across_many_chunks() {
    let model = Spring::default();
    let saved = run(&model, 2_000).checkpoint;
    let original_bits = saved.state().bits();
    test_model::reset_state_clones();
    reset_clone_probe(false);
    let mut job = ReplayJob::new(&model, 80_000, budget(), Some(&saved), || false).unwrap();
    assert_eq!(test_model::state_clones(), 1);
    while !job.advance(quota(1), || false).unwrap().is_complete() {
        assert_eq!(test_model::state_clones(), 1);
        assert_eq!(clone_count(), 0);
    }
    let result = job.finish(|| false).unwrap();
    assert_eq!(test_model::state_clones(), 1);
    assert_eq!(clone_count(), 1);
    assert_eq!(saved.state().bits(), original_bits);
    assert_eq!(result.executed_steps, 78);
}

#[test]
fn new_rejects_limits_initialization_and_cancellation_without_a_job() {
    let model = Spring::default();
    assert!(matches!(
        ReplayJob::new(&model, 0, budget(), None, || true),
        Err(ReplayError::Cancelled)
    ));
    assert_eq!(model.initialized.get(), 0);
    assert!(matches!(
        ReplayJob::new(&model, 10_001_000, budget(), None, || false),
        Err(ReplayError::StepLimit)
    ));
    assert_eq!(model.initialized.get(), 0);
    let failing = Spring {
        fail_init: true,
        ..Spring::default()
    };
    assert!(matches!(
        ReplayJob::new(&failing, 0, budget(), None, || false),
        Err(ReplayError::Model("initialization failed"))
    ));
    assert!(matches!(
        ReplayJob::new(&model, 0, budget(), None, || model.initialized.get() > 0),
        Err(ReplayError::Cancelled)
    ));
    assert_eq!(model.advanced.get(), 0);
}

#[test]
fn advance_failure_or_cancellation_is_terminal_and_finish_is_atomic() {
    for corrupt in [false, true] {
        let mut model = Spring::default();
        let saved = run(&model, 1_000).checkpoint;
        let before = saved.state().bits();
        if corrupt {
            model.corrupt_at = Some(2);
        } else {
            model.fail_at = Some(2);
        }
        let mut job = ReplayJob::new(&model, 6_000, budget(), Some(&saved), || false).unwrap();
        assert!(job.advance(quota(7), || false).is_err());
        assert_eq!(
            job.advance(quota(1), || false),
            Err(ReplayError::JobTerminated)
        );
        assert_eq!(
            job.finish(|| false).unwrap_err(),
            ReplayError::JobTerminated
        );
        assert_eq!(saved.state().bits(), before);
    }
    let model = Spring::default();
    let job = ReplayJob::new(&model, 3_000, budget(), None, || false).unwrap();
    assert_eq!(job.finish(|| false).unwrap_err(), ReplayError::Incomplete);
    let mut job = ReplayJob::new(&model, 3_000, budget(), None, || false).unwrap();
    assert!(!job.advance(quota(1), || false).unwrap().is_complete());
    assert_eq!(job.advance(quota(1), || true), Err(ReplayError::Cancelled));
    assert_eq!(
        job.finish(|| false).unwrap_err(),
        ReplayError::JobTerminated
    );
    let mut job = ReplayJob::new(&model, 3_000, budget(), None, || false).unwrap();
    assert!(job.advance(quota(7), || false).unwrap().is_complete());
    assert_eq!(job.finish(|| true).unwrap_err(), ReplayError::Cancelled);
    reset_clone_probe(true);
    let job = ReplayJob::new(&model, 0, budget(), None, || false).unwrap();
    assert_eq!(
        job.finish(clone_cancelled).unwrap_err(),
        ReplayError::Cancelled
    );
    reset_clone_probe(false);
}

#[test]
fn actual_second_thread_cancels_after_positive_progress_and_preserves_checkpoint() {
    let model = Spring::default();
    let saved = run(&model, 2_000).checkpoint;
    let before = saved.state().bits();
    model.advanced.set(0);
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
        let mut job = ReplayJob::new(&model, 80_000, budget(), Some(&saved), || false).unwrap();
        let mut notified = false;
        let error = job
            .advance(quota(78), || {
                if !notified && model.advanced.get() > 0 {
                    notified = true;
                    started_tx.send(model.advanced.get()).unwrap();
                    cancelled_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                cancelled.load(Ordering::Acquire)
            })
            .unwrap_err();
        assert_eq!(error, ReplayError::Cancelled);
        assert_eq!(job.progress().executed_steps, 1);
        assert_eq!(
            job.finish(|| false).unwrap_err(),
            ReplayError::JobTerminated
        );
    });
    assert_eq!(saved.state().bits(), before);
    assert_eq!(run(&model, 80_000).executed_steps, 80);
}
