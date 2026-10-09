use editor_api::{
    mv_recipe_catalog_json, prepare_mv_audio_json, resolve_programmatic_frame_json,
    validate_clip_editing_json,
};
use serde_json::{Value, json};

fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,
        "frameRate":{"numerator":24,"denominator":1},"durationFrames":24,"seed":7,
        "recipe":{"version":1,"root":"solid","songStartSeconds":0,"outputRoles":["foreground"],
            "nodes":[{"id":"solid","scene":{"kind":"solid","role":"foreground","color":[0.2,0.2,0.2,0.5]}}],
            "post":[{"stage":"composite","effects":[{"kind":"vignette","amount":0.9}],
                "automation":[{"effect":0,"keyframes":[
                    {"frame":5,"value":0.2,"easing":"linear"},
                    {"frame":15,"value":0.8,"easing":"linear"}]}]}]}})
}
#[test]
fn discovered_finishing_effects_accept_curves_and_resolve_at_both_stages() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    assert_eq!(catalog["finishing"]["automation"]["maxKeyframes"], 256);
    assert_eq!(
        catalog["finishing"]["effects"].as_object().unwrap().len(),
        6
    );
    for kind in catalog["finishing"]["effects"].as_object().unwrap().keys() {
        for stage in ["role", "composite"] {
            let mut s = source();
            let mut e = json!({"kind":kind,"amount":0.2});
            if kind == "flash" {
                e["color"] = json!([0.1, 0.2, 0.3]);
            }
            if kind == "letterbox" {
                e["heightFraction"] = json!(0.1203);
            }
            if kind == "lightLeak" {
                e["alpha"] = json!("preserve");
            }
            s["recipe"]["post"][0]["stage"] = json!(stage);
            if stage == "role" {
                s["recipe"]["post"][0]["roles"] = json!(["foreground"]);
            }
            s["recipe"]["post"][0]["effects"] = json!([e]);
            assert!(valid(&s), "cannot save advertised {kind}/{stage}");
            assert!(
                resolve(&s, 10, None)["frame"].is_object(),
                "cannot evaluate advertised {kind}/{stage}"
            );
            if kind == "lightLeak" {
                let resolved = resolve(&s, 10, None);
                let plan = &resolved["frame"]["recipePlan"]["post"][0]["effects"][0];
                near(&plan["effect"]["amount"], 0.5);
                assert_eq!(plan["lightLeak"]["gradients"].as_array().unwrap().len(), 2);
                assert!(
                    plan["lightLeak"]["gradients"][0]["stops"][0]["color"][3]
                        .as_f64()
                        .unwrap()
                        > 0.0
                );
            }
        }
    }
}

