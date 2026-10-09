#[path = "support/hyperframes_execution.rs"]
mod support;
use serde_json::{Value, json};
use support::{prepared, rejected, request};

fn observed(start: f64, end: f64, time: f64) -> Value {
    let mut input = request();
    input["graph"]["snapshot"]["time"] = json!(time);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["observedAt"] = json!(time);
    track["native"]["start"] = json!(start);
    track["native"]["end"] = json!(end);
    track["native"]["duration"] = json!(end - start);
    track["resolvedAuthorGain"]["observedAt"] = json!(time);
    input
}

#[test]
fn native_start_tolerance_accepts_real_early_gain_without_moving_pcm_placement() {
    let start = 0.05_f64;
    let early = f64::from_bits(start.to_bits() - 1);
    let plan = prepared(&observed(start, 0.09, early));
    assert_eq!(plan["tracks"][0]["startSample"], 2400);
    assert_eq!(plan["tracks"][0]["fxStage"]["inputFrames"], 1920);
    assert_eq!(plan["tracks"][0]["requiresPcm"], true);
}

#[test]
fn native_end_tolerance_rejects_forged_numeric_interior_gain() {
    let end = 0.09_f64;
    let excluded = f64::from_bits(end.to_bits() - 1);
    rejected(&observed(0.05, end, excluded), "clock/fade");
    rejected(&observed(0.05, end, end), "clock/fade");
}

#[test]
fn before_native_start_tolerance_and_empty_windows_still_reject() {
    rejected(&observed(0.05, 0.09, 0.05 - 2e-15), "clock/fade");
    rejected(&observed(0.05, 0.05, 0.05), "clock/fade");
}

#[test]
fn infinitesimal_native_observation_is_valid_but_not_fabricated_as_an_audio_sample() {
    let start = 0.05_f64;
    let end = f64::from_bits(start.to_bits() + 1);
    let early = start - 4.0 * f64::EPSILON;
    let plan = prepared(&observed(start, end, early));
    assert_eq!(plan["tracks"][0]["fxStage"]["inputFrames"], 0);
    assert_eq!(plan["tracks"][0]["requiresPcm"], false);
}
