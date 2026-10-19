use time::{
    DirectionalSourceTrims, DirectionalVideoSourceTimeOptions, MediaTime, directional_source_trims,
    resolve_directional_video_source_time, reverse_audio_samples,
};

fn t(value: i64) -> MediaTime {
    MediaTime::from_ticks(value)
}
fn options() -> DirectionalVideoSourceTimeOptions {
    DirectionalVideoSourceTimeOptions {
        clip_time: t(0),
        clip_duration: t(120_000),
        trim_start: t(240_000),
        playback_rate: 1.0,
        reverse: true,
        freeze_frame: None,
        source_duration: Some(t(600_000)),
    }
}

#[test]
fn reverse_traverses_the_same_trimmed_half_open_interval_at_every_rate() {
    for rate in [0.01, 0.5, 1.0, 2.0, 5.0] {
        let span = (120_000.0_f64 * rate).round() as i64;
        let mut input = DirectionalVideoSourceTimeOptions {
            playback_rate: rate,
            source_duration: Some(t(1_000_000)),
            ..options()
        };
        assert_eq!(
            resolve_directional_video_source_time(input),
            Some(t(240_000 + span - 1))
        );
        let mut previous = 240_000 + span;
        for tick in [0, 1, 12_000, 60_000, 119_999] {
            input.clip_time = t(tick);
            let source = resolve_directional_video_source_time(input)
                .unwrap()
                .as_ticks();
            assert!(source >= 240_000 && source < 240_000 + span);
            assert!(source <= previous);
            previous = source;
        }
    }
}

#[test]
fn directional_mapping_rejects_outside_clip_and_honours_absolute_freeze() {
    for invalid in [-1, 120_000, i64::MAX] {
        assert!(
            resolve_directional_video_source_time(DirectionalVideoSourceTimeOptions {
                clip_time: t(invalid),
                ..options()
            })
            .is_none()
        );
    }
    for tick in [0, 60_000, 119_999] {
        assert_eq!(
            resolve_directional_video_source_time(DirectionalVideoSourceTimeOptions {
                clip_time: t(tick),
                freeze_frame: Some(t(300_000)),
                ..options()
            }),
            Some(t(300_000))
        );
    }
    assert!(
        resolve_directional_video_source_time(DirectionalVideoSourceTimeOptions {
            source_duration: Some(t(300_000)),
            ..options()
        })
        .is_none()
    );
}

#[test]
fn playback_handle_mapping_is_an_involution_for_split_and_resize() {
    let input = DirectionalSourceTrims {
        trim_start: t(120_000),
        trim_end: t(360_000),
        reverse: true,
    };
    let mapped = directional_source_trims(input).unwrap();
    assert_eq!(
        (mapped.trim_start, mapped.trim_end),
        (t(360_000), t(120_000))
    );
    assert_eq!(directional_source_trims(mapped), Some(input));
    assert!(
        directional_source_trims(DirectionalSourceTrims {
            trim_start: t(-1),
            ..input
        })
        .is_none()
    );
}

#[test]
fn pcm_reverse_preserves_length_silence_and_exact_sample_order() {
    assert_eq!(
        reverse_audio_samples(vec![0.1, -0.2, 0.3, 0.4]),
        vec![0.4, 0.3, -0.2, 0.1]
    );
    assert_eq!(reverse_audio_samples(vec![0.0; 7]), vec![0.0; 7]);
    assert!(reverse_audio_samples(vec![]).is_empty());
}
