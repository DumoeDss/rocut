use super::fx_automation::admit_fx_automation;
use super::fx_model::FxChain;
use super::model::NativeClip;
use super::rate_clock::{RateClock, rate_at};
use super::rate_prepare::{filter_number, prepare};
use crate::programmatic_audio::envelope::Point;
use serde_json::{Value, json};

fn points(value: Value) -> Vec<Point> {
    serde_json::from_value(value).unwrap()
}
fn native(duration: f64) -> NativeClip {
    serde_json::from_value(
        json!({"start":0,"end":duration,"duration":duration,"mediaStart":0.1,
        "sourceDuration":4,"playbackRate":1,"rate":1,"loop":false,"volume":1,
        "fades":{"fadeIn":0,"fadeOut":0},"volumeKeyframes":null}),
    )
    .unwrap()
}

#[test]
fn rate_clock_matches_actual_pinned_core_for_log_curve_via_and_held_edges() {
    // Independently sampled from imported core 0.8.139 speedRamp.js in the
    // SHA512-verified exporter oracle, not recomputed with this Rust clock.
    let times = [0.0, 0.071, 0.213, 0.451, 0.777, 1.391];
    let cases = [
        (
            json!([{"t":0,"v":0.5},{"t":1.13,"v":2}]),
            [
                0.5,
                0.5455047699587622,
                0.6493153184227947,
                0.8694832187307968,
                1.2970384417324685,
                2.0,
            ],
            [
                0.0,
                0.03709748355226867,
                0.12172889840296545,
                0.3012345823179576,
                0.6497316353419401,
                1.7447690347212594,
            ],
        ),
        (
            json!([{"t":0,"v":2},{"t":0.73,"v":0.5}]),
            [
                2.0,
                1.747726518753369,
                1.334628628764934,
                0.8493220211533231,
                0.5,
                0.5,
            ],
            [
                0.0,
                0.13276698987800598,
                0.3503964836919682,
                0.6059280819726462,
                0.8134304383597515,
                1.1204304383597514,
            ],
        ),
        (
            json!([{"t":0,"v":0.6,"curve":0.7},{"t":0.91,"v":2.1}]),
            [
                0.6,
                0.6008971967317452,
                0.616504391054378,
                0.7302690299145558,
                1.369973547725484,
                2.1,
            ],
            [
                0.0,
                0.042619570566516565,
                0.1287736356611764,
                0.2861323728811249,
                0.6032087599836938,
                1.8386474419628458,
            ],
        ),
        (
            json!([{"t":0,"v":1.9,"viaX":0.32,"viaY":0.8},{"t":1.07,"v":0.7}]),
            [
                1.9,
                1.4298951799753628,
                1.0083135672077064,
                0.7886294997840851,
                0.7123116040325106,
                0.7,
            ],
            [
                0.0,
                0.1165437082475314,
                0.28473668132442953,
                0.49305139972067585,
                0.7346950161672448,
                1.165626834911516,
            ],
        ),
        (
            json!([{"t":0.1,"v":0.7},{"t":0.38,"v":1.8,"curve":-0.5},{"t":0.79,"v":0.9}]),
            [
                0.7,
                0.7,
                1.0247849408505554,
                1.3489707166506255,
                0.9100251152274705,
                0.9,
            ],
            [
                0.0,
                0.04969999999999999,
                0.1663042934621241,
                0.5020877157664788,
                0.8560003031055482,
                1.4086724128740098,
            ],
        ),
    ];
    for (raw, rates, source_times) in cases {
        let points = points(raw);
        let clock = RateClock::new(&points).unwrap();
        for (i, time) in times.into_iter().enumerate() {
            assert!(
                (rate_at(&points, time) - rates[i]).abs() < 2e-14,
                "rate at {time}"
            );
            assert!(
                (clock.source_time_at(time) - source_times[i]).abs() < 2e-14,
                "source at {time}"
            );
        }
    }
}

#[test]
fn rate_prepare_decimal_rounding_matches_js_to_fixed_without_double_rounding() {
    for (value, expected) in [
        (0.0, "0"),
        (0.0000005, "0"),
        (0.0000015, "0.000002"),
        (0.0000025, "0.000003"),
        (1.0000005, "1.000001"),
        (2.0000005, "2.000001"),
        (1.2345645, "1.234565"),
        (1.2345655, "1.234565"),
        (999999.9999995, "999999.999999"),
    ] {
        assert_eq!(filter_number(value), expected);
    }
}

