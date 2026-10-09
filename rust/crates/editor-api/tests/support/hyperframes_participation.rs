#![allow(dead_code)]
#[path = "hyperframes_observations.rs"]
mod observations;
use editor_api::{
    resolve_hyperframes_audio_execution_plan_json, resolve_hyperframes_audio_observations_json,
};
use serde_json::{Value, json};

pub const INERT: [&str; 4] = [
    "authored-muted",
    "ancestor-hidden",
    "inert-video",
    "hidden-bus",
];

pub fn request(kind: &str) -> Value {
    let mut input = observations::request();
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]
        .as_object_mut()
        .unwrap()
        .remove("volumeKeyframes");
    track["resolvedAuthorGain"] = json!({"state":"observed","observedAt":0,
        "gainBeforeFades":0.5,"source":"fallback","points":null,
        "fades":{"fadeIn":0,"fadeOut":0},"fallback":{"routed":false,
            "previousRuntimeVolume":null,"currentElementVolume":0.5,"baselineGain":0.5}});
    match kind {
        "authored-muted" => track["authoredMuted"] = json!(true),
        "ancestor-hidden" => track["ancestorHidden"] = json!(true),
        "inert-video" => {
            track["type"] = json!("video");
            track["attributes"]["muted"] = json!(true);
            input["graph"]["sources"][0]["mimeType"] = json!("video/mp4");
        }
        "hidden-bus" => input["graph"]["snapshot"]["buses"][0]["hidden"] = json!(true),
        "participating" => {}
        _ => panic!("Unknown participation fixture"),
    }
    refresh(&mut input);
    input
}

pub fn refresh(input: &mut Value) {
    input["observations"] = json!([observations::observation(&input["graph"]["snapshot"], 0.02)]);
}

pub fn observe(input: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_observations_json(
        input.to_string(),
    ))
    .unwrap()
}

pub fn execute(input: &Value) -> Value {
    let facts: Vec<Value> = input["observations"].as_array().unwrap().iter().flat_map(|snapshot| {
        snapshot["tracks"].as_array().unwrap().iter().map(|track| {
            json!({"instanceId":track["instanceId"],"resolvedAuthorGain":track["resolvedAuthorGain"]})
        })
    }).collect();
    serde_json::from_str(&resolve_hyperframes_audio_execution_plan_json(
        json!({"version":1,"graph":input["graph"],"faderObservations":facts}).to_string(),
    ))
    .unwrap()
}

pub fn admitted_inert(input: &Value) {
    let observed = observe(input);
    assert!(observed.get("error").is_none(), "{observed}");
    assert_eq!(observed["faderObservations"], json!([]));
    assert_eq!(observed["executionReady"], false);
    let executed = execute(input);
    assert!(executed.get("error").is_none(), "{executed}");
    assert_eq!(executed["plan"]["tracks"][0]["requiresPcm"], false);
    assert_eq!(executed["plan"]["tracks"][0]["fader"], Value::Null);
    assert_eq!(executed["plan"]["decodedSources"][0]["required"], false);
}

pub fn rejected_both(input: &Value) {
    for result in [observe(input), execute(input)] {
        assert!(result["error"].is_string(), "{result}");
        assert!(result.get("faderObservations").is_none(), "{result}");
        assert!(result.get("plan").is_none(), "{result}");
    }
}
