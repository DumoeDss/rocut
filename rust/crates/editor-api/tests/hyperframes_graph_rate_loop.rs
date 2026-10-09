#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::prepare_hyperframes_audio_dry_track_pcm;
use serde_json::{Value, json};
use support::*;

fn loop_request(sample_rate: u32) -> Value {
    let mut input = request();
    input["graph"]["sampleRate"] = json!(sample_rate);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let lane = json!({"target":"rate","points":[{"t":0,"v":0.5},{"t":1.13,"v":2}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["end"] = json!(1.6);
    track["native"]["duration"] = json!(1.6);
    track["native"]["sourceDuration"] = json!(0.35);
    track["native"]["mediaStart"] = json!(0.1);
    track["native"]["loop"] = json!(true);
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    input
}

#[test]
fn variable_rate_loop_is_prepared_in_source_domain_not_dry_modulo() {
    for sample_rate in [44100, 48000] {
        let mut input = loop_request(sample_rate);
        let full = prepared(&input);
        let source = &full["decodedSources"][0];
        let recipe = &source["ratePreparation"];
        assert_eq!(recipe["sourceLoop"]["periodFrames"], 12000);
        assert_eq!(recipe["sourceLoop"]["sourceFrames"], 103813);
        assert_eq!(recipe["mediaStartSeconds"], "0");
        assert_eq!(full["tracks"][0]["loop"], false);
        assert_eq!(full["tracks"][0]["sourcePeriodFrames"], 0);
        assert_eq!(full["tracks"][0]["sourceStartSample"], 0);
        let frames = source["frames"].as_u64().unwrap() as usize;
        let pcm: Vec<f32> = (0..frames * 2).map(|i| i as f32 / frames as f32).collect();
        let dry = samples(
            prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap(),
        );
        assert_eq!(dry, pcm[..sample_rate as usize / 10 * 2]);
        input["graph"]["firstFrame"] = json!(1);
        input["graph"]["frameCount"] = json!(1);
        let crop = prepared(&input);
        assert_eq!(crop["decodedSources"], full["decodedSources"]);
        assert_eq!(crop["tracks"], full["tracks"]);
    }
}

#[test]
fn variable_rate_loop_geometry_is_per_clip_and_never_shared_by_source_identity() {
    let mut input = loop_request(48000);
    let mut other = input["graph"]["snapshot"]["tracks"][0].clone();
    other["instanceId"] = json!("track#2");
    other["native"]["mediaStart"] = json!(0.15);
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(other);
    let full = prepared(&input);
    assert_eq!(full["decodedSources"].as_array().unwrap().len(), 2);
    assert_ne!(
        full["decodedSources"][0]["ratePreparation"]["sourceLoop"]["periodFrames"],
        full["decodedSources"][1]["ratePreparation"]["sourceLoop"]["periodFrames"]
    );
}

#[test]
fn variable_rate_loop_tiny_crop_and_mute_cannot_bypass_full_source_working_set() {
    let mut input = loop_request(48000);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    let lane = json!({"target":"rate","points":[{"t":0,"v":10}]});
    track["native"]["rate"] = lane.clone();
    track["native"]["duration"] = json!(30);
    track["native"]["end"] = json!(30);
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":[lane]}).to_string());
    // Composition/crop remains only 0.1 seconds, but rate source is 300 seconds.
    rejected(&input, "512 MiB");
    input["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    rejected(&input, "512 MiB");
}

#[test]
fn variable_rate_loop_keeps_fractional_and_participating_fallback_rejections() {
    let mut input = loop_request(44100);
    input["graph"]["snapshot"]["tracks"][0]["native"]["sourceDuration"] =
        json!(0.35 + 1.0 / 48000.0);
    rejected(&input, "fractional-sample");
    input = loop_request(48000);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]["volumeKeyframes"] = Value::Null;
    track["resolvedAuthorGain"] = json!({"state":"observed","observedAt":0,"gainBeforeFades":0.5,
        "source":"fallback","points":null,"fades":{"fadeIn":0,"fadeOut":0},
        "fallback":{"routed":true,"baselineGain":0.5,"currentElementVolume":0.5,"previousRuntimeVolume":null}});
    rejected(&input, "complete native history");
}
