use time::{
    AudioClipSampleTimesOptions, AudioMixWindowOptions, AudioSampleWindowOptions, MediaTime,
    audio_clip_sample_times, plan_audio_mix_window, plan_audio_sample_window,
};

fn t(value: i64) -> MediaTime {
    MediaTime::from_ticks(value)
}

#[test]
fn decimal_range_does_not_lose_first_sample_and_end_is_exclusive() {
    let window = plan_audio_sample_window(AudioSampleWindowOptions {
        start_time: t(14_400),
        duration: t(28_800),
        sample_rate: 44_100,
    })
    .unwrap();
    assert_eq!(
        (window.sample_origin, window.output_length),
        (5292.0, 10584)
    );
    let mix = plan_audio_mix_window(AudioMixWindowOptions {
        clip_start: t(24_000),
        clip_duration: t(14_400),
        sample_origin: window.sample_origin,
        output_length: window.output_length,
        sample_rate: 44_100,
    })
    .unwrap();
    assert_eq!((mix.start, mix.end), (3528, 8820));
}

#[test]
fn fractional_frame_ranges_partition_the_same_absolute_grid() {
    for sample_rate in [10, 44_100, 48_000, 96_000] {
        let range = |start, duration| {
            plan_audio_sample_window(AudioSampleWindowOptions {
                start_time: t(start),
                duration: t(duration),
                sample_rate,
            })
            .unwrap()
        };
        let first = range(0, 4004);
        let second = range(4004, 4004);
        let full = range(0, 8008);
        assert_eq!(first.output_length as f64, second.sample_origin);
        assert_eq!(
            first.output_length + second.output_length,
            full.output_length
        );
    }
}

#[test]
fn full_partial_and_chunk_boundaries_have_bit_identical_sample_times() {
    for sample_rate in [44_100, 48_000, 96_000] {
        let options = AudioClipSampleTimesOptions {
            clip_start: t(24_001),
            sample_origin: 19200.0,
            sample_count: 4096,
            sample_rate,
        };
        let full = audio_clip_sample_times(options);
        let part = audio_clip_sample_times(AudioClipSampleTimesOptions {
            sample_origin: 20001.0,
            sample_count: 801,
            ..options
        });
        assert_eq!(full[801..1602], part);
    }
    let times = audio_clip_sample_times(AudioClipSampleTimesOptions {
        clip_start: t(24_001),
        sample_origin: 8821.0,
        sample_count: 2,
        sample_rate: 44_100,
    });
    assert_eq!(times, vec![253.0 / 17_640_000.0, 653.0 / 17_640_000.0]);
}

#[test]
fn boundaries_before_and_after_output_are_clipped_without_underflow() {
    for (start, duration, expected) in [
        (0, 12000, (0, 0)),
        (24000, 12000, (4410, 4410)),
        (0, 48000, (0, 4410)),
        (18000, 0, (2205, 2205)),
    ] {
        let mix = plan_audio_mix_window(AudioMixWindowOptions {
            clip_start: t(start),
            clip_duration: t(duration),
            sample_origin: 4410.0,
            output_length: 4410,
            sample_rate: 44100,
        })
        .unwrap();
        assert_eq!((mix.start, mix.end), expected);
    }
}

#[test]
fn rejects_invalid_rates_ranges_samples_and_unbounded_batches() {
    for (start, duration, rate) in [
        (-1, 1, 44100),
        (0, -1, 44100),
        (0, 1, 0),
        (0, 1, 384001),
        (i64::MAX, 1, 44100),
        (0, i64::MAX, 44100),
    ] {
        assert!(
            plan_audio_sample_window(AudioSampleWindowOptions {
                start_time: t(start),
                duration: t(duration),
                sample_rate: rate,
            })
            .is_none()
        );
    }
    for origin in [-1.0, 0.5, f64::NAN, f64::INFINITY, 9007199254740992.0] {
        assert!(
            audio_clip_sample_times(AudioClipSampleTimesOptions {
                clip_start: t(0),
                sample_origin: origin,
                sample_count: 1,
                sample_rate: 44100,
            })
            .is_empty()
        );
    }
    assert!(
        audio_clip_sample_times(AudioClipSampleTimesOptions {
            clip_start: t(0),
            sample_origin: 0.0,
            sample_count: 4097,
            sample_rate: 44100,
        })
        .is_empty()
    );
}
