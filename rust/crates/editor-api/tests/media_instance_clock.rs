use editor_api::query_media_instance_clock_json;
use serde_json::{Value, json};
fn fixture() -> (Value, Value) {
    let d = json!({"revision":3,"project":{"id":"project","sceneState":{"currentSceneId":"main","scenes":[{"id":"main","isMain":true},{"id":"other","isMain":false}]}},"tracks":[{"id":"track","sceneId":"other"}],"clips":[{"id":"clip","trackId":"track","assetId":"video","startTime":120000,"duration":120000,"trimStart":120000,"trimEnd":0}],"assets":[{"id":"video","kind":"video","sourceSha256":"a".repeat(64),"duration":360000}]});
    let frames:Vec<Value>=(0..90).map(|i|json!({"ptsMicroseconds":(i*1_000_000_i64+15)/30,"durationMicroseconds":((i+1)*1_000_000_i64+15)/30-(i*1_000_000_i64+15)/30})).collect();
    let r = json!({"expectedNativeRevision":3,"nativeProjectId":"project","sceneId":"other","clipId":"clip","sourceSha256":"a".repeat(64),"sceneTick":180000,"decodedEndMicroseconds":3000000,"frames":frames,"timestampToleranceMicroseconds":2,"director":{"rangeStartTick":48000,"rangeEndTick":192000,"fps":30,"totalFrames":90}});
    (d, r)
}
fn run(d: &Value, r: &Value) -> Value {
    serde_json::from_str(&query_media_instance_clock_json(
        json!({"document":d,"request":r}).to_string(),
    ))
    .unwrap()
}
#[test]
fn maps_nonactive_scene_trim_and_archived_director_range_with_containing_frame() {
    let (d, r) = fixture();
    let v = run(&d, &r);
    assert_eq!(v["status"], "ready", "{v}");
    assert_eq!(v["source"]["tick"], 180000);
    assert_eq!(v["frame"]["index"], 45);
    assert_eq!(v["director"]["tick"], 120000);
    assert_eq!(v["projectGlobal"]["status"], "not-asserted");
    assert_eq!(d["project"]["sceneState"]["currentSceneId"], "main");
}
#[test]
fn delegates_rate_reverse_freeze_and_preserves_subframe_residual() {
    let (mut d, mut r) = fixture();
    d["clips"][0]["retime"] = json!({"rate":2.0});
    assert_eq!(run(&d, &r)["source"]["tick"], 240000);
    d["clips"][0]["retime"] = json!({"rate":0.5});
    assert_eq!(run(&d, &r)["source"]["tick"], 150000);
    d["clips"][0]["retime"] = json!({"rate":1.0,"reverse":true});
    assert_eq!(run(&d, &r)["source"]["tick"], 179999);
    d["clips"][0]["freezeFrame"] = json!(160001);
    let v = run(&d, &r);
    assert_eq!(v["source"]["tick"], 160001);
    assert_eq!(v["frame"]["index"], 40);
    assert!(
        v["frame"]["sourceSampleResidual"]["numerator"]
            .as_i64()
            .unwrap()
            > 0
    );
    r["sceneTick"] = json!(240000);
    assert_eq!(
        run(&d, &r)["reason"],
        "media-instance-query-outside-half-open-clip"
    );
}
#[test]
fn refuses_mismatched_identity_short_sources_and_forged_schedules() {
    let (d, r) = fixture();
    let mut bad = r.clone();
    bad["expectedNativeRevision"] = json!(2);
    assert_eq!(run(&d, &bad)["status"], "conflict");
    bad = r.clone();
    bad["sourceSha256"] = json!("b".repeat(64));
    assert_eq!(run(&d, &bad)["status"], "conflict");
    bad = r.clone();
    bad["decodedEndMicroseconds"] = json!(1500000);
    assert_eq!(
        run(&d, &bad)["reason"],
        "media-instance-decoded-source-too-short"
    );
    bad = r.clone();
    bad["frames"][2]["ptsMicroseconds"] = json!(100000);
    assert_eq!(
        run(&d, &bad)["reason"],
        "media-instance-frame-schedule-discontinuous"
    );
    bad = r.clone();
    bad["sceneId"] = json!("main");
    assert_eq!(run(&d, &bad)["status"], "conflict");
}
