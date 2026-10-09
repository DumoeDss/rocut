#![allow(dead_code)]
use editor_api::resolve_hyperframes_audio_execution_plan_json;
use serde_json::{Value, json};

pub fn request() -> Value {
    let gain = json!({"state":"observed","observedAt":0,"gainBeforeFades":2,
        "source":"normalized-GSAP","points":[{"t":0,"v":2},{"t":0.1,"v":2}],
        "fades":{"fadeIn":0,"fadeOut":0},"fallback":null});
    let track = json!({"instanceId":"track#1","authorId":"voice","resourceId":"a".repeat(64),
                "type":"audio","authoredMuted":false,"ancestorHidden":false,"observedAt":0,
                "native":{"start":0,"end":0.1,"duration":0.1,"mediaStart":0,
                    "sourceDuration":0.01,"playbackRate":1,"rate":1,"loop":false,"volume":0.5,
                    "fades":{"fadeIn":0,"fadeOut":0},
                    "volumeKeyframes":[{"time":0,"volume":2},{"time":0.1,"volume":2}]},
                "resolvedAuthorGain":gain,
                "attributes":{"groupRenderId":null,"groupAuthorId":null,"fxChain":null,
                    "automation":null,"muted":false,"hasAudio":null}});
    json!({"version":1,"faderObservations":[],"graph":{
        "version":1,"semanticsProfile":"rocut-hyperframes-0.8.139-audio-graph-v1",
        "frameRate":{"numerator":30,"denominator":1},"sampleRate":48000,
        "firstFrame":0,"frameCount":3,"durationFrames":3,
        "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
        "snapshot":{"version":1,"nativeVersion":"0.8.139","time":0,"tracks":[track],"buses":[]}}})
}

pub fn resolve(request: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_execution_plan_json(
        request.to_string(),
    ))
    .unwrap()
}

pub fn prepared(request: &Value) -> Value {
    let result = resolve(request);
    assert!(result.get("error").is_none(), "{result}");
    result["plan"].clone()
}

pub fn rejected(request: &Value, fragment: &str) {
    let result = resolve(request);
    assert!(
        result["error"]
            .as_str()
            .is_some_and(|error| error.contains(fragment)),
        "{result}"
    );
}

pub fn envelope(request: &Value, buffer_id: &str, pcm: &[f32]) -> Vec<u8> {
    let header = json!({"version":1,"request":request,"instanceId":"track#1","bufferId":buffer_id})
        .to_string();
    let mut result = (header.len() as u32).to_le_bytes().to_vec();
    result.extend_from_slice(header.as_bytes());
    for value in pcm {
        result.extend_from_slice(&value.to_le_bytes());
    }
    result
}

pub fn samples(bytes: Vec<u8>) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
        .collect()
}

pub fn assembly(
    request: &Value,
    bus: Option<&str>,
    output: Option<&str>,
    buffers: &[(&str, &str, Vec<f32>)],
) -> Vec<u8> {
    let descriptors: Vec<_> = buffers
        .iter()
        .map(|(kind, id, pcm)| {
            json!({
                "kind":kind,"instanceId":id,"byteLength":pcm.len() * 4
            })
        })
        .collect();
    let mut manifest = json!({"version":1,"request":request,"buffers":descriptors});
    if let Some(bus) = bus {
        manifest["busInstanceId"] = json!(bus);
    }
    if let Some(output) = output {
        manifest["output"] = json!(output);
    }
    let header = manifest.to_string();
    let mut result = (header.len() as u32).to_le_bytes().to_vec();
    result.extend_from_slice(header.as_bytes());
    for (_, _, pcm) in buffers {
        for sample in pcm {
            result.extend_from_slice(&sample.to_le_bytes());
        }
    }
    result
}
