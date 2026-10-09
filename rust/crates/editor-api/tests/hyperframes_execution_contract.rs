#[path = "support/hyperframes_execution.rs"]
mod support;
use serde_json::json;
use support::*;

#[test]
fn prepares_canonical_history_but_never_claims_whole_graph_execution() {
    let mut input = request();
    let full = prepared(&input);
    assert_eq!(full["stage"], "dry-and-fader-kernels-prepared");
    assert_eq!(full["executionReady"], false);
    assert_eq!(full["renderFrames"], 4800);
    assert_eq!(full["tracks"][0]["fxStage"]["inputFrames"], 4800);
    assert_eq!(full["tracks"][0]["fxStage"]["expectedOutputFrames"], 4800);
    assert_eq!(full["tracks"][0]["fader"]["points"][0]["v"], 2.0);
    assert_eq!(full["decodedSources"][0]["gainApplied"], false);
    input["graph"]["firstFrame"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let crop = prepared(&input);
    assert_eq!(crop["renderFrames"], 4800);
    assert_eq!(crop["cropStartSample"], 1600);
    assert_eq!(crop["outputFrames"], 1600);
    assert_eq!(crop["tracks"], full["tracks"]);
    assert_eq!(crop["decodedSources"], full["decodedSources"]);
    assert_eq!(full["workingSet"]["browserTotalMemoryGuaranteed"], false);
    assert_eq!(full["workingSet"]["limitBytes"], 512 * 1024 * 1024);
}

#[test]
fn validates_complete_normalized_lane_against_raw_and_observed_gain() {
    let mut input = request();
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["attributes"]["automation"] = json!(
        json!({"version":1,"lanes":[{"target":"volume","points":[
            {"t":0.1,"v":2},{"t":-1,"v":1},{"t":"0x0","v":"3","curve":2,"viaX":0.5,"viaY":0.5}
        ]}]})
        .to_string()
    );
    track["resolvedAuthorGain"]["source"] = json!("normalized-volume-lane");
    track["resolvedAuthorGain"]["points"] = json!([{"t":0,"v":3,"curve":1},{"t":0.1,"v":2}]);
    track["resolvedAuthorGain"]["gainBeforeFades"] = json!(3);
    prepared(&input);
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"]["points"][0]["curve"] =
        json!(0.5);
    rejected(&input, "disagrees");
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"]["points"][0]["curve"] = json!(1);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] = json!(null);
    rejected(&input, "authored automation evidence");
}

#[test]
fn native_sync_observations_may_complete_inactive_snapshot_but_not_fallback_history() {
    let mut input = request();
    let mut fact = input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"].clone();
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"] = json!({"state":"unobserved"});
    rejected(&input, "Missing complete");
    fact["observedAt"] = json!(0.02);
    input["faderObservations"] = json!([{"instanceId":"track#1","resolvedAuthorGain":fact}]);
    prepared(&input);
    input["faderObservations"][0]["instanceId"] = json!("author-id-is-not-instance-id");
    rejected(&input, "unknown track");
    input["faderObservations"][0]["instanceId"] = json!("track#1");
    input["faderObservations"][0]["resolvedAuthorGain"]["observedAt"] = json!(1);
    rejected(&input, "outside canonical history");
    let mut input = request();
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]["volumeKeyframes"] = json!(null);
    track["resolvedAuthorGain"] = json!({"state":"observed","observedAt":0,"gainBeforeFades":1,
        "source":"fallback","points":null,"fades":{"fadeIn":0,"fadeOut":0},
        "fallback":{"routed":false,"previousRuntimeVolume":null,"currentElementVolume":1,"baselineGain":0.5}});
    rejected(&input, "single observation is insufficient");
}

#[test]
fn fractional_start_trim_and_loop_phase_are_explicitly_unproven_not_silently_rounded() {
    for field in ["start", "mediaStart"] {
        let mut input = request();
        input["graph"]["snapshot"]["tracks"][0]["native"][field] = json!(0.5 / 48000.0);
        if field == "start" {
            input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(0.1 + 0.5 / 48000.0);
        }
        rejected(&input, "fractional-sample phase");
    }
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["native"]["loop"] = json!(true);
    input["graph"]["snapshot"]["tracks"][0]["native"]["sourceDuration"] = json!(4.5 / 48000.0);
    rejected(&input, "loop period");
}