fn step(s: &Value) -> u64 {
    120000 * s["frameRate"]["denominator"].as_u64().unwrap()
        / s["frameRate"]["numerator"].as_u64().unwrap()
}
fn resolve(s: &Value, frame: u64, analysis: Option<Value>) -> Value {
    let mut request = json!({"source":s,"clipStart":0,
        "clipDuration":s["durationFrames"].as_u64().unwrap()*step(s),"trimStart":0,"timelineTime":frame*step(s)});
    if let Some(data) = analysis {
        request["analysis"] = data;
    }
    serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap()
}
fn effect(s: &Value, frame: u64) -> Value {
    resolve(s, frame, None)["frame"]["recipePlan"]["post"][0]["effects"][0]["effect"].clone()
}
fn valid(s: &Value) -> bool {
    let issues: Vec<Value> = serde_json::from_str(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":s["durationFrames"].as_u64().unwrap()*step(s),"trimStart":0,"trackKind":"graphic",
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap();
    issues.is_empty()
}
fn near(value: &Value, expected: f64) {
    assert!(
        (value.as_f64().unwrap() - expected).abs() < 1e-12,
        "{value} != {expected}"
    );
}

#[test]
fn amount_curve_replaces_static_value_and_holds_both_endpoints() {
    let s = source();
    assert!(valid(&s));
    for (frame, expected) in [(0, 0.2), (5, 0.2), (10, 0.5), (15, 0.8), (23, 0.8)] {
        near(&effect(&s, frame)["amount"], expected);
    }
    let reloaded: Value = serde_json::from_str(&s.to_string()).unwrap();
    for frame in [23, 5, 10, 0, 15, 10] {
        assert_eq!(resolve(&s, frame, None), resolve(&reloaded, frame, None));
    }
    let mut plain = s;
    plain["recipe"]["post"][0]
        .as_object_mut()
        .unwrap()
        .remove("automation");
    near(&effect(&plain, 0)["amount"], 0.9);
    let omitted = resolve(&plain, 0, None);
    plain["recipe"]["post"][0]["automation"] = json!([]);
    assert_eq!(omitted, resolve(&plain, 0, None));
}

#[test]
fn easing_belongs_to_the_departing_key_and_source_duration_is_a_valid_end_knot() {
    let mut s = source();
    s["recipe"]["post"][0]["automation"][0]["keyframes"] = json!([
        {"frame":0,"value":0,"easing":"inQuad"},
        {"frame":16,"value":1,"easing":"outQuad"},
        {"frame":24,"value":0,"easing":"linear"}]);
    assert!(valid(&s));
    near(&effect(&s, 8)["amount"], 0.25);
    near(&effect(&s, 20)["amount"], 0.25);
    near(&effect(&s, 23)["amount"], 0.015625);
    s["recipe"]["post"][0]["automation"][0]["keyframes"] = json!([
        {"frame":24,"value":0.7,"easing":"linear"}]);
    assert!(valid(&s));
    near(&effect(&s, 0)["amount"], 0.7);
}

#[test]
fn fractional_fps_clip_trim_and_child_remap_use_outer_source_frames() {
    let mut s = source();
    s["frameRate"] = json!({"numerator":30000,"denominator":1001});
    s["recipe"]["songStartSeconds"] = json!(123.5);
    s["recipe"]["root"] = json!("held");
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"held",
        "scene":{"kind":"ref","input":"solid","timeMap":[{"atFrame":0,"sourceFrame":1}]}}));
    let regular = resolve(&s, 10, None);
    assert_eq!(regular["frame"]["recipePlan"]["root"]["sampledFrame"], 1);
    near(
        &regular["frame"]["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"],
        0.5,
    );
    let trimmed: Value = serde_json::from_str(&resolve_programmatic_frame_json(json!({
        "source":s,"clipStart":120000,"clipDuration":16*4004,"trimStart":8*4004,"timelineTime":120000+2*4004
    }).to_string())).unwrap();
    assert_eq!(
        regular["frame"]["recipePlan"],
        trimmed["frame"]["recipePlan"]
    );
}

#[test]
fn rejects_ambiguous_targets_invalid_keys_and_unbounded_curves_on_save_and_render() {
    let s = source();
    let lane = s["recipe"]["post"][0]["automation"][0].clone();
    let key = |f: Value, v: Value| json!({"frame":f,"value":v,"easing":"linear"});
    let invalid = [
        json!(null),
        json!([lane.clone(), lane.clone()]),
        json!([{"effect":1,"keyframes":[key(json!(0),json!(0.5))]}]),
        json!([{"effect":0,"keyframes":[]}]),
        json!([{"effect":0,"keyframes":[key(json!(3),json!(0)),key(json!(3),json!(1))]}]),
        json!([{"effect":0,"keyframes":[key(json!(5),json!(0)),key(json!(4),json!(1))]}]),
        json!([{"effect":0,"keyframes":[key(json!(-1),json!(0))]}]),
        json!([{"effect":0,"keyframes":[key(json!(1.5),json!(0))]}]),
        json!([{"effect":0,"keyframes":[key(json!(25),json!(0))]}]),
        json!([{"effect":0,"keyframes":[key(json!(0),json!(-0.01))]}]),
        json!([{"effect":0,"keyframes":[key(json!(0),json!(1.01))]}]),
        json!([{"effect":0,"keyframes":[{"frame":0,"value":0}]}]),
        json!([{"effect":0,"keyframes":[{"frame":0,"value":0,"easing":"unknown"}]}]),
        json!([{"effect":0,"extra":1,"keyframes":[key(json!(0),json!(0))]}]),
    ];
    for automation in invalid {
        let mut changed = s.clone();
        changed["recipe"]["post"][0]["automation"] = automation.clone();
        assert!(!valid(&changed), "accepted {automation}");
        assert!(resolve(&changed, 0, None)["error"].is_string());
    }
    let mut large = s.clone();
    large["durationFrames"] = json!(300);
    let keys = (0..256)
        .map(|f| key(json!(f), json!(0.5)))
        .collect::<Vec<_>>();
    large["recipe"]["post"][0]["automation"][0]["keyframes"] = json!(keys);
    assert!(valid(&large));
    large["recipe"]["post"][0]["automation"][0]["keyframes"]
        .as_array_mut()
        .unwrap()
        .push(key(json!(256), json!(0.5)));
    assert!(!valid(&large));
    let mut grade = s;
    grade["recipe"]["post"][0]["effects"][0] = json!({"kind":"grade","exposure":0,"contrast":1,
        "saturation":1,"lift":[0,0,0],"gain":[1,1,1]});
    assert!(!valid(&grade));
}

