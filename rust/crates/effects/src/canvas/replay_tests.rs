use super::*;
use std::num::NonZeroU64;

fn fixture() -> (CanvasConfig, Vec<CanvasStroke>, Vec<[f64; 4]>) {
    let c = CanvasConfig {
        columns: 16,
        rows: 24,
        duration_ticks: 120000,
        seed: 17,
        drying: 2.0,
        diffusion: 2.0,
        weave_frequency: 9.0,
        weave_height: 0.01,
        light: [0.4, 0.2, 1.0],
        relief: 2.0,
    };
    let s = CanvasStroke {
        start_ticks: 12001,
        end_ticks: 60003,
        from: [0.2, 0.5],
        to: [0.8, 0.5],
        radius: 0.15,
        bristles: 5,
        opacity: 0.500125,
        wetness: 1.0,
        thickness: 0.08,
    };
    let mut second = s;
    second.start_ticks = 8001;
    second.end_ticks = 90001;
    second.from = [0.5, 0.2];
    second.to = [0.5, 0.8];
    let p = (0..c.columns * c.rows)
        .map(|i| {
            [
                f64::from(i % c.columns) / f64::from(c.columns),
                0.2,
                0.1,
                1.0,
            ]
        })
        .collect();
    (c, vec![s, second, s], p)
}
fn bits(state: &CanvasState) -> Vec<u64> {
    state
        .cells()
        .iter()
        .flat_map(|cell| {
            cell.pigment
                .into_iter()
                .chain([cell.coverage, cell.wetness, cell.height])
        })
        .map(f64::to_bits)
        .collect()
}
#[test]
fn single_step_chunks_multiple_steps_and_rebuild_are_bit_identical() {
    let (c, s, p) = fixture();
    for (time, numerator, denominator) in [(100000, 30, 1), (16015, 30000, 1001), (240000, 30, 1)] {
        let expected = rebuild(&c, &s, &p, time, numerator, denominator).unwrap();
        for multiplier in [1, 3, 7] {
            let mut job = CanvasReplayJob::new(&c, &s, &p, time, numerator, denominator).unwrap();
            let quota = NonZeroU64::new(job.minimum_step_work().get() * multiplier).unwrap();
            let mut prior = job.progress();
            while !prior.is_complete() {
                let next = job.advance(quota).unwrap();
                assert!(next.completed_ticks > prior.completed_ticks);
                assert!(next.executed_steps > prior.executed_steps);
                assert!(next.executed_steps - prior.executed_steps <= multiplier);
                assert_eq!(next.target_ticks, prior.target_ticks);
                prior = next;
            }
            let actual = job.finish().unwrap();
            assert_eq!(actual.sampled_ticks(), expected.sampled_ticks());
            assert_eq!(bits(&actual), bits(&expected));
            assert_eq!(
                shade(&c, &actual, &p).unwrap(),
                shade(&c, &expected, &p).unwrap()
            );
        }
    }
}
#[test]
fn incomplete_and_too_small_quota_never_publish_or_advance() {
    let (c, s, p) = fixture();
    let mut job = CanvasReplayJob::new(&c, &s, &p, 100000, 30, 1).unwrap();
    let prior = job.progress();
    let too_small = NonZeroU64::new(job.minimum_step_work().get() - 1).unwrap();
    assert!(job.advance(too_small).is_err());
    assert_eq!(job.progress(), prior);
    assert!(NonZeroU64::new(0).is_none());
    assert!(job.finish().is_err());
    let mut job = CanvasReplayJob::new(&c, &s, &p, 100000, 30, 1).unwrap();
    job.advance(job.minimum_step_work()).unwrap();
    assert!(job.finish().is_err());
}
#[test]
fn owned_source_and_schedule_survive_caller_mutation() {
    let (c, mut s, mut p) = fixture();
    let original_p = p.clone();
    let original_s = s.clone();
    let expected = rebuild(&c, &s, &p, 100000, 30, 1).unwrap();
    let mut job = CanvasReplayJob::new(&c, &s, &p, 100000, 30, 1).unwrap();
    p[0][1] = 0.3;
    s[0].opacity = 0.0;
    job.advance(NonZeroU64::MAX).unwrap();
    let actual = job.finish().unwrap();
    assert_eq!(bits(&actual), bits(&expected));
    assert!(shade(&c, &actual, &p).is_err());
    assert!(shade(&c, &actual, &original_p).is_ok());
    assert_ne!(s, original_s);
}
#[test]
fn replay_job_admission_and_memory_include_owned_schedule() {
    let (c, s, p) = fixture();
    let estimate: CanvasReplayEstimate = CanvasReplayJob::estimate(&c, &s).unwrap();
    assert_eq!(
        estimate.peak_bytes,
        16 * 24 * 128
            + s.len() as u64 * std::mem::size_of::<CanvasStroke>() as u64
            + std::mem::size_of::<CanvasReplayJob>() as u64
    );
    let job = CanvasReplayJob::new(&c, &s, &p, 100000, 30, 1).unwrap();
    assert_eq!(job.memory_bytes(), Some(estimate.peak_bytes));
    assert_eq!(job.minimum_step_work().get(), estimate.step_work);
    for time in [-1, 100000] {
        let mut bad = s.clone();
        bad[0].end_ticks = u64::MAX;
        assert!(CanvasReplayJob::new(&c, &bad, &p, time, 30, 1).is_err());
        assert!(CanvasReplayJob::new(&c, &s, &p[..3], time, 30, 1).is_err());
        assert!(CanvasReplayJob::new(&c, &s, &p, time, 90, 1).is_err());
    }
    assert!(CanvasReplayJob::new(&c, &s, &p, i64::MAX, 30, 1).is_err());
}
#[test]
fn reverse_seek_off_grid_ties_and_cancellation_drop_are_request_local() {
    let (c, s, p) = fixture();
    let expected = rebuild(&c, &s, &p, 100000, 30, 1).unwrap();
    for time in [100000, 0, 16000, 100000, -4000, 12000, 11999] {
        let mut job = CanvasReplayJob::new(&c, &s, &p, time, 30, 1).unwrap();
        while !job.progress().is_complete() {
            job.advance(job.minimum_step_work()).unwrap();
        }
        let actual = job.finish().unwrap();
        if time == 100000 {
            assert_eq!(bits(&actual), bits(&expected));
        }
    }
    let mut dropped = CanvasReplayJob::new(&c, &s, &p, 100000, 30, 1).unwrap();
    dropped.advance(dropped.minimum_step_work()).unwrap();
    drop(dropped);
    assert_eq!(
        bits(&rebuild(&c, &s, &p, 100000, 30, 1).unwrap()),
        bits(&expected)
    );
    let mut job = CanvasReplayJob::new(&c, &s, &p, -4000, 30, 1).unwrap();
    assert!(job.progress().is_complete());
    job.advance(job.minimum_step_work()).unwrap();
    assert_eq!(job.finish().unwrap().sampled_ticks(), -4000);
}
