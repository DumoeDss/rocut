use time::{
    ClipTransitionOptions, FrameRate, MediaTime, TransitionClip, TransitionPlanError,
    TransitionSource, VideoSourceTimeOptions, plan_clip_transition, resolve_video_source_time,
};

fn tick(value: i64) -> MediaTime {
    MediaTime::from_ticks(value)
}
fn video(trim: i64, duration: i64, rate: f64) -> TransitionSource {
    TransitionSource::Video {
        trim_start: tick(trim),
        source_duration: tick(duration),
        playback_rate: rate,
        freeze_frame: None,
    }
}
fn options() -> ClipTransitionOptions {
    ClipTransitionOptions {
        outgoing: TransitionClip {
            id: "left".into(),
            track_id: "main".into(),
            start: tick(0),
            duration: tick(360_000),
            source: video(120_000, 720_000, 1.0),
        },
        incoming: TransitionClip {
            id: "right".into(),
            track_id: "main".into(),
            start: tick(360_000),
            duration: tick(360_000),
            source: video(120_000, 600_000, 1.0),
        },
        duration_frames: 30,
        frame_rate: FrameRate::FPS_30,
    }
}
fn failure(options: ClipTransitionOptions, expected: TransitionPlanError) {
    assert_eq!(plan_clip_transition(options).unwrap_err(), expected);
}

#[test]
fn centered_window_reads_both_real_source_handles_without_ripple() {
    let input = options();
    let plan = plan_clip_transition(input.clone()).unwrap();
    let window = plan.window();
    assert_eq!(
        (window.start, window.cut, window.end),
        (tick(300_000), tick(360_000), tick(420_000))
    );
    let first = plan.sample(window.start).unwrap();
    assert_eq!(first.progress, 0.0);
    assert_eq!(first.outgoing_source, Some(tick(420_000)));
    assert_eq!(first.incoming_source, Some(tick(60_000)));
    let middle = plan.sample(window.cut).unwrap();
    assert_eq!(middle.progress, 0.5);
    assert_eq!(middle.outgoing_source, Some(tick(480_000)));
    assert_eq!(middle.incoming_source, Some(tick(120_000)));
    let last = plan.sample(tick(419_999)).unwrap();
    assert_eq!(last.time, tick(416_000));
    assert_eq!(last.outgoing_source, Some(tick(536_000)));
    assert_eq!(last.incoming_source, Some(tick(176_000)));
    assert!(last.progress < 1.0);
    assert_eq!(input.outgoing.duration, tick(360_000));
    assert_eq!(input.incoming.start, tick(360_000));
    for time in [i64::MIN, 299_999, 420_000, i64::MAX] {
        assert!(plan.sample(tick(time)).is_none());
    }
}

#[test]
fn public_video_mapping_does_not_allow_transition_preroll() {
    for freeze_frame in [None, Some(tick(60_000))] {
        assert_eq!(
            resolve_video_source_time(VideoSourceTimeOptions {
                clip_time: tick(-4_000),
                trim_start: tick(120_000),
                playback_rate: 1.0,
                freeze_frame,
                source_duration: Some(tick(600_000)),
            }),
            None
        );
    }
}

#[test]
fn insufficient_handles_are_errors_not_implicit_freezes() {
    let mut input = options();
    input.outgoing.source = video(120_000, 480_000, 1.0);
    failure(input, TransitionPlanError::MissingOutgoingHandle);
    let mut input = options();
    input.incoming.source = video(0, 600_000, 1.0);
    failure(input, TransitionPlanError::MissingIncomingHandle);
    let mut input = options();
    input.outgoing.source = video(120_000, 536_000, 1.0);
    failure(input, TransitionPlanError::MissingOutgoingHandle);
    let mut input = options();
    input.outgoing.source = video(120_000, 536_001, 1.0);
    assert!(plan_clip_transition(input).is_ok());
}

#[test]
fn retimed_sources_use_shared_rounding_and_project_frame_samples() {
    let mut input = options();
    input.outgoing.source = video(120_000, 1_200_000, 2.0);
    input.incoming.source = video(60_000, 360_000, 0.5);
    let plan = plan_clip_transition(input).unwrap();
    let first = plan.sample(tick(300_000)).unwrap();
    assert_eq!(first.outgoing_source, Some(tick(720_000)));
    assert_eq!(first.incoming_source, Some(tick(30_000)));
    assert_eq!(
        plan.sample(tick(419_999)).unwrap().incoming_source,
        Some(tick(88_000))
    );
}

