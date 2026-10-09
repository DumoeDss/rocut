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
fn fractional_trim_does_not_relax_loop_duration_or_timing_safety() {
    let points = points();
    for sample_rate in [44100, 48000] {
        let mut clip = native();
        clip.media_start = 0.1 + 0.5001 / 48000.0;
        clip.r#loop = true;
        // Keep the period aligned, so the trim gate itself must reject.
        clip.source_duration = clip.media_start + 0.25;
        assert!(
            prepare(&clip, &points, sample_rate)
                .unwrap_err()
                .contains("media trim")
        );
        clip.r#loop = false;
        clip.duration += 0.25 / f64::from(sample_rate);
        assert!(
            prepare(&clip, &points, sample_rate)
                .unwrap_err()
                .contains("fractional-sample")
        );
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
