use editor_api::{query_music_grid_json, validate_cut_plan_json};
use serde_json::{Value, json};
fn fixture(fps: Value) -> (Value, Value) {
    let step = 120000 * fps["denominator"].as_i64().unwrap() / fps["numerator"].as_i64().unwrap();
    let end = (120600 + step - 1) / step * step;
    let doc = json!({"revision":7,"project":{"id":"project","frameRate":fps,"sceneState":{"scenes":[{"id":"scene","isMain":true}]},"musicGridState":{"version":1,"grids":[{"id":"grid","revision":1,"mode":"manual","assetId":"audio","sourceSha256":"a".repeat(64),"sourceDurationTick":120600,"reviewReference":"reviewed","analysisProvenance":null,"points":[{"id":"start","sourceTick":0},{"id":"middle","sourceTick":60000}]}],"bindings":[{"id":"binding","gridId":"grid","clipId":"song","assetId":"audio","sceneId":"scene"}]}},
      "tracks":[{"id":"song-track","sceneId":"scene"}],"clips":[{"id":"song","trackId":"song-track","assetId":"audio","startTime":0,"duration":120600,"trimStart":0,"trimEnd":0}],"assets":[{"id":"audio","kind":"audio","sourceSha256":"a".repeat(64),"duration":120600}]});
    let grid: Value = serde_json::from_str(&query_music_grid_json(
        json!({"document":doc,"request":{"kind":"read","bindingId":"binding"}}).to_string(),
    ))
    .unwrap();
    assert_eq!(grid["status"], "ready", "{grid}");
    let request = json!({"authorClock":{"sceneOriginTick":0,"songOriginTick":0},"expectedNativeRevision":7,"grid":{"bindingId":"binding","expectedGridRevision":1,"expectedMappingHash":grid["mappingHash"]},
      "coverage":{"scope":"full-song","range":{"startTick":0,"endTick":end},"tracks":[{"trackId":"visual","mode":"contiguous"}]},
      "boundaries":[{"key":"a","tick":0,"pointId":"start"},{"key":"b","tick":60000,"pointId":"middle"},{"key":"c","tick":120600,"offGridReason":"cover final audio sample with a real source frame"}],
      "clips":[{"nodeId":"one","trackId":"visual","startBoundary":"a","endBoundary":"b","sourceStartTick":0,"source":{"kind":"video","sha256":"b".repeat(64),"decodedEndMicroseconds":2000000}},
        {"nodeId":"two","trackId":"visual","startBoundary":"b","endBoundary":"c","sourceStartTick":0,"source":{"kind":"video","sha256":"c".repeat(64),"decodedEndMicroseconds":2000000}}],
      "audioEnd":{"sourceSha256":"a".repeat(64),"sampleRate":48000,"decodedSamples":48240,"sceneStartTick":0,"sourceStartTick":0,"authorEndTick":120600},"visualTail":{"policy":"real-source"}});
    (doc, request)
}
fn run(doc: &Value, r: &Value) -> Value {
    serde_json::from_str(&validate_cut_plan_json(
        json!({"document":doc,"request":r}).to_string(),
    ))
    .unwrap()
}
fn has(r: &Value, code: &str) -> bool {
    r["issues"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|v| v["code"] == code))
}
#[test]
fn quantizes_shared_boundaries_once_at_all_supported_rates_and_preserves_audio_samples() {
    for fps in [
        json!({"numerator":24,"denominator":1}),
        json!({"numerator":25,"denominator":1}),
        json!({"numerator":30,"denominator":1}),
        json!({"numerator":30000,"denominator":1001}),
    ] {
        let (doc, r) = fixture(fps);
        let result = run(&doc, &r);
        assert_eq!(result["status"], "ready", "{result}");
        assert_eq!(
            result["clips"][0]["range"]["endTick"],
            result["clips"][1]["range"]["startTick"]
        );
        assert_eq!(result["audioEnd"], 120600);
        assert!(result["visualEndTick"].as_i64().unwrap() >= 120600);
        assert_eq!(
            result["audioSampleEnd"],
            json!({"numerator":5788800000_i64,"denominator":48000})
        );
    }
}
#[test]
fn boundary_collisions_never_reorder_or_drop_clips() {
    let (doc, mut r) = fixture(json!({"numerator":30,"denominator":1}));
    r["boundaries"][1] = json!({"key":"b","tick":1000,"offGridReason":"intentional close cut"});
    let result = run(&doc, &r);
    assert_eq!(result["status"], "blocked");
    assert!(has(&result, "boundary-collision-or-order"));
    assert!(has(&result, "clip-shorter-than-one-frame"));
    assert_eq!(result["clips"].as_array().unwrap().len(), 2);
}
#[test]
fn validates_coverage_source_ranges_and_explicit_tail_without_clamping() {
    let (doc, r) = fixture(json!({"numerator":30,"denominator":1}));
    let mut bad = r.clone();
    bad["clips"][1]["source"]["decodedEndMicroseconds"] = json!(10000);
    assert!(has(&run(&doc, &bad), "source-out-of-bounds"));
    let mut gap = r.clone();
    gap["clips"][1]["startBoundary"] = json!("c");
    assert!(has(&run(&doc, &gap), "track-gap"));
    let mut overlap = r.clone();
    overlap["clips"][1]["startBoundary"] = json!("a");
    assert!(has(&run(&doc, &overlap), "track-overlap"));
    let mut tail = r.clone();
    tail["visualTail"] = json!({"policy":"fixed-image","nodeId":"two"});
    assert!(has(&run(&doc, &tail), "fixed-image-tail-required"));
    tail["clips"][1]["source"]["kind"] = json!("image");
    assert_eq!(run(&doc, &tail)["status"], "ready");
    let mut truncated = r.clone();
    truncated["audioEnd"]["decodedSamples"] = json!(48241);
    assert!(has(&run(&doc, &truncated), "audio-end-truncated-or-padded"));
}
#[test]
fn refuses_stale_native_grid_source_mapping_and_unsupported_clock() {
    let (doc, r) = fixture(json!({"numerator":30,"denominator":1}));
    for (key, value) in [("revision", json!(8))] {
        let mut changed = doc.clone();
        changed[key] = value;
        assert_eq!(run(&changed, &r)["status"], "conflict");
    }
    let mut changed = doc.clone();
    changed["project"]["musicGridState"]["grids"][0]["revision"] = json!(2);
    assert_eq!(run(&changed, &r)["status"], "conflict");
    let mut changed = doc.clone();
    changed["clips"][0]["startTime"] = json!(4000);
    assert_eq!(run(&changed, &r)["status"], "conflict");
    let mut changed = r.clone();
    changed["audioEnd"]["sourceSha256"] = json!("f".repeat(64));
    assert_eq!(run(&doc, &changed)["status"], "conflict");
}
#[test]
fn partial_replan_has_explicit_coverage_without_requiring_song_tail_replacement() {
    let (doc, mut r) = fixture(json!({"numerator":30,"denominator":1}));
    r["coverage"]["scope"] = json!("partial");
    r["coverage"]["range"]["endTick"] = json!(60000);
    r["boundaries"].as_array_mut().unwrap().pop();
    r["clips"].as_array_mut().unwrap().pop();
    assert_eq!(run(&doc, &r)["status"], "ready");
}
#[test]
fn maps_author_coordinates_to_scene_without_changing_author_ranges() {
    let (mut doc, mut r) = fixture(json!({"numerator":30,"denominator":1}));
    doc["clips"][0]["startTime"] = json!(4000);
    let grid: Value = serde_json::from_str(&query_music_grid_json(
        json!({"document":doc,"request":{"kind":"read","bindingId":"binding"}}).to_string(),
    ))
    .unwrap();
    r["grid"]["expectedMappingHash"] = grid["mappingHash"].clone();
    r["authorClock"]["sceneOriginTick"] = json!(4000);
    let result = run(&doc, &r);
    assert_eq!(result["status"], "ready", "{result}");
    assert_eq!(result["clips"][0]["range"]["startTick"], 0);
    assert_eq!(result["boundaries"][0]["nativeFrameTick"], 4000);
    assert_eq!(result["boundaries"][1]["frameTick"], 60000);
    r["authorClock"]["sceneOriginTick"] = json!(1);
    assert_eq!(
        run(&doc, &r)["reason"],
        "cut-plan-author-scene-mapping-unavailable"
    );
}
