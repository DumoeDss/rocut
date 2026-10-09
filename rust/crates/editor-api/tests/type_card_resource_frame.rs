#[path = "support/type_card_resources.rs"]
mod fixture;
use fixture::{combined, frame, reject, request, resolve};
use serde_json::json;

#[test]
fn reviewed_analysis_and_equivalent_manual_beats_match_with_trim_and_refs() {
    let mut analyzed = request("flicker");
    let mut manual = analyzed.clone();
    manual["source"]["recipe"]["nodes"][0]["scene"]["settings"]["beats"] =
        json!({"kind":"manual","songTicks":analyzed["analysis"]["beats"]});
    manual["source"]["recipe"]
        .as_object_mut()
        .unwrap()
        .remove("audio");
    manual.as_object_mut().unwrap().remove("analysis");
    for with_ref in [false, true] {
        if with_ref {
            for r in [&mut analyzed, &mut manual] {
                r["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({
                    "id":"reverse","scene":{"kind":"ref","input":"card",
                        "timeMap":[{"atFrame":0,"sourceFrame":59},{"atFrame":59,"sourceFrame":0}]}}));
                r["source"]["recipe"]["root"] = json!("reverse");
            }
        }
        for index in [0, 1, 14, 15, 16, 37, 38, 44, 59] {
            for trimmed in [false, true] {
                for r in [&mut analyzed, &mut manual] {
                    r["clipDuration"] = json!(if trimmed { 1 } else { 1201200 });
                    r["trimStart"] = json!(if trimmed { index * 4004 + 1001 } else { 0 });
                    r["timelineTime"] = json!(if trimmed { 0 } else { index * 4004 });
                }
                assert_eq!(
                    frame(&analyzed)["recipePlan"],
                    frame(&manual)["recipePlan"],
                    "frame {index}, trimmed {trimmed}, ref {with_ref}"
                );
            }
        }
    }
}

#[test]
fn quiet_audio_post_and_sequence_complete_together_without_dropping_a_branch() {
    let r = combined();
    let f = frame(&r);
    let root = &f["recipePlan"]["root"];
    assert_eq!(root["kind"], "transition");
    assert_eq!(root["from"]["kind"], "typeCard");
    assert_eq!(root["from"]["data"]["mode"], "quiet");
    assert_eq!(root["to"]["imageKey"], f["sequenceImages"][0]["imageKey"]);
    for (node, side) in [("card", "from"), ("sequence", "to")] {
        let mut standalone = r.clone();
        standalone["source"]["recipe"]["root"] = json!(node);
        assert_eq!(root[side], frame(&standalone)["recipePlan"]["root"]);
    }
    let amount = f["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"]
        .as_f64()
        .unwrap();
    assert!((amount - 0.9342666666666667).abs() < 1e-12);
}

#[test]
fn quiet_resource_discovery_defers_then_requires_all_completion_inputs() {
    let mut complete = combined();
    complete["clipDuration"] = json!(1);
    complete["trimStart"] = json!(5005);
    complete["timelineTime"] = json!(0);
    let mut initial = complete.clone();
    for key in ["fontMetrics", "sequenceManifests", "analysis"] {
        initial.as_object_mut().unwrap().remove(key);
    }
    let deferred = resolve(&initial);
    assert!(deferred.get("error").is_none(), "{deferred}");
    let f = &deferred["frame"];
    assert!(f.get("recipePlan").is_none());
    assert!(f.get("sequenceImages").is_none());
    assert_eq!(f["sourceTime"], 4004);
    assert_eq!(f["sampleTime"], 5005);
    assert_eq!(
        f["fontMetricRequests"],
        json!([{
        "resource":complete["source"]["resources"][0],"glyphs":["A"]}])
    );
    let mut only_fonts_missing = complete.clone();
    only_fonts_missing
        .as_object_mut()
        .unwrap()
        .remove("fontMetrics");
    assert_eq!(resolve(&only_fonts_missing), deferred);
    for key in ["analysis", "sequenceManifests"] {
        let mut missing = complete.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(!reject(&missing).is_empty(), "missing {key}");
    }
    assert_eq!(frame(&complete)["sequenceImages"][0]["ordinal"], 1);
}

