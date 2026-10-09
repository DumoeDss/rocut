use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn resource(id: &str, kind: &str, hash: u64) -> Value {
    let sha = format!("{hash:064x}");
    json!({"id":id,"kind":kind,"sha256":sha,"byteLength":1,
        "attachmentKey":format!("{}{}",if kind=="source" {"programmatic-source-sha256-"} else {"programmatic-sha256-"},sha),
        "mimeType":match kind {"source"=>"application/octet-stream","imageSequence"=>"application/vnd.rocut.image-sequence+json",_=>"image/png"}})
}
fn manifest() -> Value {
    json!({"version":1,"shotId":"shot-a","renderId":"render-a",
        "frameRate":{"numerator":24000,"denominator":1001},"width":1920,"height":1080,
        "firstFileFrame":1001,"alpha":"straight","colorSpace":"srgb",
        "frames":(0..222).map(|i|resource(&format!("frames/{i}.png"),"image",i+1)).collect::<Vec<_>>(),
        "provenance":{"engine":"blender","version":"5.0.0","entryFile":"scene.blend","parameters":{},
            "originalManifest":resource("original/render.json","source",80000),
            "sourceFiles":[{"path":"scene.blend","byteLength":1,"sha256":format!("{:064x}",80001),
                "parts":[resource("source/scene.blend","source",80001)]}]}})
}
fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":160,"height":96,
        "frameRate":{"numerator":30000,"denominator":1001},"durationFrames":300,"seed":3,
        "resources":[resource("shot-a/sequence.json","imageSequence",90000)],
        "recipe":{"version":1,"root":"sequence","songStartSeconds":12.25,"outputRoles":["background"],
            "nodes":[{"id":"sequence","scene":{"kind":"imageSequence","sequence":"shot-a/sequence.json",
                "originSourceTicks":0,"rate":{"numerator":1,"denominator":1},"role":"background","view":{"x":0,"y":0,"zoom":1}}}]}})
}
fn request() -> Value {
    json!({"source":source(),"clipStart":0,"clipDuration":1201200,"trimStart":0,"timelineTime":0,
        "sequenceManifests":[{"resourceId":"shot-a/sequence.json","manifest":manifest()}]})
}
fn resolve(r: &Value) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap()
}
fn ordinal(r: &Value) -> u64 {
    let result = resolve(r);
    assert!(result["error"].is_null(), "{result}");
    result["frame"]["sequenceImages"][0]["ordinal"]
        .as_u64()
        .unwrap()
}
fn valid(s: &Value) -> bool {
    let result: Value = serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":1201200,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap();
    result.as_array().unwrap().is_empty()
}

#[test]
fn maps_30000_1001_to_24000_1001_once_without_double_floor_and_keeps_fractional_trim() {
    let mut r = request();
    assert!(valid(&r["source"])); // authoring validation needs no loaded manifest.
    for frame in [0, 1, 4, 5, 100, 221, 276, 299] {
        r["timelineTime"] = json!(frame * 4004);
        assert_eq!(ordinal(&r), (frame * 4 / 5).min(221));
    }
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    let result = resolve(&r);
    assert_eq!(ordinal(&r), 1); // flooring to source frame 1 first would return 0.
    assert_eq!(result["frame"]["index"], 1);
    assert_eq!(result["frame"]["sourceTime"], 4004);
    assert_eq!(result["frame"]["sampleTime"], 5005);
    assert_eq!(result["frame"]["sequenceImages"][0]["width"], 1920);
    assert_eq!(result["frame"]["sequenceImages"][0]["height"], 1080);
    assert_eq!(result["frame"]["sequenceImages"][0]["alpha"], "straight");
    assert_eq!(
        result["frame"]["sequenceLimits"],
        json!({"maxDimension":8192,"maxDecodedBytes":134217728})
    );
    let image = &result["frame"]["sequenceImages"][0];
    assert_eq!(
        result["frame"]["recipePlan"]["root"]["imageKey"],
        image["imageKey"]
    );
    assert_eq!(image["manifestId"], "shot-a/sequence.json");
    assert_eq!(
        image["manifestSha256"],
        r["source"]["resources"][0]["sha256"]
    );
    r["trimStart"] = json!(3337);
    r["source"]["recipe"]["nodes"][0]["scene"]["rate"] = json!({"numerator":3,"denominator":2});
    assert_eq!(ordinal(&r), 1); // one floor across trim, playback and sequence FPS.
}

