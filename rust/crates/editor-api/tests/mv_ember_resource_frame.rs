#[path = "support/ember_resources.rs"]
mod fixture;
use fixture::{combined, complete_facts, frame, reject, request, resolve, reverse};
use serde_json::{Value, json};

#[test]
fn one_public_completion_resolves_font_image_analysis_and_sequence_without_losing_sample_time() {
    let mut r = combined();
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    let complete = frame(&r);
    assert_eq!(complete["sourceTime"], 4004);
    assert_eq!(complete["sampleTime"], 5005);
    assert_eq!(complete["sequenceImages"][0]["ordinal"], 1);
    assert_eq!(complete["recipePlan"]["root"]["kind"], "panels");
    let mut initial = r.clone();
    for key in [
        "fontMetrics",
        "imageDimensions",
        "analysis",
        "sequenceManifests",
    ] {
        initial.as_object_mut().unwrap().remove(key);
    }
    // Initial discovery explicitly defers the audio-dependent recipe. Missing
    // analysis in a non-deferred completion below remains a hard error.
    initial["deferRecipe"] = json!(true);
    let deferred = resolve(&initial);
    assert!(deferred.get("error").is_none(), "{deferred}");
    assert!(deferred["frame"].get("recipePlan").is_none());
    assert!(deferred["frame"].get("sequenceImages").is_none());
    assert_eq!(deferred["frame"]["sampleTime"], 5005);
    assert_eq!(deferred["frame"]["sourceTime"], 4004);
    assert_eq!(
        deferred["frame"]["fontMetricRequests"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        deferred["frame"]["imageDimensionRequests"],
        json!([{"resource":r["imageDimensions"][0]["resource"]}])
    );
    for key in ["fontMetrics", "imageDimensions"] {
        let mut partial = r.clone();
        partial.as_object_mut().unwrap().remove(key);
        let result = resolve(&partial);
        assert!(result.get("error").is_none(), "{key}: {result}");
        assert!(result["frame"].get("recipePlan").is_none());
        assert!(result["frame"].get("sequenceImages").is_none());
    }
    for key in ["analysis", "sequenceManifests"] {
        let mut partial = r.clone();
        partial.as_object_mut().unwrap().remove(key);
        assert!(!reject(&partial).is_empty(), "missing {key}");
    }
}

#[test]
fn combined_ref_changes_children_and_sequence_clock_but_not_root_audio_post_clock() {
    let mut r = combined();
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    let direct = frame(&r);
    reverse(&mut r, "mix", 100);
    let reversed = frame(&r);
    assert_eq!(reversed["recipePlan"]["root"]["sampledFrame"], 99);
    assert_eq!(reversed["sampleTime"], 5005);
    assert_eq!(reversed["sequenceImages"][0]["ordinal"], 79);
    assert_eq!(reversed["recipePlan"]["post"], direct["recipePlan"]["post"]);
    assert_ne!(
        reversed["recipePlan"]["root"]["input"],
        direct["recipePlan"]["root"]
    );
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
fn controlled_facts_require_exact_declared_resource_and_request_identity() {
    let base = combined();
    frame(&base);
    for (path, value) in [
        ("/fontMetrics", Value::Null),
        ("/fontMetrics", json!([])),
        ("/fontMetrics/0/resource/font/family", json!("stale-font")),
        ("/fontMetrics/0/advances/0/text", json!("unexpected")),
        ("/fontMetrics/0/advances/0/width", json!(-1)),
        ("/fontMetrics/0/advances/0/fontSizePx", json!(23)),
        ("/fontMetrics/0/advances/0/letterSpacingPx", json!(1)),
        ("/imageDimensions", Value::Null),
        ("/imageDimensions", json!([])),
        ("/imageDimensions/0/width", json!(0)),
        ("/imageDimensions/0/height", json!(8193)),
        ("/imageDimensions/0/resource/id", json!("wrong.png")),
        ("/imageDimensions/0/resource/byteLength", json!(101)),
        ("/imageDimensions/0/resource/sha256", json!("f".repeat(64))),
        ("/imageDimensions/0/resource/mimeType", json!("image/jpeg")),
        ("/sequenceManifests", json!([])),
        ("/sequenceManifests/0/manifest/width", json!(0)),
        ("/analysis/provenance/inputSha256", json!("f".repeat(64))),
        ("/analysis/provenance/review/status", json!("required")),
    ] {
        let mut bad = base.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(!reject(&bad).is_empty(), "accepted {path}");
    }
    for key in ["fontMetrics", "imageDimensions"] {
        let mut extra = base.clone();
        let copy = extra[key][0].clone();
        extra[key].as_array_mut().unwrap().push(copy);
        assert!(!reject(&extra).is_empty(), "duplicate {key}");
        for container in [
            "/source",
            "/source/recipe",
            "/source/recipe/nodes/0/scene",
            "/source/recipe/nodes/0/scene/settings",
        ] {
            let mut authored = base.clone();
            authored.pointer_mut(container).unwrap()[key] = json!([]);
            assert!(!reject(&authored).is_empty(), "author {container}/{key}");
        }
    }
}

#[test]
fn reviewed_and_manual_beats_match_all_three_modes_across_trim_and_refs() {
    for mode in ["breathe", "ignite", "collapse"] {
        let mut analyzed = request(mode);
        if mode == "collapse" {
            analyzed["source"]["recipe"]["nodes"][0]["scene"]["settings"]["keys"] =
                json!({"kind":"analysis","beats":{"kind":"analysis"}});
            // Explicit empty measured set exercises fallback, not missing measurement.
            analyzed["analysis"]["strongOnsets"] = json!({"method":"reference-onset-residual-p99-v1","normalizationScale":0,"events":[]});
        }
        let mut manual = analyzed.clone();
        let beats = json!({"kind":"manual","songTicks":analyzed["analysis"]["beats"]});
        if mode == "collapse" {
            manual["source"]["recipe"]["nodes"][0]["scene"]["settings"]["keys"]["beats"] = beats;
        } else {
            manual["source"]["recipe"]["nodes"][0]["scene"]["settings"]["beats"] = beats;
        }
        for with_ref in [false, true] {
            if with_ref {
                reverse(&mut analyzed, "card", 59);
                reverse(&mut manual, "card", 59);
            }
            for index in [0, 1, 14, 15, 16, 30, 44, 59] {
                for r in [&mut analyzed, &mut manual] {
                    r["clipDuration"] = json!(1);
                    r["trimStart"] = json!(index * 4004 + 1001);
                    r["timelineTime"] = json!(0);
                }
                assert_eq!(
                    frame(&analyzed)["recipePlan"],
                    frame(&manual)["recipePlan"],
                    "{mode}, ref={with_ref}, frame={index}"
                );
            }
        }
    }
}

#[test]
fn original_fixed_rng_ignores_source_seed_and_ignite_zero_means_five() {
    for mode in ["breathe", "ignite", "collapse"] {
        let mut r = request(mode);
        r["timelineTime"] = json!(90 * 4004);
        let original = frame(&r)["recipePlan"].clone();
        r["source"]["seed"] = json!(u32::MAX);
        assert_eq!(
            frame(&r)["recipePlan"],
            original,
            "source seed changed {mode}"
        );
        if mode == "ignite" {
            r["source"]["recipe"]["nodes"][0]["scene"]["settings"]["seed"] = json!(0);
            assert_eq!(
                frame(&r)["recipePlan"],
                original,
                "seed zero must use original fallback five"
            );
            r["source"]["recipe"]["nodes"][0]["scene"]["settings"]["seed"] = json!(7);
            assert_ne!(
                frame(&r)["recipePlan"],
                original,
                "nondefault crack seed must remain meaningful"
            );
        }
    }
}

#[test]
fn manual_collapse_needs_no_analysis_but_automatic_requires_measured_onsets() {
    let mut manual = request("collapse");
    manual["source"]["recipe"]
        .as_object_mut()
        .unwrap()
        .remove("audio");
    manual.as_object_mut().unwrap().remove("analysis");
    frame(&manual);
    let mut automatic = request("collapse");
    automatic["source"]["recipe"]["nodes"][0]["scene"]["settings"]["keys"] =
        json!({"kind":"analysis","beats":{"kind":"analysis"}});
    assert!(reject(&automatic).contains("strongOnsets"));
    automatic["analysis"]["strongOnsets"] =
        json!({"method":"reference-onset-residual-p99-v1","normalizationScale":0,"events":[]});
    frame(&automatic);
    // Missing resources cannot hide behind an already-black/stopped frame.
    let mut hidden = request("ignite");
    hidden["timelineTime"] = json!(280 * 4004);
    hidden["source"]["recipe"]["nodes"][0]["scene"]["settings"]["hud"]["font"] =
        json!("missing.ttf");
    assert!(!reject(&hidden).is_empty());
    let mut resized = request("collapse");
    resized["imageDimensions"][0]["width"] = json!(140);
    resized["imageDimensions"][0]["height"] = json!(360);
    assert_ne!(
        frame(&resized)["recipePlan"],
        frame(&request("collapse"))["recipePlan"]
    );
    complete_facts(&mut resized);
    assert_eq!(
        frame(&resized)["recipePlan"],
        frame(&request("collapse"))["recipePlan"]
    );
}