#[test]
fn quiet_sequence_fractional_trim_and_ref_clocks_remain_distinct_from_root_audio() {
    let mut r = combined();
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    let direct = frame(&r);
    assert_eq!(direct["index"], 1);
    assert_eq!(direct["sourceTime"], 4004);
    assert_eq!(direct["sampleTime"], 5005);
    assert_eq!(direct["sequenceImages"][0]["ordinal"], 1);
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse",
        "scene":{"kind":"ref","input":"mix","timeMap":[{"atFrame":0,"sourceFrame":100},{"atFrame":200,"sourceFrame":0}]}}));
    r["source"]["recipe"]["root"] = json!("reverse");
    let reversed = frame(&r);
    assert_eq!(reversed["recipePlan"]["root"]["sampledFrame"], 99);
    assert_eq!(reversed["sampleTime"], 5005);
    assert_eq!(reversed["sequenceImages"][0]["ordinal"], 79);
    assert_eq!(reversed["recipePlan"]["post"], direct["recipePlan"]["post"]);
    // A direct evaluation at the mapped integer clock is the independent child oracle.
    r["source"]["recipe"]["root"] = json!("mix");
    r["source"]["recipe"]["post"] = json!([]);
    r["trimStart"] = json!(99 * 4004);
    let mapped = frame(&r);
    assert_eq!(
        reversed["recipePlan"]["root"]["input"],
        mapped["recipePlan"]["root"]
    );
    assert_eq!(reversed["sequenceImages"], mapped["sequenceImages"]);
}

#[test]
fn wrong_font_or_sequence_platform_inputs_reject_the_entire_composed_frame() {
    let base = combined();
    frame(&base);
    for (path, value) in [
        ("/fontMetrics", json!([])),
        ("/fontMetrics", json!(null)),
        ("/fontMetrics/0/resource/font/family", json!("Wrong font")),
        ("/fontMetrics/0/glyphs/0/text", json!("B")),
        ("/fontMetrics/0/glyphs/0/right", json!(-30)),
        ("/sequenceManifests", json!([])),
        ("/sequenceManifests/0/resourceId", json!("wrong.json")),
        ("/sequenceManifests/0/manifest/width", json!(0)),
        (
            "/sequenceManifests/0/manifest/frames/0/sha256",
            json!("bad"),
        ),
    ] {
        let mut bad = base.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(!reject(&bad).is_empty(), "accepted {path}");
    }
}

#[test]
fn missing_or_corrupt_reviewed_audio_never_yields_a_partial_type_card_frame() {
    for mode in ["quiet", "flicker"] {
        let base = if mode == "quiet" {
            combined()
        } else {
            request(mode)
        };
        frame(&base);
        let mut missing = base.clone();
        missing.as_object_mut().unwrap().remove("analysis");
        assert!(reject(&missing).contains("Missing MV audio analysis"));
        for (path, value) in [
            ("/analysis/provenance/inputSha256", json!("f".repeat(64))),
            ("/analysis/provenance/review/status", json!("required")),
            ("/analysis/provenance/review/reference", json!("")),
            ("/analysis/channels/mix_rms", json!([0, 1])),
            ("/analysis/beats", json!([0, 60000, 60000])),
        ] {
            let mut bad = base.clone();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(!reject(&bad).is_empty(), "accepted {mode}: {path}");
        }
    }
}

#[test]
fn analysis_beat_unknown_fields_fail_even_with_complete_reviewed_audio_binding() {
    let base = request("flicker");
    frame(&base); // Real prepare_mv_audio_json output and matching recipe binding both resolve.
    for (key, value) in [("unknown", json!(true)), ("songTicks", json!([0, 60000]))] {
        let mut bad = base.clone();
        bad["source"]["recipe"]["nodes"][0]["scene"]["settings"]["beats"][key] = value;
        let error = reject(&bad);
        assert!(error.contains("unknown field"), "{key}: {error}");
        assert!(
            !error.contains("binding"),
            "binding must not mask schema validation"
        );
    }
}
