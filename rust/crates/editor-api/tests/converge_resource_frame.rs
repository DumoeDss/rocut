#[path = "support/converge_resources.rs"]
mod fixture;
use fixture::{combined, frame, manual_equivalent, reject, request, resolve, reverse};
use serde_json::json;

#[test]
fn reviewed_import_and_manual_converge_beats_match_source_trim_and_ref_clocks() {
    for song_start in [0.0, 0.125] {
        for with_ref in [false, true] {
            let mut analyzed = request();
            analyzed["source"]["recipe"]["songStartSeconds"] = json!(song_start);
            let mut manual = manual_equivalent(&analyzed);
            manual["source"]["recipe"]
                .as_object_mut()
                .unwrap()
                .remove("audio");
            manual.as_object_mut().unwrap().remove("analysis");
            assert_eq!(analyzed["analysis"]["beats"], json!([0, 60000, 150000]));
            assert_eq!(
                analyzed["analysis"]["provenance"]["review"]["status"],
                "accepted"
            );
            if with_ref {
                reverse(&mut analyzed, "converge", 60);
                reverse(&mut manual, "converge", 60);
            }
            for index in [0, 1, 14, 15, 37, 38, 59, 60] {
                for trimmed in [false, true] {
                    for r in [&mut analyzed, &mut manual] {
                        r["clipStart"] = json!(120000);
                        r["clipDuration"] = json!(if trimmed { 1 } else { 1201200 });
                        r["trimStart"] = json!(if trimmed { index * 4004 + 1001 } else { 0 });
                        r["timelineTime"] = json!(120000 + if trimmed { 0 } else { index * 4004 });
                    }
                    let a = frame(&analyzed);
                    let m = frame(&manual);
                    assert_eq!(a["index"], index);
                    assert_eq!(a["sourceTime"], index * 4004);
                    assert_eq!(
                        a["recipePlan"], m["recipePlan"],
                        "song {song_start}, frame {index}, trimmed {trimmed}, ref {with_ref}"
                    );
                    let root = if with_ref {
                        &a["recipePlan"]["root"]["input"]
                    } else {
                        &a["recipePlan"]["root"]
                    };
                    assert_eq!(root["kind"], "converge");
                    assert!(
                        root["data"]["commands"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|c| c["kind"] == "grain")
                    );
                }
            }
        }
    }
}

#[test]
fn converge_quiet_and_sequence_complete_together_without_losing_a_panel() {
    let r = combined();
    let f = frame(&r);
    assert_eq!(f["recipePlan"]["root"]["kind"], "panels");
    let panels = f["recipePlan"]["root"]["panels"].as_array().unwrap();
    assert_eq!(panels.len(), 3);
    for (index, node, kind) in [
        (0, "converge", "converge"),
        (1, "card", "typeCard"),
        (2, "sequence", "imageSequence"),
    ] {
        assert_eq!(panels[index]["input"]["kind"], kind);
        let mut standalone = r.clone();
        standalone["source"]["recipe"]["root"] = json!(node);
        assert_eq!(
            panels[index]["input"],
            frame(&standalone)["recipePlan"]["root"]
        );
    }
    assert_eq!(panels[1]["input"]["data"]["mode"], "quiet");
    assert_eq!(
        panels[2]["input"]["imageKey"],
        f["sequenceImages"][0]["imageKey"]
    );
    assert_eq!(frame(&manual_equivalent(&r))["recipePlan"], f["recipePlan"]);
    let amount = f["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"]
        .as_f64()
        .unwrap();
    assert!((amount - 0.9342666666666667).abs() < 1e-12);
}

