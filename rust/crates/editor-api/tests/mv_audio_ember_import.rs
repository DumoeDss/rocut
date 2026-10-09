use editor_api::prepare_mv_audio_json;
use serde_json::{Value, json};

const METHOD: &str = "reference-onset-residual-p99-v1";

fn request() -> Value {
    let fp = |c: char| json!({"sha256":c.to_string().repeat(64),"bytes":100});
    json!({"manifest":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
        "command":"analyze","status":"complete","review":"required",
        "inputs":{"audio":fp('a')},"outputs":{"music.json":fp('b'),"envelopes.json":fp('c')}},
        "music":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
            "audio":{"duration":2},"review":"required","beats":[0,0.5,1.25],"downbeats":[0],
            "events":[{"time":0.7,"strength":7.5,"kind":"strong-onset-candidate"}],
            "strong_onsets":{"method":METHOD,"normalization_scale":2.75,
                "events":[{"time":0.25,"strength":-0.123},{"time":0.75,"strength":1}]}},
        "envelopes":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
            "duration":2,"fps":4,"frame_count":8,
            "channels":{"mix_rms":vec![0.5;8],"low_power":vec![0.25;8],
                "mid_power":vec![0.75;8],"high_power":vec![1;8]},
            "normalization":{"method":"per-channel p95 (max if p95 is zero), clipped to [0,1]",
                "scales":{"mix_rms":0.2,"low_power":5,"mid_power":2,"high_power":1}}},
        "manifestFile":{"sha256":"d".repeat(64),"byteLength":100},
        "musicFile":{"sha256":"b".repeat(64),"byteLength":100},
        "envelopesFile":{"sha256":"c".repeat(64),"byteLength":100},
        "expectedAudioSha256":"a".repeat(64),
        "review":{"status":"accepted","reference":"synthetic reference-onset fixture"}})
}

fn prepare(value: &Value) -> Value {
    serde_json::from_str(&prepare_mv_audio_json(value.to_string())).unwrap()
}

#[test]
fn imports_reference_onset_strengths_to_ticks_and_keeps_reviewed_provenance() {
    let output = prepare(&request());
    assert!(output.get("error").is_none(), "{output}");
    assert_eq!(
        output["data"]["strongOnsets"],
        json!({"method":METHOD,"normalizationScale":2.75,
        "events":[{"atTicks":30000,"strength":-0.123},{"atTicks":90000,"strength":1.0}]})
    );
    assert_eq!(output["data"]["provenance"]["musicSha256"], "b".repeat(64));
    assert_eq!(output["data"]["provenance"]["review"]["status"], "accepted");
    assert!(output["data"].get("events").is_none());
}

#[test]
fn absence_is_not_empty_and_raw_candidates_are_never_reference_fallbacks() {
    let mut value = request();
    value["music"]
        .as_object_mut()
        .unwrap()
        .remove("strong_onsets");
    let output = prepare(&value);
    assert!(output.get("error").is_none(), "{output}");
    assert!(output["data"].get("strongOnsets").is_none());
    value["music"]["strong_onsets"] = json!({"method":METHOD,"normalization_scale":0,"events":[]});
    let output = prepare(&value);
    assert_eq!(output["data"]["strongOnsets"]["events"], json!([]));
    assert_eq!(output["data"]["strongOnsets"]["normalizationScale"], 0.0);
}

#[test]
fn rejects_null_unknown_or_wrong_semantics_without_silently_ignoring_evidence() {
    for (pointer, bad) in [
        ("/music/strong_onsets", Value::Null),
        ("/music/strong_onsets/events", Value::Null),
        ("/music/strong_onsets/events/0", Value::Null),
        ("/music/strong_onsets/events/0/time", Value::Null),
        ("/music/strong_onsets/events/0/strength", Value::Null),
        (
            "/music/strong_onsets/method",
            json!("librosa-onset-strength-raw"),
        ),
        ("/music/strong_onsets/normalization_scale", json!(0)),
        ("/music/strong_onsets/normalization_scale", json!(-1)),
        ("/music/strong_onsets/events/0/strength", json!(1.0001)),
    ] {
        let mut value = request();
        *value.pointer_mut(pointer).unwrap() = bad;
        assert!(prepare(&value)["error"].is_string(), "accepted {pointer}");
    }
    for event_field in [false, true] {
        let mut value = request();
        if event_field {
            value["music"]["strong_onsets"]["events"][0]["kind"] = json!("candidate");
        } else {
            value["music"]["strong_onsets"]["normalizationScale"] = json!(2.75);
        }
        assert!(prepare(&value)["error"].is_string());
    }
}

#[test]
fn enforces_source_clock_tick_order_count_and_normalization_empty_rules() {
    for times in [
        vec![-0.000001],
        vec![2.0],
        vec![0.75, 0.25],
        vec![0.25, 0.25],
        vec![0.25, 0.250001],
        vec![1.999999],
    ] {
        let mut value = request();
        value["music"]["strong_onsets"]["events"] = json!(
            times
                .into_iter()
                .map(|time| json!({"time":time,"strength":0.5}))
                .collect::<Vec<_>>()
        );
        assert!(prepare(&value)["error"].is_string());
    }
    let mut value = request();
    value["music"]["strong_onsets"]["events"] = json!([]);
    assert!(prepare(&value)["error"].is_string());
    value["music"]["strong_onsets"]["events"] = json!(
        (0..521)
            .map(|i| json!({"time":f64::from(i)/1000.0,"strength":0.5}))
            .collect::<Vec<_>>()
    );
    assert!(prepare(&value)["error"].is_string());
}

#[test]
fn onset_import_still_requires_matching_fingerprints_and_accepted_review() {
    for (pointer, bad) in [
        ("/musicFile/sha256", json!("f".repeat(64))),
        ("/review/status", json!("required")),
        ("/review/reference", json!("")),
    ] {
        let mut value = request();
        *value.pointer_mut(pointer).unwrap() = bad;
        assert!(prepare(&value)["error"].is_string());
    }
    for invalid in ["NaN", "Infinity", "1e999"] {
        let text = request().to_string().replace("2.75", invalid);
        let output: Value = serde_json::from_str(&prepare_mv_audio_json(text)).unwrap();
        assert!(output["error"].is_string());
    }
}
