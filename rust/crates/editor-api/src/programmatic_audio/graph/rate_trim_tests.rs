use super::model::NativeClip;
use super::rate_prepare::prepare;
use crate::programmatic_audio::envelope::Point;
use serde_json::json;

fn native() -> NativeClip {
    serde_json::from_value(json!({
        "start":0.1,"end":0.83,"duration":0.73,"mediaStart":0.1,
        "sourceDuration":4,"playbackRate":1,"rate":1,"loop":false,"volume":1,
        "fades":{"fadeIn":0,"fadeOut":0},"volumeKeyframes":null
    }))
    .unwrap()
}

fn points() -> Vec<Point> {
    serde_json::from_value(json!([
        {"t":0,"v":0.7,"curve":0.4},{"t":0.81,"v":1.8}
    ]))
    .unwrap()
}

#[test]
fn fractional_nonloop_trim_preserves_original_parameter_and_complete_recipe() {
    // Actual JS String values, including the time-parser/sample half boundary
    // distinguished by the pinned native FFmpeg fractional oracle.
    let trims = [
        (0.10001041875000001, "0.10001041875000001"),
        (0.10001134013605442, "0.10001134013605442"),
        (0.000001, "0.000001"),
        (0.0000001, "1e-7"),
        (f64::from_bits(1), "5e-324"),
        (-0.0, "0"),
    ];
    for sample_rate in [44100, 48000] {
        let points = points();
        let baseline = prepare(&native(), &points, sample_rate).unwrap();
        for (trim, expected) in trims {
            let mut clip = native();
            clip.media_start = trim;
            let prepared = prepare(&clip, &points, sample_rate).unwrap();
            assert_eq!(prepared.media_start_seconds, expected);
            assert_eq!(prepared.duration_seconds, "0.73");
            assert_eq!(
                prepared.source_duration_seconds,
                baseline.source_duration_seconds
            );
            assert_eq!(prepared.stereo_filter, baseline.stereo_filter);
            assert_eq!(prepared.mono_filter, baseline.mono_filter);
            assert_eq!(prepared.resample_filter, baseline.resample_filter);
            assert_eq!(prepared.native_max_bytes, baseline.native_max_bytes);
            assert!(prepared.source_loop.is_none());
        }
    }
}

#[test]
fn fractional_trim_does_not_relax_loop_phase_or_invalid_timing() {
    let points = points();
    for sample_rate in [44100, 48000] {
        let mut clip = native();
        clip.media_start = 0.1 + 0.5001 / 48000.0;
        clip.r#loop = true;
        // Keep the period aligned: fractional trim selects a native source clock.
        clip.source_duration = clip.media_start + 0.25;
        let fractional = prepare(&clip, &points, sample_rate).unwrap();
        let clock = fractional.source_loop.unwrap().native_buffer_clock.unwrap();
        assert_eq!(clock.segments[0].media_start_seconds, clip.media_start);
        clip.media_start = 0.1;
        clip.duration += 0.25 / f64::from(sample_rate);
        let prepared = prepare(&clip, &points, sample_rate).unwrap();
        assert!(prepared.observed_pcm);
        assert!(prepared.source_loop.is_some());
        assert_eq!(prepared.duration_seconds, clip.duration.to_string());
        assert_eq!(prepared.resample_filter, format!("aresample={sample_rate}"));
    }
    for trim in [
        -1.0,
        f64::NAN,
        f64::INFINITY,
        crate::programmatic_audio::MAX_SECONDS + 1.0,
    ] {
        let mut clip = native();
        clip.media_start = trim;
        assert!(
            prepare(&clip, &points, 48000)
                .unwrap_err()
                .contains("media trim")
        );
    }
}

#[test]
fn scalar_fractional_preparation_keeps_native_parameters_and_output_filter_policy() {
    use super::rate_prepare::{needs_scalar_preparation, prepare_scalar};
    use crate::programmatic_audio::timing::AudioTiming::SampleAligned;
    for sample_rate in [44100, 48000] {
        for rate in [1.0, 1.5, 0.25, 4.0] {
            let mut clip = native();
            clip.media_start = 0.1 + 0.25 / f64::from(sample_rate);
            clip.duration = 0.5 + 0.25 / f64::from(sample_rate);
            clip.playback_rate = rate;
            assert!(needs_scalar_preparation(&clip, sample_rate));
            let prepared = prepare_scalar(&clip, sample_rate, SampleAligned).unwrap();
            assert_eq!(prepared.preparation_kind, "scalar");
            assert_eq!(prepared.media_start_seconds, clip.media_start.to_string());
            assert_eq!(
                prepared.source_duration_seconds,
                (clip.duration * rate).to_string()
            );
            assert_eq!(prepared.duration_seconds, clip.duration.to_string());
            assert_eq!(prepared.output_duration_required, rate != 1.0);
            assert!(prepared.observed_pcm);
            assert!(prepared.source_loop.is_none());
            assert_eq!(prepared.slices, 0);
            assert_eq!(prepared.clock_cells, 0);
            assert_eq!(prepared.resample_filter, format!("aresample={sample_rate}"));
            assert!(
                prepared
                    .mono_filter
                    .starts_with("pan=stereo|FL=FL+FC|FR=FR+FC")
            );
            assert!(!prepared.stereo_filter.contains("asplit"));
            assert!(!prepared.resample_filter.contains("apad"));
        }
    }
}

#[test]
fn scalar_loop_fractional_duration_retains_raw_source_materialization_before_prepare() {
    use super::rate_prepare::prepare_scalar;
    use crate::programmatic_audio::timing::AudioTiming::SampleAligned;
    for sample_rate in [44100, 48000] {
        let mut clip = native();
        clip.r#loop = true;
        clip.source_duration = 0.35;
        clip.duration = 0.5 + 0.25 / f64::from(sample_rate);
        let prepared = prepare_scalar(&clip, sample_rate, SampleAligned).unwrap();
        assert_eq!(prepared.media_start_seconds, "0");
        let source = prepared.source_loop.unwrap();
        assert_eq!(source.media_start_seconds, "0.1");
        assert_eq!(source.period_frames, 12000);
        assert!(prepared.observed_pcm);
        // Fractional period chooses original native scheduling instead of aloop.
        clip.source_duration += 0.25 / 48000.0;
        let fractional = prepare_scalar(&clip, sample_rate, SampleAligned).unwrap();
        assert!(
            fractional
                .source_loop
                .unwrap()
                .native_buffer_clock
                .is_some()
        );
    }
}
