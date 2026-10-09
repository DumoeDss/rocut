use super::export_timing::{start_sample, trim_frames};
use super::model::NativeClip;
use crate::programmatic_audio::timing::AudioTiming::{NativeExporter, SampleAligned};
use serde_json::json;

fn native(duration: f64) -> NativeClip {
    serde_json::from_value(json!({"start":0,"end":duration,"duration":duration,
        "mediaStart":0,"sourceDuration":1,"playbackRate":1,"rate":1,"loop":false,
        "volume":1,"fades":{"fadeIn":0,"fadeOut":0},"volumeKeyframes":null}))
    .unwrap()
}

#[test]
fn js_half_boundaries_and_all_aligned_starts_use_the_selected_mode() {
    for (start, at_44, at_48) in [
        (0.0, 0, 0),
        (0.00049, 0, 0),
        (0.0005, 44, 48),
        (0.00051, 44, 48),
        (f64::from_bits(0x3f40624dd2f1a9fb), 0, 0),
        (1.0 / 44100.0, 0, 0),
        (0.015, 661, 720),
        (3.05, 134504, 146400),
        (86400.0, 3810240000, 4147199744),
    ] {
        assert_eq!(start_sample(NativeExporter, start, 44100).unwrap(), at_44);
        assert_eq!(start_sample(NativeExporter, start, 48000).unwrap(), at_48);
    }
    assert_eq!(
        start_sample(SampleAligned, 1.0 / 44100.0, 44100).unwrap(),
        1
    );
    assert!(start_sample(SampleAligned, 0.00051, 44100).is_err());
}

#[test]
fn timing_never_admits_negative_nonfinite_or_out_of_policy_start() {
    for start in [-1.0, -f64::from_bits(1), f64::NAN, f64::INFINITY, 86400.001] {
        assert!(start_sample(NativeExporter, start, 44100).is_err());
    }
    assert!(start_sample(NativeExporter, 0.1, 96000).is_err());
}

#[test]
fn trim_uses_native_six_decimal_time_then_nearest_sample_not_buffer_ceil() {
    let clip = native(0.1 + 0.25 / 48000.0);
    assert_eq!(trim_frames(SampleAligned, &clip, 0.0, 44100).unwrap(), None);
    assert_eq!(
        trim_frames(NativeExporter, &clip, 0.0, 44100).unwrap(),
        Some(4410)
    );
    assert_eq!(
        trim_frames(NativeExporter, &clip, 0.1, 44100).unwrap(),
        Some(8820)
    );
    // Exact 6-decimal formatter must not quantize directly on the sample grid.
    let below = native(0.00003125);
    assert_eq!(
        trim_frames(NativeExporter, &below, 0.0, 48000).unwrap(),
        Some(1)
    );
    assert_eq!((below.duration * 48000.0).round() as u64, 2);
    let zero = native(0.0000001);
    assert_eq!(
        trim_frames(NativeExporter, &zero, 0.0, 44100).unwrap(),
        Some(0)
    );
}
