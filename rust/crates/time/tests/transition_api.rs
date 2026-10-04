use serde_json::{Value, json};
use time::{ClipTransitionsOptions, evaluate_clip_transitions};

fn fixture() -> Value {
    json!({
        "clips": [
            {"id":"a", "trackId":"v1", "start":0, "duration":360_000,
             "source":{"type":"video", "trimStart":120_000, "sourceDuration":720_000, "playbackRate":1.0}},
            {"id":"b", "trackId":"v1", "start":360_000, "duration":360_000,
             "source":{"type":"video", "trimStart":120_000, "sourceDuration":720_000, "playbackRate":1.0}}
        ],
        "links":[{"outgoingClipId":"a", "incomingClipId":"b", "durationFrames":30}],
        "frameRate":{"numerator":30, "denominator":1},
        "playhead":360_000
    })
}

fn evaluate(value: Value) -> Value {
    let input: ClipTransitionsOptions = serde_json::from_value(value).unwrap();
    serde_json::to_value(evaluate_clip_transitions(input)).unwrap()
}

#[test]
fn serializable_api_returns_the_same_window_and_source_samples() {
    let output = evaluate(fixture());
    assert_eq!(
        output,
        json!({
            "accepted":[{"linkIndex":0, "window":{"start":300_000,"cut":360_000,"end":420_000},
                "sample":{"time":360_000,"progress":0.5,"outgoingSource":480_000,"incomingSource":120_000}}],
            "rejected":[], "removed":[]
        })
    );
}

#[test]
fn validation_only_and_outside_window_do_not_synthesize_a_sample() {
    for playhead in [None, Some(-1), Some(299_999), Some(420_000), Some(900_000)] {
        let mut input = fixture();
        if let Some(time) = playhead {
            input["playhead"] = json!(time);
        } else {
            input.as_object_mut().unwrap().remove("playhead");
        }
        let output = evaluate(input);
        assert_eq!(output["accepted"][0]["sample"], Value::Null);
        assert_eq!(output["rejected"], json!([]));
    }
}

#[test]
fn exposes_precise_planner_and_missing_reference_errors_and_recovers() {
    let mut input = fixture();
    input["clips"][1]["source"]["trimStart"] = json!(0);
    assert_eq!(
        evaluate(input)["rejected"],
        json!([
            {"linkIndex":0,"error":{"code":"invalid-plan","reason":"missing-incoming-handle"}}
        ])
    );
    let mut input = fixture();
    input["links"][0]["outgoingClipId"] = json!("deleted");
    assert_eq!(
        evaluate(input)["rejected"],
        json!([
            {"linkIndex":0,"error":{"code":"missing-clip"}}
        ])
    );
    assert_eq!(evaluate(fixture())["accepted"].as_array().unwrap().len(), 1);
}

#[test]
fn rejects_unknown_fields_invalid_discriminators_and_fractional_wire_integers() {
    for (pointer, invalid) in [
        ("/links/0/durationFrames", json!(2.5)),
        ("/links/0/durationFrames", json!(-1)),
        ("/links/0/durationFrames", json!(4_294_967_296u64)),
        ("/clips/0/start", json!(0.1)),
        ("/clips/0/source/type", json!("audio")),
    ] {
        let mut input = fixture();
        *input.pointer_mut(pointer).unwrap() = invalid;
        assert!(
            serde_json::from_value::<ClipTransitionsOptions>(input).is_err(),
            "{pointer}"
        );
    }
    for pointer in ["", "/clips/0", "/clips/0/source", "/links/0"] {
        let mut input = fixture();
        input
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("silentlyIgnoredTypo".into(), json!(true));
        assert!(
            serde_json::from_value::<ClipTransitionsOptions>(input).is_err(),
            "{pointer}"
        );
    }
}
