use super::resolve_programmatic_frame_json;
use serde_json::{Value, json};

fn request() -> Value {
    let digest = "ab".repeat(32);
    let resource = json!({"id":"font","kind":"font","attachmentKey":format!("programmatic-sha256-{digest}"),
        "mimeType":"font/ttf","byteLength":100,"sha256":digest,
        "font":{"family":"Fixture","style":"normal","weight":500,"axes":{"wght":550.0}}});
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":60,"seed":0,"resources":[resource],
        "recipe":{"version":1,"root":"card","songStartSeconds":0,"outputRoles":["graphics"],"post":[],
            "nodes":[{"id":"card","scene":{"kind":"typeCard","role":"graphics",
                "span":{"startFrame":0,"durationFrames":60},"settings":{
                    "mode":"quiet","font":"font","glyphs":[{"text":"A","opticalScale":1}],
                    "fontSize":100.0/1080.0,"center":[0.5,0.5],"orientation":"horizontal","gap":0,
                    "lead":0,"stagger":0,"fade":0.1,"color":[1,1,1,1],"background":[0,0,0,1],
                    "rule":null,"subtitle":null,"grain":0}}}]}},
        "clipStart":120000,"clipDuration":240000,"trimStart":0,"timelineTime":240000})
}
fn resolve(v: &Value) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(v.to_string())).unwrap()
}
fn supply(v: &mut Value) {
    v["fontMetrics"] = json!([{"resource":v["source"]["resources"][0],"glyphs":[
        {"text":"A","left":20,"right":30,"ascent":40,"descent":10}]}]);
}

#[test]
fn two_phase_frame_mapping_and_layout_require_matching_platform_facts() {
    let mut r = request();
    let deferred = resolve(&r);
    assert!(deferred.get("error").is_none(), "{deferred}");
    assert!(deferred["frame"].get("recipePlan").is_none());
    assert_eq!(
        deferred["frame"]["fontMetricRequests"][0]["glyphs"],
        json!(["A"])
    );
    assert_eq!(
        deferred["frame"]["fontMetricRequests"][0]["resource"],
        r["source"]["resources"][0]
    );
    supply(&mut r);
    r["sequenceManifests"] = json!([]);
    let evaluated = resolve(&r);
    assert!(evaluated.get("error").is_none(), "{evaluated}");
    assert_eq!(evaluated["frame"]["index"], 30);
    assert_eq!(evaluated["frame"]["sourceTime"], 120000);
    assert_eq!(
        evaluated["frame"]["recipePlan"]["root"]["data"]["quiet"]["glyphs"][0]["position"],
        json!([955.0, 540.0])
    );
    r["timelineTime"] = json!(120000);
    r["trimStart"] = json!(120000);
    r["clipDuration"] = json!(120000);
    let trimmed = resolve(&r);
    assert_eq!(
        trimmed["frame"]["recipePlan"],
        evaluated["frame"]["recipePlan"]
    );
}

#[test]
fn frame_boundary_rejects_unbound_stale_and_persisted_measurements() {
    let mut base = request();
    supply(&mut base);
    for (path, value) in [
        ("/fontMetrics", json!(null)),
        ("/fontMetrics", json!([])),
        ("/fontMetrics/0/resource/font/axes/wght", json!(551)),
        ("/fontMetrics/0/glyphs/0/text", json!("B")),
        ("/fontMetrics/0/glyphs/0/right", json!(-30)),
    ] {
        let mut r = base.clone();
        *r.pointer_mut(path).unwrap() = value;
        assert!(resolve(&r)["error"].is_string(), "{path}");
    }
    let mut r = base.clone();
    r["deferRecipe"] = json!(true);
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("nondeferred")
    );
    let mut r = base.clone();
    r["source"]["fontMetrics"] = r["fontMetrics"].clone();
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("unknown field")
    );
    let mut r = base;
    r["source"]["recipe"] = json!(null);
    assert!(resolve(&r)["error"].is_string());
}