#[test]
fn signed_origin_zero_rate_and_file_numbering_are_independent_of_sequence_clock() {
    let mut r = request();
    r["timelineTime"] = json!(50050);
    assert_eq!(ordinal(&r), 10);
    r["source"]["recipe"]["nodes"][0]["scene"]["originSourceTicks"] = json!(5005);
    assert_eq!(ordinal(&r), 9);
    r["source"]["recipe"]["nodes"][0]["scene"]["originSourceTicks"] = json!(-5005);
    assert_eq!(ordinal(&r), 11);
    r["source"]["recipe"]["nodes"][0]["scene"]["originSourceTicks"] = json!(9007199254740991u64);
    assert_eq!(ordinal(&r), 0);
    r["source"]["recipe"]["nodes"][0]["scene"]["originSourceTicks"] = json!(-9007199254740991i64);
    r["source"]["recipe"]["nodes"][0]["scene"]["rate"]["numerator"] = json!(120000);
    assert_eq!(ordinal(&r), 221);
    r["source"]["recipe"]["nodes"][0]["scene"]["rate"]["numerator"] = json!(0);
    assert_eq!(ordinal(&r), 0);
    r["sequenceManifests"][0]["manifest"]["firstFileFrame"] = json!(7654321);
    assert_eq!(ordinal(&r), 0);
    for origin in [
        json!(9007199254740992u64),
        json!(-9007199254740992i64),
        json!(i64::MIN),
        json!(0.5),
    ] {
        let mut bad = r.clone();
        bad["source"]["recipe"]["nodes"][0]["scene"]["originSourceTicks"] = origin;
        assert!(resolve(&bad)["error"].is_string());
    }
    for rate in [
        json!({"numerator":-1,"denominator":1}),
        json!({"numerator":0.5,"denominator":1}),
        json!({"numerator":120001,"denominator":1}),
        json!({"numerator":1,"denominator":0}),
        json!({"numerator":1,"denominator":120001}),
        json!({"numerator":u64::MAX,"denominator":1}),
    ] {
        let mut bad = request();
        bad["source"]["recipe"]["nodes"][0]["scene"]["rate"] = rate;
        assert!(resolve(&bad)["error"].is_string());
    }
}