#[test]
fn decode_identity_includes_playback_rate_and_static_tail_does_not_extend_composition() {
    let mut input = request();
    let mut second = input["graph"]["snapshot"]["tracks"][0].clone();
    second["instanceId"] = json!("track#2");
    second["native"]["playbackRate"] = json!(2);
    second["native"]["rate"] = json!(2);
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(second);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["fxChain"] = json!(
        r#"{"version":1,"nodes":[{"type":"delay","params":{"time":100,"feedback":0,"mix":0.5}}]}"#
    );
    let plan = prepared(&input);
    assert_eq!(plan["decodedSources"].as_array().unwrap().len(), 2);
    assert_eq!(plan["decodedSources"][0]["frames"], 480);
    assert_eq!(plan["decodedSources"][1]["frames"], 240);
    // Native clamps authored zero feedback to .01: two .1s tail repeats.
    assert_eq!(plan["tracks"][0]["fxStage"]["expectedOutputFrames"], 14400);
    assert_eq!(plan["renderFrames"], 4800);
    assert_eq!(
        plan["tracks"][0]["fxStage"]["nativeFxAutomation"],
        json!(null)
    );
}

#[test]
fn slow_tempo_and_persistent_bus_buffers_cannot_evade_working_set_limit() {
    let mut input = request();
    let native = &mut input["graph"]["snapshot"]["tracks"][0]["native"];
    native["sourceDuration"] = json!(10);
    native["playbackRate"] = json!(0.01);
    native["rate"] = json!(0.01);
    rejected(&input, "tempo-adjusted source");
    let mut input = request();
    input["graph"]["durationFrames"] = json!(320);
    input["graph"]["snapshot"]["buses"] = json!(
        (0..32)
            .map(|index| json!({
                "instanceId":format!("bus#{index}"),"authorId":null,"hidden":true,
                "attributes":{"volume":null,"fxChain":null,"automation":null}
            }))
            .collect::<Vec<_>>()
    );
    rejected(&input, "512 MiB");
}

#[test]
fn normalized_evidence_clock_fades_and_shape_cannot_be_forged() {
    for (pointer, value, error) in [
        (
            "/graph/snapshot/tracks/0/resolvedAuthorGain/observedAt",
            json!(0.01),
            "snapshot",
        ),
        (
            "/graph/snapshot/tracks/0/resolvedAuthorGain/gainBeforeFades",
            json!(1),
            "disagrees",
        ),
        (
            "/graph/snapshot/tracks/0/resolvedAuthorGain/fades/fadeIn",
            json!(0.01),
            "clock/fade",
        ),
        (
            "/graph/snapshot/tracks/0/resolvedAuthorGain/points/0/v",
            json!(4),
            "ceiling",
        ),
    ] {
        let mut input = request();
        *input.pointer_mut(pointer).unwrap() = value;
        rejected(&input, error);
    }
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"]["fallback"] = json!({"routed":true,"previousRuntimeVolume":null,"currentElementVolume":1,"baselineGain":1});
    rejected(&input, "cannot carry fallback");
}

#[test]
fn native_visible_allocations_and_opaque_reserve_are_distinguished_in_budget() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["fxChain"] = json!(
        r#"{"version":1,"nodes":[{"type":"reverb","params":{"size":1}},{"type":"saturate"},{"type":"chorus"},{"type":"phaser"},{"type":"pitchshift"},{"type":"delay"}]}"#
    );
    let plan = prepared(&input);
    let budget = &plan["workingSet"];
    // Two reverb impulse buffers + waveshaper array + two mono LFO buffers +
    // stereo pitchshift worklet rings, all read directly from pinned native JS.
    assert_eq!(
        budget["explicitNativeBufferBytes"],
        1228800 + 32768 + 192000 * 2 + 76800
    );
    assert_eq!(
        budget["nominalNativeHistoryBytes"],
        48000 * 8 * 5 + 48000 * 4
    );
    assert_eq!(
        budget["estimatedNativeReserveBytes"],
        (16 + 6 * 4) * 1024 * 1024
    );
    assert_eq!(budget["browserTotalMemoryGuaranteed"], false);
}

#[test]
fn host_stable_encoded_snapshots_are_budgeted_in_addition_to_caller_buffers() {
    let mut input = request();
    let before = prepared(&input)["workingSet"]["knownBufferBytes"]
        .as_u64()
        .unwrap();
    input["graph"]["sources"][0]["byteLength"] = json!(5096);
    let after = prepared(&input)["workingSet"]["knownBufferBytes"]
        .as_u64()
        .unwrap();
    assert_eq!(after - before, 2000);
}

#[test]
fn dry_kernel_keeps_decoded_pcm_plus_host_and_wasm_envelope_copies() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["native"]["sourceDuration"] = json!(10);
    let before = prepared(&input)["workingSet"]["knownBufferBytes"]
        .as_u64()
        .unwrap();
    input["graph"]["snapshot"]["tracks"][0]["native"]["sourceDuration"] = json!(11);
    let after = prepared(&input)["workingSet"]["knownBufferBytes"]
        .as_u64()
        .unwrap();
    assert_eq!(after - before, 3 * 48000 * 8);
}