#[test]
fn full_resource_discovery_defers_before_any_converge_quiet_or_sequence_draw_plan() {
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
    let mut missing_fonts = complete.clone();
    missing_fonts.as_object_mut().unwrap().remove("fontMetrics");
    assert_eq!(resolve(&missing_fonts), deferred);
    for key in ["analysis", "sequenceManifests"] {
        let mut missing = complete.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(!reject(&missing).is_empty(), "missing {key}");
    }
    let completed = frame(&complete);
    assert_eq!(
        completed["recipePlan"]["root"]["panels"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(completed["sequenceImages"][0]["ordinal"], 1);
}

#[test]
fn fractional_trim_and_reverse_child_time_leave_root_audio_post_clock_unchanged() {
    let mut r = combined();
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    let direct = frame(&r);
    assert_eq!(direct["index"], 1);
    assert_eq!(direct["sourceTime"], 4004);
    assert_eq!(direct["sampleTime"], 5005);
    assert_eq!(direct["sequenceImages"][0]["ordinal"], 1);
    reverse(&mut r, "mix", 100);
    let reversed = frame(&r);
    assert_eq!(reversed["recipePlan"]["root"]["sampledFrame"], 99);
    assert_eq!(reversed["sampleTime"], 5005);
    assert_eq!(reversed["sequenceImages"][0]["ordinal"], 79);
    assert_eq!(reversed["recipePlan"]["post"], direct["recipePlan"]["post"]);
    assert_eq!(
        reversed["recipePlan"]["songSeconds"],
        direct["recipePlan"]["songSeconds"]
    );
    assert_eq!(
        reversed["recipePlan"],
        frame(&manual_equivalent(&r))["recipePlan"]
    );
    // Compare child output against a separate public-API evaluation at the mapped
    // integer clock; no duplicate scene geometry or kinematics as an oracle.
    // Frame 99 is past the imported audio's two seconds. Root post following the
    // ref would already have failed above; omit post only for this child oracle.
    r["source"]["recipe"]["root"] = json!("mix");
    r["source"]["recipe"]["post"] = json!([]);
    r["trimStart"] = json!(99 * 4004);
    let mapped = frame(&r);
    assert_eq!(
        reversed["recipePlan"]["root"]["input"],
        mapped["recipePlan"]["root"]
    );
    assert_eq!(reversed["sequenceImages"], mapped["sequenceImages"]);
    assert_ne!(
        mapped["recipePlan"]["songSeconds"],
        direct["recipePlan"]["songSeconds"]
    );
}

#[test]
fn missing_or_corrupt_reviewed_audio_rejects_the_whole_converge_composition() {
    for base in [request(), combined()] {
        frame(&base);
        let mut missing = base.clone();
        missing.as_object_mut().unwrap().remove("analysis");
        assert!(reject(&missing).contains("Missing MV audio analysis"));
        for (path, value) in [
            ("/source/recipe/audio/inputSha256", json!("e".repeat(64))),
            ("/analysis/provenance/inputSha256", json!("f".repeat(64))),
            ("/analysis/provenance/review/status", json!("required")),
            ("/analysis/provenance/review/reference", json!("")),
            ("/analysis/channels/mix_rms", json!([0, 1])),
            ("/analysis/channels/high_power/0", json!(1.01)),
            ("/analysis/beats", json!([0, 60000, 60000])),
            ("/analysis/beats", json!([150000, 0, 60000])),
        ] {
            let mut bad = base.clone();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(!reject(&bad).is_empty(), "accepted {path}");
        }
        let mut missing_channel = base.clone();
        missing_channel["analysis"]["channels"]
            .as_object_mut()
            .unwrap()
            .remove("low_power");
        assert!(!reject(&missing_channel).is_empty());
        for ticks in [json!([60000, 0]), json!([0, 0]), json!([-1]), json!([0.5])] {
            let mut bad_manual = manual_equivalent(&base);
            for node in bad_manual["source"]["recipe"]["nodes"]
                .as_array_mut()
                .unwrap()
            {
                if node["scene"]["kind"] == "converge" {
                    node["scene"]["settings"]["beats"]["songTicks"] = ticks.clone();
                }
            }
            assert!(!reject(&bad_manual).is_empty(), "accepted manual {ticks}");
        }
    }
}

#[test]
fn combined_resources_fit_without_relaxing_expanded_converge_work_admission() {
    let mut r = combined();
    frame(&r);
    r["source"]["recipe"]["nodes"][2]["scene"]["panels"][1]["input"] = json!("converge");
    assert!(reject(&r).contains("4096 expanded generator primitives"));
}

#[test]
fn malformed_companion_resource_inputs_never_drop_a_branch_to_return_converge() {
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
