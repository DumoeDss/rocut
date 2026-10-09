#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::{mix_hyperframes_audio_master_pcm, prepare_hyperframes_audio_dry_track_pcm};
use serde_json::{Value, json};
use support::*;

fn fractional(sample_rate: u32) -> Value {
    let mut input = request();
    input["graph"]["sampleRate"] = json!(sample_rate);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.7},{"t":0.1,"v":1.8}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["sourceDuration"] = json!(4);
    track["native"]["mediaStart"] = json!(0.1 + 0.5001 / 48000.0);
    track["native"]["duration"] = json!(0.1 + 0.25 / 48000.0);
    track["native"]["end"] = track["native"]["duration"].clone();
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    input
}

fn observed(mut input: Value, native: u64, frames: u64) -> Value {
    let plan = prepared(&input);
    input["decodedSourceObservations"] = json!([{
        "decodedSourceId":"dry#0", "preparationKey":plan["decodedSources"][0]["preparationKey"],
        "nativeFrames":native,"frames":frames
    }]);
    input
}

#[test]
fn capacity_semantic_duration_and_actual_native_geometry_stay_distinct() {
    for rate in [48000, 44100] {
        let request = fractional(rate);
        // Independent V8 oracle: String(0.1 + 0.25 / 48000), not a handwritten
        // decimal approximation. Even the decimal ending in 334 parses to this
        // same float, whose canonical JS spelling ends in 335.
        let duration_bits = 0x3fb999f0fb38a94e;
        let duration = |value: &Value| {
            value["graph"]["snapshot"]["tracks"][0]["native"]["duration"]
                .as_f64()
                .unwrap()
                .to_bits()
        };
        assert_eq!(duration(&request), duration_bits);
        let wire: Value = serde_json::from_str(&request.to_string()).unwrap();
        assert_eq!(duration(&wire), duration_bits);
        let pending = prepared(&request);
        let source = &pending["decodedSources"][0];
        assert_eq!(pending["pcmGeometryReady"], false);
        assert!(source["frames"].is_null());
        assert!(source["pcmBytes"].is_null());
        assert!(pending["tracks"][0]["fxStage"].is_null());
        assert_eq!(
            source["ratePreparation"]["resampleFilter"],
            format!("aresample={rate}")
        );
        assert_eq!(
            source["ratePreparation"]["durationSeconds"],
            "0.10000520833333335"
        );
        assert_eq!(
            source["ratePreparation"]["durationSeconds"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap()
                .to_bits(),
            duration_bits
        );
        for (native, frames) in [
            (4800, u64::from(rate) / 10),
            (4801, u64::from(rate) / 10 + 1),
        ] {
            let input = observed(request.clone(), native, frames);
            let final_plan = prepared(&input);
            assert_eq!(final_plan["pcmGeometryReady"], true);
            assert_eq!(final_plan["decodedSources"][0]["frames"], frames);
            assert_eq!(final_plan["decodedSources"][0]["pcmBytes"], frames * 8);
            assert_eq!(final_plan["tracks"][0]["fxStage"]["inputFrames"], frames);
            assert_eq!(final_plan["workingSet"], pending["workingSet"]);
            // Complete prepared history even beyond the canonical composition.
            let pcm = vec![0.25; frames as usize * 2];
            assert_eq!(
                samples(
                    prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm))
                        .unwrap()
                ),
                pcm
            );
        }
    }
}

#[test]
fn pending_geometry_cannot_execute_and_finalization_requires_exact_observation_set() {
    let input = fractional(48000);
    assert!(
        prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &[]))
            .unwrap_err()
            .contains("finalized")
    );
    assert!(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &[]))
            .unwrap_err()
            .contains("finalized")
    );
    let mut missing = input.clone();
    missing["decodedSourceObservations"] = json!([]);
    rejected(&missing, "Missing");
    let valid = observed(input, 4800, 4800);
    let mut duplicate = valid.clone();
    let fact = duplicate["decodedSourceObservations"][0].clone();
    duplicate["decodedSourceObservations"]
        .as_array_mut()
        .unwrap()
        .push(fact);
    rejected(&duplicate, "Excessive");
    let mut unknown = valid.clone();
    unknown["decodedSourceObservations"][0]["decodedSourceId"] = json!("dry#9");
    rejected(&unknown, "Missing");
    let mut inert = valid;
    inert["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    rejected(&inert, "nonparticipating");
}