#[test]
fn reverse_refs_and_two_refs_to_one_sequence_keep_distinct_frames_and_share_equal_samples() {
    let mut r = request();
    r["source"]["recipe"]["root"] = json!("blend");
    let nodes = r["source"]["recipe"]["nodes"].as_array_mut().unwrap();
    nodes.push(json!({"id":"a","scene":{"kind":"ref","input":"sequence","timeMap":[{"atFrame":0,"sourceFrame":100},{"atFrame":200,"sourceFrame":0}]}}));
    nodes.push(json!({"id":"b","scene":{"kind":"ref","input":"sequence","timeMap":[{"atFrame":0,"sourceFrame":10}]}}));
    nodes.push(json!({"id":"blend","scene":{"kind":"transition","from":"a","to":"b","span":{"startFrame":0,"durationFrames":200},"easing":"linear","style":{"kind":"xfade"}}}));
    r["timelineTime"] = json!(100 * 4004);
    let result = resolve(&r);
    assert!(result["error"].is_null(), "{result}");
    let mut samples = result["frame"]["sequenceImages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["ordinal"].as_u64().unwrap())
        .collect::<Vec<_>>();
    samples.sort();
    assert_eq!(samples, vec![8, 40]);
    assert_ne!(
        result["frame"]["recipePlan"]["root"]["from"]["input"]["imageKey"],
        result["frame"]["recipePlan"]["root"]["to"]["input"]["imageKey"]
    );
    r["source"]["recipe"]["nodes"][2]["scene"]["timeMap"][0]["sourceFrame"] = json!(50);
    assert_eq!(
        resolve(&r)["frame"]["sequenceImages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    r["source"]["recipe"]["root"] = json!("a");
    r["clipDuration"] = json!(1);
    r["trimStart"] = json!(5005);
    r["timelineTime"] = json!(0);
    assert_eq!(ordinal(&r), 79); // ref at source frame 1 -> sampled frame 99 -> floor(99*4/5).
}

#[test]
fn requires_exact_manifest_coverage_and_refuses_deferred_inputs_or_non_recipe_sequences() {
    let mut missing = request();
    missing.as_object_mut().unwrap().remove("sequenceManifests");
    assert!(resolve(&missing)["error"].is_string());
    missing["deferRecipe"] = json!(true);
    let deferred = resolve(&missing);
    assert!(deferred["error"].is_null(), "{deferred}");
    assert!(deferred["frame"].get("sequenceImages").is_none());
    assert_eq!(deferred["frame"]["sampleTime"], 0);
    let mut fractional_defer = missing.clone();
    fractional_defer["clipDuration"] = json!(1);
    fractional_defer["trimStart"] = json!(5005);
    let deferred = resolve(&fractional_defer);
    assert_eq!(deferred["frame"]["sourceTime"], 4004);
    assert_eq!(deferred["frame"]["sampleTime"], 5005);
    let mut resumed = request();
    resumed["clipDuration"] = json!(1);
    resumed["trimStart"] = deferred["frame"]["sampleTime"].clone();
    assert_eq!(ordinal(&resumed), 1);
    for manifests in [
        json!([]),
        Value::Null,
        request()["sequenceManifests"].clone(),
    ] {
        let mut bad = missing.clone();
        bad["sequenceManifests"] = manifests;
        assert!(resolve(&bad)["error"].is_string());
    }
    for mode in ["duplicate", "extra", "empty", "wrong"] {
        let mut bad = request();
        let first = bad["sequenceManifests"][0].clone();
        match mode {
            "duplicate" => bad["sequenceManifests"].as_array_mut().unwrap().push(first),
            "extra" => {
                let mut extra = first;
                extra["resourceId"] = json!("extra.json");
                bad["sequenceManifests"].as_array_mut().unwrap().push(extra);
            }
            "empty" => bad["sequenceManifests"] = json!([]),
            _ => bad["sequenceManifests"][0]["resourceId"] = json!("wrong.json"),
        }
        assert!(resolve(&bad)["error"].is_string(), "{mode}");
    }
    let mut many = request();
    many["source"]["resources"] = json!(
        (0..9)
            .map(|i| resource(&format!("sequence-{i}.json"), "imageSequence", 90000 + i))
            .collect::<Vec<_>>()
    );
    assert!(resolve(&many)["error"].is_string());
    let mut non_recipe = source();
    non_recipe.as_object_mut().unwrap().remove("recipe");
    non_recipe["code"] = json!("paint()");
    assert!(!valid(&non_recipe));
    let mut ordinary = missing;
    ordinary["source"]["resources"] = json!([]);
    ordinary["source"]["recipe"]["nodes"][0]["scene"] =
        json!({"kind":"solid","role":"background","color":[0,0,0,1]});
    let result = resolve(&ordinary);
    assert!(result["error"].is_null(), "{result}");
    assert!(result["frame"].get("sampleTime").is_none());
    assert!(result["frame"].get("sequenceLimits").is_none());
}

#[test]
fn current_frame_decode_budget_counts_distinct_samples_not_just_declared_manifests() {
    let mut r = request();
    r["sequenceManifests"][0]["manifest"]["width"] = json!(8192);
    r["sequenceManifests"][0]["manifest"]["height"] = json!(4096); // exactly 128 MiB.
    assert_eq!(ordinal(&r), 0);
    r["source"]["recipe"]["root"] = json!("blend");
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().extend([
        json!({"id":"later","scene":{"kind":"ref","input":"sequence","timeMap":[{"atFrame":0,"sourceFrame":100}]}}),
        json!({"id":"blend","scene":{"kind":"transition","from":"sequence","to":"later","span":{"startFrame":0,"durationFrames":200},"easing":"linear","style":{"kind":"xfade"}}}),
    ]);
    r["timelineTime"] = json!(50 * 4004);
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("decode budget")
    );
    r["sequenceManifests"][0]["manifest"]["frames"][80] =
        r["sequenceManifests"][0]["manifest"]["frames"][40].clone();
    r["sequenceManifests"][0]["manifest"]["frames"][80]["id"] = json!("frames/repeated.png");
    let shared = resolve(&r);
    assert!(shared["error"].is_null(), "{shared}");
    assert_eq!(
        shared["frame"]["sequenceImages"].as_array().unwrap().len(),
        2
    );
}

#[test]
fn decoded_content_is_shared_across_manifests_but_conflicting_dimensions_are_rejected() {
    let mut r = request();
    r["sequenceManifests"][0]["manifest"]["width"] = json!(8192);
    r["sequenceManifests"][0]["manifest"]["height"] = json!(4096);
    let second = r["sequenceManifests"][0]["manifest"].clone();
    r["source"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(resource("shot-b/sequence.json", "imageSequence", 90001));
    r["sequenceManifests"]
        .as_array_mut()
        .unwrap()
        .push(json!({"resourceId":"shot-b/sequence.json","manifest":second}));
    let mut leaf = r["source"]["recipe"]["nodes"][0].clone();
    leaf["id"] = json!("other");
    leaf["scene"]["sequence"] = json!("shot-b/sequence.json");
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().extend([
        leaf,
        json!({"id":"blend","scene":{"kind":"transition","from":"sequence","to":"other","span":{"startFrame":0,"durationFrames":200},"easing":"linear","style":{"kind":"xfade"}}}),
    ]);
    r["source"]["recipe"]["root"] = json!("blend");
    r["timelineTime"] = json!(50 * 4004);
    let shared = resolve(&r);
    assert!(shared["error"].is_null(), "{shared}");
    let images = shared["frame"]["sequenceImages"].as_array().unwrap();
    assert_eq!(images.len(), 2);
    assert_ne!(images[0]["imageKey"], images[1]["imageKey"]);
    assert_eq!(images[0]["resource"], images[1]["resource"]);
    r["sequenceManifests"][1]["manifest"]["height"] = json!(2048);
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("dimensions")
    );
}