#[test]
fn rate_prepare_preserves_native_tempo_stage_epsilon_at_half_and_double_rate() {
    // Original buildAtempoFilter avoids redundant stages inside these epsilon
    // windows; rounding the final number must not add another stateful atempo.
    for (rate, expected) in [
        (0.5 - 0.5e-9, "atempo=0.5,"),
        (2.0 + 0.5e-9, "atempo=2,"),
        (0.5 - 2e-9, "atempo=0.5,atempo=1,"),
        (2.0 + 4e-9, "atempo=2,atempo=1,"),
    ] {
        let points = points(json!([{"t":0,"v":rate}]));
        let plan = prepare(&native(0.25), &points, 48000).unwrap();
        let stage = plan
            .stereo_filter
            .split("asetpts=PTS-STARTPTS,")
            .nth(1)
            .unwrap();
        assert!(
            stage.starts_with(&format!("{expected}apad,")),
            "rate={rate}: {stage}"
        );
    }
}

#[test]
fn rate_prepare_keeps_native_s16_48k_before_explicit_graph_resampling() {
    let points = points(json!([{"t":0,"v":0.5},{"t":1.13,"v":2}]));
    for sample_rate in [44100, 48000] {
        let plan = prepare(&native(1.13), &points, sample_rate).unwrap();
        assert_eq!(plan.native_sample_rate, 48000);
        assert_eq!(plan.native_max_bytes, (54240 + 1) * 4);
        assert_eq!(plan.slices, 5);
        assert!(
            plan.stereo_filter
                .starts_with("[0:a]asplit=5[s0][s1][s2][s3][s4]")
        );
        assert!(
            plan.stereo_filter
                .contains("apad,asetpts=N/SR/TB,atrim=0:0.226")
        );
        assert!(
            plan.mono_filter
                .ends_with("[cat]pan=stereo|FL=FL+FC|FR=FR+FC[out]")
        );
        assert_eq!(
            plan.resample_filter,
            format!(
                "aresample={sample_rate},apad=whole_len={},atrim=end_sample={}",
                (1.13 * f64::from(sample_rate)).round() as u64,
                (1.13 * f64::from(sample_rate)).round() as u64
            )
        );
    }
}

#[test]
fn rate_prepare_keeps_phase_loop_and_full_history_budget_gates() {
    let points = points(json!([{"t":0,"v":0.5},{"t":1,"v":2}]));
    let mut clip = native(1.0);
    clip.r#loop = true;
    assert!(prepare(&clip, &points, 48000).unwrap_err().contains("loop"));
    clip.r#loop = false;
    clip.media_start = 0.1 + 0.25 / 48000.0;
    assert!(
        prepare(&clip, &points, 48000)
            .unwrap_err()
            .contains("fractional-sample")
    );
    assert!(
        prepare(&native(3600.0), &points, 48000)
            .unwrap_err()
            .contains("budget")
    );
    let capped = prepare(&native(60.0), &points, 48000).unwrap();
    assert_eq!(capped.slices, 240);
}

#[test]
fn rate_lane_normalization_preserves_first_lane_and_native_range_not_decoder_range() {
    let raw = json!({"version":1,"lanes":[
        {"target":"rate","points":[{"t":1,"v":90},{"t":"0x0","v":"0.01"},{"t":1,"v":11}]},
        {"target":"rate","points":[{"t":0,"v":3}]},
        {"target":"volume","points":[{"t":0,"v":0.5}]}]})
    .to_string();
    let admitted = admit_fx_automation(
        Some(&raw),
        &FxChain {
            version: 1,
            nodes: vec![],
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(admitted.rate_points.unwrap()).unwrap(),
        json!([{"t":0.0,"v":0.1},{"t":1.0,"v":10.0}])
    );
    assert!(admitted.fx_automation.is_none());
    assert_eq!(admitted.scheduled_events, 0);
    assert_eq!(admitted.point_count, 4);
    assert!(admitted.volume_points.is_some());
}
