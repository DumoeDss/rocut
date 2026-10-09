use super::model::NativeClip;
use super::rate_loop;
use super::rate_prepare;
use crate::programmatic_audio::envelope::Point;
use serde_json::json;

fn native() -> NativeClip {
    serde_json::from_value(json!({"start":0.1,"end":1.7,"duration":1.6,
        "mediaStart":0.1,"sourceDuration":0.35,"playbackRate":1,"rate":1,
        "loop":true,"volume":1,"fades":{"fadeIn":0,"fadeOut":0},"volumeKeyframes":null}))
    .unwrap()
}

#[test]
fn rate_loop_keeps_unmodified_full_native_ramp_after_canonical_source_stage() {
    let points: Vec<Point> = serde_json::from_value(json!([
        {"t":0,"v":0.5},{"t":1.13,"v":2}
    ]))
    .unwrap();
    for sample_rate in [44100, 48000] {
        let mut clip = native();
        let looped = rate_prepare::prepare(&clip, &points, sample_rate).unwrap();
        let source = looped.source_loop.as_ref().unwrap();
        // Independent real-media oracle A9DgQH, original core 0.8.139 clock.
        assert_eq!(source.source_frames, 103813);
        assert_eq!(source.period_frames, 12000);
        assert_eq!(source.repeat_count, 8);
        assert_eq!(source.max_wav_bytes, 103813 * 8 + 65536);
        assert!(source.working_set_bytes > 4 * 103813 * 8 + 2 * 12000 * 8);
        assert!(
            source
                .stereo_filter
                .ends_with("aloop=loop=8:size=12000,atrim=end_sample=103813,asetpts=N/SR/TB")
        );
        assert!(source.mono_filter.contains("pan=stereo|FL=FL+FC|FR=FR+FC,"));
        assert_eq!(looped.media_start_seconds, "0");
        assert_eq!(source.media_start_seconds, "0.1");
        clip.r#loop = false;
        let nonloop = rate_prepare::prepare(&clip, &points, sample_rate).unwrap();
        assert_eq!(looped.profile, nonloop.profile);
        assert_eq!(looped.stereo_filter, nonloop.stereo_filter);
        assert_eq!(looped.mono_filter, nonloop.mono_filter);
        assert_eq!(
            looped.source_duration_seconds,
            nonloop.source_duration_seconds
        );
        assert_eq!(looped.resample_filter, nonloop.resample_filter);
        assert_eq!(nonloop.media_start_seconds, "0.1");
        assert!(nonloop.source_loop.is_none());
    }
}

#[test]
fn rate_loop_preserves_both_native_and_graph_fractional_phase_gates() {
    for period in [0.25 + 1.0 / 44100.0, 0.25 + 1.0 / 48000.0] {
        let mut clip = native();
        clip.source_duration = clip.media_start + period;
        assert!(
            rate_loop::prepare(&clip, 1.0, 44100)
                .unwrap_err()
                .contains("fractional-sample")
        );
    }
    let mut clip = native();
    clip.start = 1.0 / 44100.0;
    assert!(
        rate_loop::prepare(&clip, 1.0, 44100)
            .unwrap_err()
            .contains("fractional-sample")
    );
    for end in [0.0, 0.1, f64::INFINITY, f64::NAN] {
        clip = native();
        clip.source_duration = end;
        assert!(rate_loop::prepare(&clip, 1.0, 48000).is_err());
    }
}

#[test]
fn rate_loop_bounds_full_consumed_source_and_tile_before_host_execution() {
    let mut clip = native();
    for consumed in [0.0, f64::NAN, f64::INFINITY, 400.0] {
        assert!(
            rate_loop::prepare(&clip, consumed, 48000)
                .unwrap_err()
                .contains("budget")
        );
    }
    clip.source_duration = 400.1;
    assert!(
        rate_loop::prepare(&clip, 1.0, 48000)
            .unwrap_err()
            .contains("budget")
    );
    clip = native();
    clip.source_duration = clip.media_start + 1.0 / 48000.0;
    let tiny = rate_loop::prepare(&clip, 16.0 / 48000.0, 48000).unwrap();
    assert_eq!(tiny.period_frames, 1);
    assert_eq!(tiny.repeat_count, 15);
    assert!(!tiny.stereo_filter.contains("loop=-1"));
}
