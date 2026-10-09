#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::prepare_hyperframes_audio_dry_track_pcm;
use serde_json::{Value, json};
use support::*;

fn fractional_request(sample_rate: u32) -> Value {
    let mut input = request();
    input["graph"]["sampleRate"] = json!(sample_rate);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.7},{"t":0.1,"v":1.8}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["sourceDuration"] = json!(4);
    track["native"]["mediaStart"] = json!(0.1 + 0.5001 / 48000.0);
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    input
}

#[test]
fn fractional_nonloop_trim_reaches_the_native_recipe_without_source_resampling() {
    for sample_rate in [44100, 48000] {
        let mut input = fractional_request(sample_rate);
        let full = prepared(&input);
        let recipe = &full["decodedSources"][0]["ratePreparation"];
        assert_eq!(recipe["mediaStartSeconds"], "0.10001041875000001");
        assert_eq!(recipe["durationSeconds"], "0.1");
        assert_eq!(recipe["nativeSampleRate"], 48000);
        assert!(recipe["sourceLoop"].is_null());
        assert_eq!(full["tracks"][0]["sourceStartSample"], 0);
        assert_eq!(full["tracks"][0]["sourcePeriodFrames"], 0);
        let frames = full["decodedSources"][0]["frames"].as_u64().unwrap() as usize;
        let mut pcm = vec![0.0; frames * 2];
        pcm[..4].copy_from_slice(&[0.5, -0.25, 0.125, 0.75]);
        assert_eq!(
            samples(
                prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap()
            ),
            pcm
        );
        input["graph"]["firstFrame"] = json!(1);
        input["graph"]["frameCount"] = json!(1);
        let crop = prepared(&input);
        assert_eq!(crop["decodedSources"], full["decodedSources"]);
        assert_eq!(crop["tracks"], full["tracks"]);
    }
}

#[test]
fn fractional_rate_trim_cannot_leak_to_scalar_loop_or_untrusted_rate_paths() {
    let mut input = fractional_request(48000);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]["rate"] = json!(1);
    track["attributes"]["automation"] = Value::Null;
    rejected(&input, "tempo-adjusted media trim");
    input = fractional_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["native"]["loop"] = json!(true);
    input["graph"]["snapshot"]["tracks"][0]["native"]["sourceDuration"] =
        json!(0.35 + 0.5001 / 48000.0);
    rejected(&input, "variable-rate media trim");
    input = fractional_request(48000);
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] = Value::Null;
    rejected(&input, "authored evidence");
}

#[test]
fn distinct_fractional_trims_never_share_a_rounded_source_recipe() {
    let mut input = fractional_request(44100);
    let mut second = input["graph"]["snapshot"]["tracks"][0].clone();
    second["instanceId"] = json!("track#2");
    second["native"]["mediaStart"] = json!(0.1 + 0.4999 / 48000.0);
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let plan = prepared(&input);
    let sources = plan["decodedSources"].as_array().unwrap();
    assert_eq!(sources.len(), 2);
    assert_ne!(
        sources[0]["ratePreparation"]["mediaStartSeconds"],
        sources[1]["ratePreparation"]["mediaStartSeconds"]
    );
    assert_ne!(
        plan["tracks"][0]["decodedSourceId"],
        plan["tracks"][1]["decodedSourceId"]
    );
}
