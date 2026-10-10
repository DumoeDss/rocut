use super::*;
use effects::{CanvasPreparation, EffectPass, UniformValue};

fn native_estimate(dimensions: [u32; 2], duration: u64) -> CanvasPreparationBudget {
    native_estimate_grid(dimensions, duration, 8, 4000)
}
fn native_estimate_grid(
    dimensions: [u32; 2],
    duration: u64,
    grid: u32,
    sampled: u64,
) -> CanvasPreparationBudget {
    let encode = |value: f64| {
        UniformValue::Vector(
            (0..4)
                .map(|i| ((value.to_bits() >> (i * 16)) & 65535) as f32)
                .collect(),
        )
    };
    let parameters = [
        ("version", 1.0),
        ("columns", grid as f64),
        ("rows", grid as f64),
        ("durationTicks", duration as f64),
        ("seed", 17.0),
        ("drying", 2.0),
        ("diffusion", 2.0),
        ("weaveFrequency", 9.0),
        ("weaveHeight", 0.01),
        ("lightX", 0.4),
        ("lightY", 0.2),
        ("lightZ", 1.0),
        ("relief", 2.0),
        ("strokeCount", 0.0),
        ("sampledTicks", sampled as f64),
    ];
    let pass = EffectPass {
        shader: "canvas".into(),
        uniforms: parameters
            .into_iter()
            .map(|(k, v)| (k.into(), encode(v)))
            .collect(),
    };
    let bytes = (u64::from(dimensions[0]) * u64::from(dimensions[1]) * 4) as usize;
    // Genuine estimator/decode/strict parse; no constructed leaf budget positive.
    CanvasPreparation::estimate(&pass, dimensions, bytes).unwrap()
}
#[test]
fn padded_rgba_layout_is_checked_and_exact() {
    let a = capture_layout(7, [65, 3]).unwrap();
    assert_eq!(a.position, 7);
    assert_eq!(
        (a.tight_row, a.padded_row, a.tight_bytes, a.padded_bytes),
        (260, 512, 780, 1536)
    );
    assert_eq!(a.capture_charge, 4 * 780 + 2 * 1536);
    assert!(capture_layout(0, [1025, 16300]).is_err());
    for dimensions in [
        [0, 1],
        [1, 0],
        [16385, 1],
        [16384, 16384],
        [u32::MAX, u32::MAX],
    ] {
        assert!(capture_layout(0, dimensions).is_err());
    }
    assert!(checked_sum(u64::MAX, 1).is_err());
}
#[test]
fn every_equal_or_duplicate_position_is_retained_and_charged() {
    let budget = native_estimate([16, 12], 120000);
    let mut frame = CanvasFrameCaptureBudget::new(8192).unwrap();
    let initial = frame.totals().frame_peak_bytes;
    for position in [5, 5, 9] {
        frame.add(position, [16, 12], &budget).unwrap();
    }
    assert_eq!(
        frame
            .positions()
            .iter()
            .map(|p| p.position)
            .collect::<Vec<_>>(),
        vec![5, 5, 9]
    );
    let total = frame.totals();
    assert_eq!(total.positions, 3);
    assert_eq!(total.preparation_peak_bytes, 3 * budget.peak_bytes);
    assert_eq!(total.work, 3 * budget.work);
    assert_eq!(
        total.frame_peak_bytes,
        initial + total.preparation_peak_bytes + total.capture_peak_bytes
    );
}
#[test]
fn bad_admission_or_frame_limit_rejection_is_transactional() {
    let budget = native_estimate([16, 12], 120000);
    let mut frame = CanvasFrameCaptureBudget::new(0).unwrap();
    frame.add(1, [16, 12], &budget).unwrap();
    let prior = frame.totals();
    let positions = frame.positions().to_vec();
    let mut forged = budget;
    forged.peak_bytes = 0;
    assert!(frame.add(2, [16, 12], &forged).is_err());
    assert!(frame.add(2, [0, 12], &budget).is_err());
    assert_eq!(frame.totals(), prior);
    assert_eq!(frame.positions(), positions);
    let metadata = std::mem::size_of::<CanvasFrameCaptureBudget>() as u64
        + (MAX_CANVAS_FRAME_POSITIONS * std::mem::size_of::<CanvasCaptureLayout>()) as u64;
    let mut limit = CanvasFrameCaptureBudget::new(MAX_CANVAS_FRAME_BYTES - metadata).unwrap();
    assert!(limit.add(0, [16, 12], &budget).is_err());
    assert_eq!(limit.totals().positions, 0);
    assert!(CanvasFrameCaptureBudget::new(u64::MAX).is_err());
}
#[test]
fn whole_frame_source_capture_limit_is_not_only_cpu_preparation_limit() {
    let budget = native_estimate([4096, 4096], 120000);
    assert!(budget.peak_bytes <= MAX_CANVAS_PREPARATION_BYTES);
    let mut frame = CanvasFrameCaptureBudget::new(0).unwrap();
    assert!(frame.add(0, [4096, 4096], &budget).is_err());
    assert!(frame.positions().is_empty());
}
#[test]
fn many_native_positions_reject_without_deduplicating() {
    let budget = native_estimate([1, 1], 120000);
    let mut frame = CanvasFrameCaptureBudget::new(0).unwrap();
    for position in 0..MAX_CANVAS_FRAME_POSITIONS {
        frame.add(position, [1, 1], &budget).unwrap();
    }
    assert!(frame.add(64, [1, 1], &budget).is_err());
    assert_eq!(frame.totals().positions, 64);
}
#[test]
fn native_work_limit_rejection_is_transactional() {
    let budget = native_estimate_grid([1, 1], 7_200_000, 64, 7_200_000);
    let admitted = MAX_CANVAS_FRAME_WORK / budget.work;
    assert!(admitted > 0 && admitted < MAX_CANVAS_FRAME_POSITIONS as u64);
    let mut frame = CanvasFrameCaptureBudget::new(0).unwrap();
    // No activity filter exists here: the caller also submits inactive positions.
    for position in 0..admitted {
        frame.add(position as usize, [1, 1], &budget).unwrap();
    }
    let prior = frame.totals();
    let positions = frame.positions().to_vec();
    assert!(frame.add(admitted as usize, [1, 1], &budget).is_err());
    assert_eq!(frame.totals(), prior);
    assert_eq!(frame.positions(), positions);
}
