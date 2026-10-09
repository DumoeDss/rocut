#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::{mix_hyperframes_audio_bus_pcm, mix_hyperframes_audio_master_pcm};
use serde_json::{Value, json};
use support::*;

fn timing_request(start: f64) -> Value {
    let mut input = request();
    input["graph"]["timing"] = json!("native-exporter");
    input["graph"]["sampleRate"] = json!(44100);
    input["graph"]["durationFrames"] = json!(12);
    input["graph"]["frameCount"] = json!(12);
    input["graph"]["snapshot"]["time"] = json!(0.02);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["observedAt"] = json!(0.02);
    track["resolvedAuthorGain"]["observedAt"] = json!(0.02);
    track["native"]["start"] = json!(start);
    track["native"]["end"] = json!(start + 0.1);
    input
}

fn fractional(mut input: Value) -> Value {
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let start = track["native"]["start"].as_f64().unwrap();
    let duration = 0.1 + 0.25 / 48000.0;
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.7},{"t":0.1,"v":1.8}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["duration"] = json!(duration);
    track["native"]["end"] = json!(start + duration);
    track["native"]["sourceDuration"] = json!(1);
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    let pending = prepared(&input);
    input["decodedSourceObservations"] = json!([{"decodedSourceId":"dry#0",
        "preparationKey":pending["decodedSources"][0]["preparationKey"],
        "nativeFrames":4801,"frames":4411}]);
    input
}

#[test]
fn selected_export_timing_is_uniform_and_default_geometry_is_unchanged() {
    for (start, expected) in [
        (0.00049, 0),
        (0.0005, 44),
        (0.00051, 44),
        (1.0 / 44100.0, 0),
    ] {
        let input = timing_request(start);
        let plan = prepared(&input);
        assert_eq!(plan["tracks"][0]["startSample"], expected);
        assert_eq!(plan["tracks"][0]["outputTrimFrames"], 4410);
        assert_eq!(
            plan["samplePhasePolicy"],
            "native-exporter-trim-and-ms-placement-v1"
        );
    }
    let mut old = timing_request(1.0 / 44100.0);
    old["graph"].as_object_mut().unwrap().remove("timing");
    let old_plan = prepared(&old);
    assert_eq!(old_plan["tracks"][0]["startSample"], 1);
    assert!(old_plan["tracks"][0].get("outputTrimFrames").is_none());
    for timing in [
        Value::Null,
        json!("sample-aligned"),
        json!("native-exporter-ms"),
        json!(1),
        json!({}),
    ] {
        let mut invalid = old.clone();
        invalid["graph"]["timing"] = timing;
        rejected(&invalid, "Invalid HyperFrames execution JSON");
    }
}

#[test]
fn scalar_full_input_precedes_fx_even_when_composition_crops_the_track() {
    let mut input = timing_request(0.015);
    input["graph"]["durationFrames"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let plan = prepared(&input);
    assert_eq!(plan["tracks"][0]["fxStage"]["inputFrames"], 4410);
    let mut old = input;
    old["graph"].as_object_mut().unwrap().remove("timing");
    // The old 44.1k start is fractional and still fails, rather than downgrading.
    rejected(&old, "fractional-sample");
    old["graph"]["snapshot"]["tracks"][0]["native"]["start"] = json!(0.01);
    old["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(0.11);
    assert_eq!(prepared(&old)["tracks"][0]["fxStage"]["inputFrames"], 1029);
}

#[test]
fn full_measured_fx_buffer_is_validated_then_trimmed_before_delay_and_crop() {
    let input = fractional(timing_request(0.00051));
    let plan = prepared(&input);
    assert_eq!(plan["tracks"][0]["fxStage"]["inputFrames"], 4411);
    assert_eq!(plan["tracks"][0]["outputTrimFrames"], 4410);
    let mut pcm = vec![0.0; 4411 * 2];
    pcm[0] = 0.25;
    pcm[4409 * 2] = 0.25;
    pcm[4410 * 2] = 0.75;
    let buffers = [("track-post-fx", "track#1", pcm)];
    let canonical =
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("canonical"), &buffers))
            .unwrap();
    let output = samples(canonical.clone());
    assert_eq!(output[44 * 2], 0.5);
    assert_eq!(output[(44 + 4409) * 2], 0.5);
    assert_eq!(output[(44 + 4410) * 2], 0.0);
    let mut crop = input.clone();
    crop["graph"]["firstFrame"] = json!(3);
    crop["graph"]["frameCount"] = json!(1);
    let cropped =
        mix_hyperframes_audio_master_pcm(assembly(&crop, None, Some("crop"), &buffers)).unwrap();
    assert_eq!(cropped, canonical[4410 * 8..5880 * 8]);
    // Pre-trimming input is forbidden; complete post-FX transport is required.
    let shortened = [("track-post-fx", "track#1", vec![0.0; 4410 * 2])];
    assert!(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("canonical"), &shortened))
            .is_err()
    );
    let mut old = fractional(timing_request(0.0));
    old["graph"].as_object_mut().unwrap().remove("timing");
    let output = samples(
        mix_hyperframes_audio_master_pcm(assembly(&old, None, Some("canonical"), &buffers))
            .unwrap(),
    );
    assert_eq!(output[4410 * 2], 1.5);
}

#[test]
fn grouped_fx_tail_uses_the_same_final_timing_without_lowering_capacity() {
    let mut input = timing_request(0.00051);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["fxChain"] = json!(
        r#"{"version":1,"nodes":[{"type":"delay","params":{"time":100,"feedback":0,"mix":0.5}}]}"#
    );
    let mut input = fractional(input);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["groupRenderId"] = json!("bus#1");
    input["graph"]["snapshot"]["buses"] = json!([{"instanceId":"bus#1","authorId":null,"hidden":false,
        "attributes":{"volume":"1","fxChain":null,"automation":null}}]);
    let plan = prepared(&input);
    let frames = plan["tracks"][0]["fxStage"]["expectedOutputFrames"]
        .as_u64()
        .unwrap() as usize;
    let retained = plan["tracks"][0]["outputTrimFrames"].as_u64().unwrap() as usize;
    assert!(frames > retained && retained > 4411);
    let mut pcm = vec![0.0; frames * 2];
    pcm[(retained - 1) * 2] = 0.25;
    pcm[retained * 2] = 0.75;
    let output = samples(
        mix_hyperframes_audio_bus_pcm(assembly(
            &input,
            Some("bus#1"),
            None,
            &[("track-post-fx", "track#1", pcm)],
        ))
        .unwrap(),
    );
    assert_eq!(output[(44 + retained - 1) * 2], 0.5);
    assert_eq!(output[(44 + retained) * 2], 0.0);
    assert!(plan["workingSet"]["retainedTrackFxBytes"].as_u64().unwrap() >= frames as u64 * 8);
}

#[test]
fn native_timing_does_not_relax_start_duration_or_full_history_budgets() {
    let mut input = timing_request(-0.0001);
    rejected(&input, "timing");
    input = timing_request(0.00051);
    input["graph"]["snapshot"]["tracks"][0]["native"]["duration"] = json!(0.100001);
    input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(0.100511);
    rejected(&input, "fractional-sample");
    for muted in [false, true] {
        input = timing_request(0.00051);
        let track = &mut input["graph"]["snapshot"]["tracks"][0];
        track["authoredMuted"] = json!(muted);
        track["native"]["duration"] = json!(600);
        track["native"]["end"] = json!(600.00051);
        rejected(&input, "budget");
    }
}
