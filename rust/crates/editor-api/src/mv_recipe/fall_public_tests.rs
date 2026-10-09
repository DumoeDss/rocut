use super::*;
fn request(frame: u64) -> Value {
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":120,"seed":17,"resources":resources(),
        "recipe":{"version":1,"root":"fall","songStartSeconds":4,"outputRoles":["graphics"],
            "nodes":[{"id":"fall","scene":{"kind":"fall","role":"graphics","span":{"startFrame":0,"durationFrames":120},"settings":author()}}]}},
        "clipStart":0,"clipDuration":480000,"trimStart":0,"timelineTime":frame*4000})
}
fn resolve(value: &Value) -> Value {
    serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
        value.to_string(),
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
fn public_fall_requires_bound_image_facts_and_no_fonts() {
    let r = request(50);
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
    let value = resolve(&r);
    assert!(value.get("error").is_none(), "{value}");
    assert_eq!(value["frame"]["recipePlan"]["root"]["kind"], "fall");
    let mut bad = r.clone();
    bad["imageDimensions"][0]["resource"]["sha256"] = json!("b".repeat(64));
    assert!(resolve(&bad).get("error").is_some());
}
#[test]
fn hidden_fall_and_malformed_args_are_checked_before_raster_ticket() {
    let mut r = request(0);
    r["source"]["recipe"]["root"] = json!("black");
    r["source"]["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"black","scene":{"kind":"solid","role":"graphics","color":[0,0,0,1]}}));
    r["source"]["recipe"]["nodes"][0]["scene"]["span"] =
        json!({"startFrame":60,"durationFrames":60});
    let value = resolve(&measured(r.clone()));
    assert!(value.get("error").is_none(), "{value}");
    assert_eq!(value["frame"]["recipePlan"]["root"]["kind"], "solid");
    for (key, value) in [
        ("char", json!("missing")),
        ("freeze", json!([[5, 4]])),
        ("freeze", Value::Null),
        ("pulse", Value::Null),
        ("pulse", json!(vec![5; 65])),
        ("speed", json!(-1)),
        ("speed", json!(8.01)),
        ("h", json!(8193)),
        ("variant", json!("default")),
    ] {
        let mut bad = r.clone();
        bad["source"]["recipe"]["nodes"][0]["scene"]["settings"][key] = value;
        assert!(resolve(&bad).get("error").is_some(), "accepted {key}");
    }
    let mut bad = measured(r);
    bad["imageDimensions"][0]["height"] = json!(1);
    assert!(resolve(&bad).get("error").is_some());
}
#[test]
fn source_references_use_same_original_shot_clock_and_json_round_trip() {
    let mut mapped = request(10);
    mapped["source"]["recipe"]["root"] = json!("reverse");
    mapped["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{"kind":"ref","input":"fall","timeMap":[{"atFrame":0,"sourceFrame":90},{"atFrame":30,"sourceFrame":0}]}}));
    let mapped = resolve(&measured(mapped));
    let direct = resolve(&measured(request(60)));
    assert!(mapped.get("error").is_none(), "{mapped}");
    assert!(direct.get("error").is_none(), "{direct}");
    assert_eq!(
        mapped["frame"]["recipePlan"]["root"]["input"]["data"],
        direct["frame"]["recipePlan"]["root"]["data"]
    );
}
#[test]
fn midpoint_replay_cost_is_charged_per_expanded_dag_reference() {
    let mut r = request(0);
    r["source"]["durationFrames"] = json!(90000);
    r["clipDuration"] = json!(360000000u64);
    r["source"]["recipe"]["nodes"][0]["scene"]["span"]["durationFrames"] = json!(90000);
    assert!(resolve(&r).get("error").is_none());
    let items:Vec<_>=(0..4).map(|i|json!({"input":"fall","span":{"startFrame":i,"durationFrames":1},"timeMap":[{"atFrame":0,"sourceFrame":0}]})).collect();
    r["source"]["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"repeat","scene":{"kind":"sequence","items":items}}));
    r["source"]["recipe"]["root"] = json!("repeat");
    let failed = resolve(&r);
    assert!(failed["error"].to_string().contains("80000000"), "{failed}");
}
