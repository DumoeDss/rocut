#![allow(dead_code)]
#[path = "hyperframes_execution.rs"]
mod execution;
use editor_api::resolve_hyperframes_audio_observations_json;
use serde_json::{Value, json};

pub fn request() -> Value {
    let mut graph = execution::request()["graph"].clone();
    let track = &mut graph["snapshot"]["tracks"][0];
    track["attributes"]["groupRenderId"] = json!("bus#1");
    track["attributes"]["groupAuthorId"] = json!("voice-bus");
    let mut second = track.clone();
    second["instanceId"] = json!("track#2");
    graph["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(second);
    graph["snapshot"]["buses"] = json!([bus("bus#1"), bus("bus#2")]);
    let fresh = observation(&graph["snapshot"], 0.02);
    json!({"version":1,"graph":graph,"observations":[fresh]})
}

fn bus(id: &str) -> Value {
    json!({"instanceId":id,"authorId":"voice-bus","hidden":false,
        "attributes":{"volume":"0.5","fxChain":null,"automation":null}})
}

pub fn observation(snapshot: &Value, time: f64) -> Value {
    let mut fresh = snapshot.clone();
    fresh["time"] = json!(time);
    for track in fresh["tracks"].as_array_mut().unwrap() {
        track["observedAt"] = json!(time);
        if track["resolvedAuthorGain"]["state"] == "observed" {
            track["resolvedAuthorGain"]["observedAt"] = json!(time);
        }
    }
    fresh
}

pub fn resolve(input: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_observations_json(
        input.to_string(),
    ))
    .unwrap()
}

pub fn admitted(input: &Value) -> Value {
    let result = resolve(input);
    assert!(result.get("error").is_none(), "{result}");
    result
}

pub fn rejected(input: &Value) -> Value {
    let result = resolve(input);
    assert!(result["error"].is_string(), "{result}");
    assert!(result.get("faderObservations").is_none(), "{result}");
    result
}
