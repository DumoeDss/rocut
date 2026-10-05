use time::{
    FrameGridClip, FrameGridOptions, FrameGridResult, FrameRate, MediaTime, plan_frame_grid,
};
fn t(value: i64) -> MediaTime {
    MediaTime::from_ticks(value)
}
fn clip(id: &str, start: i64, duration: i64) -> FrameGridClip {
    FrameGridClip {
        id: id.into(),
        start: t(start),
        duration: t(duration),
        trim_start: t(0),
        trim_end: t(0),
        source_duration: None,
        playback_rate: 1.0,
        freeze_frame: None,
    }
}
fn plan(clips: Vec<FrameGridClip>, rate: FrameRate) -> FrameGridResult {
    plan_frame_grid(FrameGridOptions {
        frame_rate: rate,
        clips,
        markers: vec![t(120_000)],
    })
}
#[test]
fn shared_boundaries_stay_adjacent_and_no_end_is_extended() {
    let FrameGridResult::Ready { clips, markers } = plan(
        vec![clip("a", 0, 120_000), clip("b", 120_000, 120_000)],
        FrameRate::FPS_29_97,
    ) else {
        panic!("expected plan")
    };
    assert_eq!((clips[0].start, clips[0].duration), (t(0), t(116_116)));
    assert_eq!(
        (clips[1].start, clips[1].duration),
        (t(116_116), t(120_120))
    );
    assert_eq!(clips[0].start + clips[0].duration, clips[1].start);
    assert_eq!(markers, vec![t(116_116)]);
    assert!(clips[1].start + clips[1].duration <= t(240_000));
}
#[test]
fn source_span_caps_duration_without_crossing_a_source_boundary() {
    let mut input = clip("video", 120_000, 120_000);
    input.source_duration = Some(t(120_000));
    let FrameGridResult::Ready { clips, .. } = plan(vec![input], FrameRate::FPS_29_97) else {
        panic!("expected plan")
    };
    assert_eq!(clips[0].duration, t(116_116));
}
#[test]
fn retimed_sources_and_freeze_holds_use_the_existing_source_clock() {
    let mut slow = clip("slow", 120_000, 240_000);
    slow.source_duration = Some(t(120_000));
    slow.playback_rate = 0.5;
    let mut held = clip("hold", 0, 1_200_000);
    held.source_duration = Some(t(120_000));
    held.freeze_frame = Some(t(119_999));
    let FrameGridResult::Ready { clips, .. } = plan(vec![slow, held], FrameRate::FPS_29_97) else {
        panic!("expected plan")
    };
    assert!(clips[0].duration <= t(240_000));
    assert_eq!(clips[1].duration, t(1_197_196));
}
#[test]
fn aligns_all_fields_for_each_supported_rate_and_preserves_aligned_input() {
    for rate in [
        FrameRate::FPS_23_976,
        FrameRate::FPS_24,
        FrameRate::FPS_25,
        FrameRate::FPS_29_97,
        FrameRate::FPS_30,
        FrameRate::FPS_59_94,
        FrameRate::FPS_60,
    ] {
        let mut input = clip("clip", 120_000, 240_000);
        input.trim_start = t(120_000);
        input.trim_end = t(240_000);
        let FrameGridResult::Ready { clips, markers } = plan(vec![input], rate) else {
            panic!("expected plan")
        };
        let step = rate.ticks_per_frame().unwrap();
        for value in [
            clips[0].start,
            clips[0].duration,
            clips[0].trim_start,
            clips[0].trim_end,
            markers[0],
        ] {
            assert_eq!(value.as_ticks() % step, 0);
        }
        if rate == FrameRate::FPS_30 {
            assert_eq!(clips[0].duration, t(240_000));
            assert_eq!(clips[0].start, t(120_000));
        }
    }
}
#[test]
fn rejects_collapsed_invalid_and_overflowing_clips_instead_of_deleting_them() {
    for input in [
        clip("short", 0, 1000),
        clip("negative", -1, 120_000),
        clip("zero", 0, 0),
        clip("huge", 9_007_199_254_740_991, 120_000),
    ] {
        assert!(matches!(
            plan(vec![clip("valid", 0, 120_000), input], FrameRate::FPS_24),
            FrameGridResult::Rejected { .. }
        ));
    }
    assert!(matches!(
        plan(
            vec![clip("dup", 0, 120_000), clip("dup", 120_000, 120_000)],
            FrameRate::FPS_30
        ),
        FrameGridResult::Rejected { .. }
    ));
    assert!(matches!(
        plan(vec![], FrameRate::new(90, 1)),
        FrameGridResult::Rejected { .. }
    ));
}
#[test]
fn invalid_source_and_markers_fail_closed() {
    let mut source = clip("source", 0, 120_000);
    source.source_duration = Some(t(1000));
    assert!(matches!(
        plan(vec![source], FrameRate::FPS_30),
        FrameGridResult::Rejected { .. }
    ));
    assert!(matches!(
        plan_frame_grid(FrameGridOptions {
            frame_rate: FrameRate::FPS_30,
            clips: vec![],
            markers: vec![t(-1)]
        }),
        FrameGridResult::Rejected { .. }
    ));
}