#[test]
fn images_and_explicit_freezes_need_no_extra_source_frames() {
    let mut input = options();
    input.outgoing.source = TransitionSource::Image;
    input.incoming.source = TransitionSource::Video {
        trim_start: tick(0),
        source_duration: tick(10),
        playback_rate: 1.0,
        freeze_frame: Some(tick(9)),
    };
    let plan = plan_clip_transition(input).unwrap();
    for time in [300_000, 360_000, 419_999] {
        let sample = plan.sample(tick(time)).unwrap();
        assert_eq!(sample.outgoing_source, None);
        assert_eq!(sample.incoming_source, Some(tick(9)));
    }
}

#[test]
fn odd_duration_allocates_extra_frame_after_cut_and_supports_ntsc() {
    for rate in [
        FrameRate::FPS_23_976,
        FrameRate::FPS_29_97,
        FrameRate::FPS_59_94,
    ] {
        let frame = rate.ticks_per_frame().unwrap();
        let mut input = options();
        input.frame_rate = rate;
        input.duration_frames = 31;
        input.outgoing.duration = tick(frame * 90);
        input.incoming.start = input.outgoing.duration;
        input.incoming.duration = tick(frame * 90);
        input.outgoing.source = TransitionSource::Image;
        input.incoming.source = TransitionSource::Image;
        let plan = plan_clip_transition(input).unwrap();
        let window = plan.window();
        assert_eq!(window.cut.as_ticks() - window.start.as_ticks(), frame * 15);
        assert_eq!(window.end.as_ticks() - window.cut.as_ticks(), frame * 16);
        assert!((plan.sample(window.cut).unwrap().progress - 15.0 / 31.0).abs() < 1e-12);
    }
}

#[test]
fn rejects_gaps_overlaps_cross_track_duplicate_and_unaligned_cut() {
    for delta in [-4_000, 4_000] {
        let mut input = options();
        input.incoming.start = tick(360_000 + delta);
        failure(input, TransitionPlanError::NotAdjacent);
    }
    let mut input = options();
    input.incoming.track_id = "overlay".into();
    failure(input, TransitionPlanError::DifferentTracks);
    let mut input = options();
    input.incoming.id = "left".into();
    failure(input, TransitionPlanError::SameClip);
    let mut input = options();
    input.outgoing.duration = tick(360_001);
    input.incoming.start = tick(360_001);
    failure(input, TransitionPlanError::UnalignedCut);
}

#[test]
fn rejects_invalid_timing_and_clip_ranges() {
    for rate in [
        FrameRate::new(0, 1),
        FrameRate::new(1, 0),
        FrameRate::new(7, 3),
    ] {
        let mut input = options();
        input.frame_rate = rate;
        failure(input, TransitionPlanError::InvalidFrameRate);
    }
    for duration in [0, 1] {
        let mut input = options();
        input.duration_frames = duration;
        failure(input, TransitionPlanError::InvalidDuration);
    }
    let mut input = options();
    input.duration_frames = 181;
    failure(input, TransitionPlanError::InsufficientClipDuration);
    for (start, duration) in [
        (-1, 360_000),
        (0, 0),
        (0, -1),
        (i64::MAX, 1),
        (9_007_199_254_740_991, 1),
    ] {
        let mut input = options();
        input.outgoing.start = tick(start);
        input.outgoing.duration = tick(duration);
        failure(input, TransitionPlanError::InvalidClip);
    }
}

#[test]
fn rejects_invalid_media_metadata_and_unsafe_source_ticks() {
    for rate in [0.0, -1.0, 0.009, 5.001, f64::NAN, f64::INFINITY] {
        let mut input = options();
        input.incoming.source = video(120_000, 600_000, rate);
        failure(input, TransitionPlanError::InvalidSource);
    }
    for (trim, duration) in [
        (-1, 600_000),
        (0, 0),
        (0, -1),
        (0, i64::MAX),
        (i64::MAX, 600_000),
    ] {
        let mut input = options();
        input.incoming.source = video(trim, duration, 1.0);
        failure(input, TransitionPlanError::InvalidSource);
    }
    for frame in [-1, 600_000, i64::MAX] {
        let mut input = options();
        input.incoming.source = TransitionSource::Video {
            trim_start: tick(0),
            source_duration: tick(600_000),
            playback_rate: 1.0,
            freeze_frame: Some(tick(frame)),
        };
        failure(input, TransitionPlanError::InvalidSource);
    }
}
