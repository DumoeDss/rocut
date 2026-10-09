use super::{MapState, ReadbackGuard, ReadbackLayout, ReadbackProgress};

#[test]
fn strips_padding_preserving_rows_hidden_rgb_and_bgra_channels() {
    for width in [1, 62, 64, 93] {
        let layout = ReadbackLayout::new(width, 2, 4096, 1 << 26).unwrap();
        assert_eq!((layout.width, layout.height), (width, 2));
        let mut bytes = vec![253; layout.buffer_size as usize];
        for (row, rgba) in [[134, 0, 32, 41], [50, 150, 250, 0]]
            .into_iter()
            .enumerate()
        {
            for pixel in
                bytes[row * layout.stride as usize..][..width as usize * 4].chunks_exact_mut(4)
            {
                pixel.copy_from_slice(&rgba);
            }
        }
        let rgba = layout.unpack(&bytes, false).unwrap();
        assert_eq!(rgba.len(), width as usize * 8);
        assert_eq!(&rgba[..4], &[134, 0, 32, 41]);
        assert_eq!(&rgba[width as usize * 4..][..4], &[50, 150, 250, 0]);
        let bgra = layout.unpack(&bytes, true).unwrap();
        assert_eq!(&bgra[..4], &[32, 0, 134, 41]);
        assert_eq!(&bgra[width as usize * 4..][..4], &[250, 150, 50, 0]);
        assert!(layout.unpack(&bytes[..bytes.len() - 1], false).is_err());
    }
}

#[test]
fn rejects_zero_overflow_device_and_diagnostic_allocation_limits() {
    for (width, height, max_dimension, max_buffer) in [
        (0, 2, 4096, u64::MAX),
        (2, 0, 4096, u64::MAX),
        (4097, 1, 4096, u64::MAX),
        (1, 4097, 4096, u64::MAX),
        (u32::MAX, 1, u32::MAX, u64::MAX),
        (u32::MAX / 4, 1, u32::MAX, u64::MAX),
        (4096, 4097, 8192, u64::MAX),
        (93, 62, 4096, 31_743),
    ] {
        assert!(ReadbackLayout::new(width, height, max_dimension, max_buffer).is_err());
    }
    let layout = ReadbackLayout::new(93, 62, 4096, 31_744).unwrap();
    assert_eq!(layout.stride, 512);
    assert_eq!(layout.buffer_size, 31_744);
}

#[test]
fn pending_guard_survives_rejected_overlap_and_releases_on_error() {
    assert!(!ReadbackGuard::is_active());
    let first = ReadbackGuard::acquire().unwrap();
    assert!(ReadbackGuard::acquire().is_err());
    assert!(ReadbackGuard::is_active());
    drop(first);
    let result: Result<(), &str> = (|| {
        let _guard = ReadbackGuard::acquire()?;
        Err("mapping failed or timed out")
    })();
    assert!(result.is_err());
    assert!(!ReadbackGuard::is_active());
    assert!(ReadbackGuard::acquire().is_ok());
}

#[test]
fn completion_is_single_settlement_and_late_callbacks_cannot_revive_closed_state() {
    let mut state = MapState::default();
    state.settle(Err("device lost".into()));
    state.settle(Ok(()));
    assert_eq!(state.result, Some(Err("device lost".into())));
    state.close();
    assert!(state.result.is_none());
    assert!(state.settle(Ok(())).is_none());
    assert!(state.settle(Err("late rejection".into())).is_none());
    assert!(state.tick().is_none());
    assert!(state.result.is_none());
    assert!(!state.timer_ready);
}

#[test]
fn deadlines_and_poll_budget_reject_a_never_completing_mapping() {
    let mut progress = ReadbackProgress::new(200.0).unwrap();
    assert!(progress.check(10_199.0).is_ok());
    assert!(progress.check(10_200.0).is_err());
    assert!(progress.check(f64::NAN).is_err());
    assert!(ReadbackProgress::new(f64::INFINITY).is_err());
    assert!(progress.should_poll(false));
    assert!(!progress.should_poll(false));
    for _ in 1..2_500 {
        assert!(progress.check(201.0).is_ok());
        assert!(progress.should_poll(true));
    }
    assert!(progress.check(201.0).is_err());
}

#[test]
fn timeout_and_mapping_error_release_guard_and_close_late_completions() {
    for mapping_error in [false, true] {
        let mut state = MapState::default();
        let outcome: Result<(), String> = (|| {
            let _guard = ReadbackGuard::acquire().unwrap();
            let progress = ReadbackProgress::new(0.0).unwrap();
            if mapping_error {
                state.settle(Err("mapping rejected".into()));
            }
            let result = progress
                .check(if mapping_error { 1.0 } else { 10_000.0 })
                .map_err(str::to_owned)
                .and_then(|()| state.result.take().unwrap());
            state.close();
            result
        })();
        assert!(outcome.is_err());
        assert!(!ReadbackGuard::is_active());
        state.settle(Ok(()));
        state.tick();
        assert!(state.result.is_none());
        assert!(!state.timer_ready);
    }
}
