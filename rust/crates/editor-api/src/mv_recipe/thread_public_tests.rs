use super::*;
fn request(frame: u64) -> Value {
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":120,"seed":17,"resources":resources(),
        "recipe":{"version":1,"root":"thread","songStartSeconds":0,"outputRoles":["graphics"],
            "nodes":[{"id":"thread","scene":{"kind":"thread","role":"graphics","span":{"startFrame":0,"durationFrames":120},"settings":author()}}]}},
        "clipStart":0,"clipDuration":480000,"trimStart":0,"timelineTime":frame*4000})
}
fn resolve(v: &Value) -> Value {
    serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
        v.to_string(),
    ))
    .unwrap()
}
fn measured(mut r: Value) -> Value {
    let pending = resolve(&r);
    assert!(pending.get("error").is_none(), "{pending}");
    r["imageDimensions"] =
        json!([{"resource":r["source"]["resources"][0],"width":960,"height":1600}]);
    r
}
#[test]
fn public_discovery_needs_exact_image_facts_but_no_font_measurement() {
    let r = request(60);
    let pending = resolve(&r);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert!(
        pending["frame"]
            .get("fontMetricRequests")
            .is_none_or(|v| v.as_array().unwrap().is_empty())
    );
    assert_eq!(
        pending["frame"]["imageDimensionRequests"][0]["resource"],
        r["source"]["resources"][0]
    );
    let r = measured(r);
    let ready = resolve(&r);
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "thread");
    let mut mismatch = r.clone();
    mismatch["imageDimensions"][0]["resource"]["sha256"] = json!("b".repeat(64));
    assert!(resolve(&mismatch).get("error").is_some());
}
#[test]
fn hidden_thread_checks_images_and_bad_inputs_before_any_raster_ticket() {
    let mut r = request(0);
    r["source"]["recipe"]["root"] = json!("black");
    r["source"]["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"black","scene":{"kind":"solid","role":"graphics","color":[0,0,0,1]}}));
    r["source"]["recipe"]["nodes"][0]["scene"]["span"] =
        json!({"startFrame":60,"durationFrames":60});
    let ready = resolve(&measured(r.clone()));
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "solid");
    for (key, value) in [
        ("hand", json!("missing")),
        ("stops", json!([[2, 1]])),
        ("stops", Value::Null),
        ("handH", json!(8193)),
        ("handRot", json!(33)),
        ("light", json!([0, 8193])),
        ("audioStops", json!([])),
    ] {
        let mut bad = r.clone();
        bad["source"]["recipe"]["nodes"][0]["scene"]["settings"][key] = value;
        assert!(resolve(&bad).get("error").is_some(), "accepted {key}");
    }
}
#[test]
fn reference_mapping_replays_the_same_plan_without_local_clock_drift() {
    let mut mapped = request(10);
    mapped["source"]["recipe"]["root"] = json!("reverse");
    mapped["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{"kind":"ref","input":"thread","timeMap":[{"atFrame":0,"sourceFrame":90},{"atFrame":30,"sourceFrame":0}]}}));
    let mapped = resolve(&measured(mapped));
    let direct = resolve(&measured(request(60)));
    assert!(mapped.get("error").is_none(), "{mapped}");
    assert!(direct.get("error").is_none(), "{direct}");
    assert_eq!(
        mapped["frame"]["recipePlan"]["root"]["input"]["data"],
        direct["frame"]["recipePlan"]["root"]["data"]
    );
}