fn analysis() -> Value {
    let file = |c: char| json!({"sha256":c.to_string().repeat(64),"byteLength":100});
    serde_json::from_str::<Value>(&prepare_mv_audio_json(json!({
        "manifest":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","command":"analyze",
            "status":"complete","review":"required","inputs":{"audio":{"sha256":"a".repeat(64),"bytes":100}},
            "outputs":{"music.json":{"sha256":"b".repeat(64),"bytes":100},"envelopes.json":{"sha256":"c".repeat(64),"bytes":100}}},
        "music":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","audio":{"duration":2},"review":"required","beats":[0,1],"downbeats":[0]},
        "envelopes":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","duration":2,"fps":1,"frame_count":2,
            "channels":{"mix_rms":[0.5,0.5],"low_power":[1,1],"mid_power":[1,1],"high_power":[1,1]},
            "normalization":{"method":"per-channel p95 (max if p95 is zero), clipped to [0,1]","scales":{"mix_rms":1,"low_power":1,"mid_power":1,"high_power":1}}},
        "manifestFile":file('d'),"musicFile":file('b'),"envelopesFile":file('c'),
        "expectedAudioSha256":"a".repeat(64),"review":{"status":"accepted","reference":"test constant measured half-level"}
    }).to_string())).unwrap()["data"].clone()
}

#[test]
fn curve_then_audio_delta_then_clamp_precedes_finishing_lowering() {
    let mut s = source();
    s["resources"] = json!([{"id":"song.json","kind":"analysis","mimeType":"application/json",
        "byteLength":1,"sha256":"e".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","e".repeat(64))}]);
    s["recipe"]["audio"] = json!({"resource":"song.json","inputSha256":"a".repeat(64)});
    s["recipe"]["post"][0]["effects"] = json!([{"kind":"fade","amount":0.9}]);
    s["recipe"]["post"][0]["audio"] = json!([{"effect":0,"amount":0.3,
        "signal":{"kind":"envelope","channel":"mix_rms","clock":"song","missing":"error"}}]);
    assert!(valid(&s));
    let data = analysis();
    assert!(data.is_object());
    let lowered = resolve(&s, 0, Some(data.clone()))["frame"]["recipePlan"]["post"][0]["effects"]
        [0]["effect"]
        .clone();
    assert_eq!(lowered["kind"], "grade");
    near(&lowered["gain"][0], 0.65); // curve .2 + measured .5 * response .3 = .35 fade
    for (response, frame, expected) in [(1.0, 23, 0.0), (-1.0, 0, 1.0)] {
        s["recipe"]["post"][0]["audio"][0]["amount"] = json!(response);
        let lowered =
            resolve(&s, frame, Some(data.clone()))["frame"]["recipePlan"]["post"][0]["effects"][0]
                ["effect"]
                .clone();
        near(&lowered["gain"][0], expected);
    }
}
