#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::prepare_hyperframes_audio_dry_track_pcm;
use serde_json::{Value, json};
use support::*;

fn variable_request(sample_rate: u32) -> Value {
    let mut input = request();
    input["graph"]["sampleRate"] = json!(sample_rate);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.5},{"t":1.13,"v":2}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["end"] = json!(1.13);
    track["native"]["duration"] = json!(1.13);
    track["native"]["sourceDuration"] = json!(4);
    track["native"]["mediaStart"] = json!(0.1);
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    input
}

#[test]
fn variable_rate_plan_keeps_complete_clip_before_composition_and_request_crop() {
    for sample_rate in [44100, 48000] {
        let mut input = variable_request(sample_rate);
        let full = prepared(&input);
        let decoded = &full["decodedSources"][0];
        assert_eq!(
            decoded["frames"],
            (1.13 * f64::from(sample_rate)).round() as u64
        );
        assert_eq!(decoded["ratePreparation"]["nativeSampleRate"], 48000);
        assert_eq!(decoded["ratePreparation"]["durationSeconds"], "1.13");
        assert_eq!(decoded["ratePreparation"]["slices"], 5);
        assert_eq!(full["tracks"][0]["sourceStartSample"], 0);
        assert_eq!(
            full["tracks"][0]["fxStage"]["inputFrames"],
            sample_rate / 10
        );
        assert!(full["tracks"][0]["fxStage"]["nativeFxAutomation"].is_null());
        assert!(full["workingSet"]["ratePreparationBytes"].as_u64().unwrap() > 0);
        input["graph"]["firstFrame"] = json!(1);
        input["graph"]["frameCount"] = json!(1);
        let crop = prepared(&input);
        assert_eq!(crop["decodedSources"], full["decodedSources"]);
        assert_eq!(crop["tracks"], full["tracks"]);
    }
}

#[test]
fn variable_rate_dry_kernel_does_not_reapply_media_trim_or_tempo() {
    let input = variable_request(48000);
    let frames = prepared(&input)["decodedSources"][0]["frames"]
        .as_u64()
        .unwrap() as usize;
    let mut input_pcm = vec![0.0; frames * 2];
    input_pcm[..4].copy_from_slice(&[0.5, -0.25, 0.125, 0.75]);
    let output = samples(
        prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &input_pcm)).unwrap(),
    );
    assert_eq!(output.len(), 4800 * 2);
    assert_eq!(&output[..4], &[0.5, -0.25, 0.125, 0.75]);
}

#[test]
fn variable_rate_cannot_be_smuggled_by_native_facts_or_share_scalar_decode() {
    let mut input = variable_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["native"]["rate"]["points"][0]["v"] = json!(0.7);
    rejected(&input, "normalized authored lane");
    input = variable_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] = Value::Null;
    rejected(&input, "authored evidence");
    input = variable_request(48000);
    let mut second = input["graph"]["snapshot"]["tracks"][0].clone();
    second["instanceId"] = json!("track#2");
    second["native"]["mediaStart"] = json!(0.2);
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let plan = prepared(&input);
    assert_eq!(plan["decodedSources"].as_array().unwrap().len(), 2);
    assert_ne!(
        plan["tracks"][0]["decodedSourceId"],
        plan["tracks"][1]["decodedSourceId"]
    );
}

#[test]
fn variable_rate_fractional_placement_duration_and_fallback_still_require_evidence() {
    let mut input = variable_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["native"]["start"] = json!(0.5 / 48000.0);
    input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(1.13 + 0.5 / 48000.0);
    rejected(&input, "fractional-sample");
    input = variable_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["native"]["duration"] = json!(1.13 + 0.5 / 48000.0);
    input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(1.13 + 0.5 / 48000.0);
    let pending = prepared(&input);
    assert_eq!(pending["pcmGeometryReady"], false);
    assert!(pending["decodedSources"][0]["frames"].is_null());
    input["graph"]["snapshot"]["tracks"][0]["native"]["loop"] = json!(true);
    rejected(&input, "fractional-sample");
    input = variable_request(48000);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]["volumeKeyframes"] = Value::Null;
    track["resolvedAuthorGain"] = json!({"state":"observed","observedAt":0,"gainBeforeFades":0.5,
        "source":"fallback","points":null,"fades":{"fadeIn":0,"fadeOut":0},
        "fallback":{"routed":true,"baselineGain":0.5,"currentElementVolume":0.5,"previousRuntimeVolume":null}});
    rejected(&input, "complete native history");
}