#[test]
fn observations_cannot_replay_changed_source_trim_rate_or_duration() {
    let input = observed(fractional(48000), 4800, 4800);
    for (path, value) in [
        ("mediaStart", json!(0.2)),
        ("duration", json!(0.11 + 0.25 / 48000.0)),
        ("sourceDuration", json!(5)),
    ] {
        let mut changed = input.clone();
        changed["graph"]["snapshot"]["tracks"][0]["native"][path] = value;
        changed["graph"]["snapshot"]["tracks"][0]["native"]["end"] =
            changed["graph"]["snapshot"]["tracks"][0]["native"]["duration"].clone();
        rejected(&changed, "admitted preparation");
    }
    let mut changed = input.clone();
    changed["graph"]["sources"][0]["id"] = json!("b".repeat(64));
    changed["graph"]["snapshot"]["tracks"][0]["resourceId"] = json!("b".repeat(64));
    rejected(&changed, "admitted preparation");
    let mut changed = input.clone();
    changed["graph"]["sampleRate"] = json!(44100);
    rejected(&changed, "admitted preparation");
    let mut changed = input;
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.8},{"t":0.1,"v":1.7}]});
    changed["graph"]["snapshot"]["tracks"][0]["native"]["rate"] = lane.clone();
    changed["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] =
        json!(json!({"version":1,"lanes":[lane]}).to_string());
    rejected(&changed, "admitted preparation");
}

#[test]
fn over_capacity_inconsistent_native_conversion_and_wrong_pcm_lengths_fail() {
    for (native, frames) in [(4803, 4803), (4800, 4801), (0, 1)] {
        rejected(
            &observed(fractional(48000), native, frames),
            "admitted preparation",
        );
    }
    rejected(&observed(fractional(44100), 1, 10), "admitted preparation");
    let input = observed(fractional(48000), 4800, 4800);
    assert!(
        prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &[0.0; 2]))
            .unwrap_err()
            .contains("decoded source")
    );
}

#[test]
fn actual_empty_preparation_requires_explicit_empty_track_and_complete_fader() {
    let input = observed(fractional(48000), 0, 0);
    let plan = prepared(&input);
    assert_eq!(plan["tracks"][0]["requiresPcm"], true);
    assert_eq!(plan["tracks"][0]["fxStage"]["inputFrames"], 0);
    assert_eq!(plan["tracks"][0]["fxStage"]["expectedOutputFrames"], 0);
    assert!(
        prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &[]))
            .unwrap()
            .is_empty()
    );
    let pcm = mix_hyperframes_audio_master_pcm(assembly(
        &input,
        None,
        Some("crop"),
        &[("track-post-fx", "track#1", vec![])],
    ))
    .unwrap();
    assert!(samples(pcm).iter().all(|value| *value == 0.0));
    assert!(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &[]))
            .unwrap_err()
            .contains("Missing")
    );
    let mut incomplete = input;
    incomplete["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"] =
        json!({"state":"unobserved"});
    rejected(&incomplete, "complete HyperFrames fader");
}

#[test]
fn finalized_full_history_is_identical_before_any_output_crop() {
    let mut input = observed(fractional(48000), 4801, 4801);
    let full = prepared(&input);
    let buffers = [("track-post-fx", "track#1", vec![0.25; 4801 * 2])];
    let canonical =
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("canonical"), &buffers))
            .unwrap();
    input["graph"]["firstFrame"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let crop = prepared(&input);
    assert_eq!(crop["decodedSources"], full["decodedSources"]);
    assert_eq!(crop["tracks"], full["tracks"]);
    let partial =
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &buffers)).unwrap();
    assert_eq!(partial, canonical[1600 * 8..3200 * 8]);
}

#[test]
fn mute_crop_and_empty_observations_cannot_bypass_predecode_capacity_budget() {
    let baseline = fractional(48000);
    let original = prepared(&baseline);
    let empty = observed(baseline.clone(), 0, 0);
    assert_eq!(prepared(&empty)["workingSet"], original["workingSet"]);
    let mut muted = baseline;
    muted["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    assert_eq!(prepared(&muted)["workingSet"], original["workingSet"]);
    for muted in [false, true] {
        let mut excessive = empty.clone();
        let track = &mut excessive["graph"]["snapshot"]["tracks"][0];
        track["authoredMuted"] = json!(muted);
        track["native"]["duration"] = json!(600.0 + 0.25 / 48000.0);
        track["native"]["end"] = track["native"]["duration"].clone();
        excessive["graph"]["frameCount"] = json!(1);
        rejected(&excessive, "budget");
    }
}

#[test]
fn scalar_duration_and_duplicate_facts_keep_fail_closed_gates() {
    let mut scalar = fractional(48000);
    scalar["graph"]["snapshot"]["tracks"][0]["native"]["rate"] = json!(1);
    scalar["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] = Value::Null;
    rejected(&scalar, "fractional-sample");
    let mut input = observed(fractional(48000), 4800, 4800);
    let mut track = input["graph"]["snapshot"]["tracks"][0].clone();
    track["instanceId"] = json!("track#2");
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(track);
    let fact = input["decodedSourceObservations"][0].clone();
    input["decodedSourceObservations"]
        .as_array_mut()
        .unwrap()
        .push(fact);
    rejected(&input, "Duplicate");
}
