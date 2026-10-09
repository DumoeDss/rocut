use editor_api::{
    prepare_mv_audio_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};
fn input() -> Value {
    let fp = |c: char| json!({"sha256":c.to_string().repeat(64),"bytes":100});
    json!({"manifest":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","command":"analyze","status":"complete","review":"required",
        "inputs":{"audio":fp('a')},"outputs":{"music.json":fp('b'),"envelopes.json":fp('c')}},
        "music":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","audio":{"duration":2},"review":"required","beats":[0,0.5,1.25],"downbeats":[0,1.25]},
        "envelopes":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds","duration":2,"fps":4,"frame_count":8,
            "channels":{"mix_rms":[0,1,0,1,0,1,0,1],"low_power":[0,0,0,0,1,1,1,1],"mid_power":vec![0.5;8],"high_power":vec![1;8]},
            "normalization":{"method":"per-channel p95 (max if p95 is zero), clipped to [0,1]","scales":{"mix_rms":0.2,"low_power":5,"mid_power":2,"high_power":1}}},
        "manifestFile":{"sha256":"d".repeat(64),"byteLength":100},"musicFile":{"sha256":"b".repeat(64),"byteLength":100},"envelopesFile":{"sha256":"c".repeat(64),"byteLength":100},
        "expectedAudioSha256":"a".repeat(64),"review":{"status":"accepted","reference":"synthetic fixture ground truth"}})
}
fn prepare(v: &Value) -> Value {
    serde_json::from_str(&prepare_mv_audio_json(v.to_string())).unwrap()
}
fn data() -> Value {
    prepare(&input())["data"].clone()
}
fn signal(channel: &str, clock: &str, missing: &str) -> Value {
    json!({"kind":"envelope","channel":channel,"clock":clock,"missing":missing})
}
fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":64,"height":64,"frameRate":{"numerator":24,"denominator":1},"durationFrames":48,"seed":7,
        "resources":[{"id":"song.json","kind":"analysis","mimeType":"application/json","byteLength":1,"sha256":"e".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","e".repeat(64))}],
        "recipe":{"version":1,"root":"a","songStartSeconds":0,"outputRoles":["foreground"],"audio":{"resource":"song.json","inputSha256":"a".repeat(64)},
            "nodes":[{"id":"a","scene":{"kind":"solid","role":"foreground","color":[1,1,1,1]}}],
            "post":[{"roles":["foreground"],"effects":[{"kind":"vignette","amount":0}],"audio":[{"effect":0,"signal":signal("mix_rms","song","error"),"amount":1}]}]}})
}
fn resolve(s: &Value, d: Option<Value>, frame: u64) -> Value {
    let mut request = json!({"source":s,"clipStart":0,"clipDuration":240000,"trimStart":0,"timelineTime":frame*5000});
    if let Some(d) = d {
        request["analysis"] = d;
    }
    serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap()
}
fn amount(s: &Value, frame: u64) -> f64 {
    resolve(s,Some(data()),frame)["frame"]["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"].as_f64().unwrap()
}
fn valid(s: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({"editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
    "duration":240000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,"catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}}).to_string())).unwrap().is_empty()
}
#[test]
fn imports_completed_reviewed_creator_artifacts_without_paths_or_new_analysis() {
    let d = data();
    assert_eq!(d["beats"], json!([0, 60000, 150000]));
    assert_eq!(
        d["channels"]["mix_rms"],
        json!([0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0])
    );
    assert_eq!(d["scales"]["low_power"], 5.0);
    assert_eq!(d["provenance"]["inputSha256"], "a".repeat(64));
    assert_eq!(
        d["provenance"]["review"]["reference"],
        "synthetic fixture ground truth"
    );
    assert!(d.get("path").is_none());
}
#[test]
fn reject_incomplete_unreviewed_mismatched_or_malformed_audio_evidence() {
    for (pointer, value) in [
        ("/manifest/status", json!("incomplete")),
        ("/review/status", json!("required")),
        ("/review/reference", json!("")),
        ("/expectedAudioSha256", json!("f".repeat(64))),
        ("/musicFile/sha256", json!("f".repeat(64))),
        ("/envelopesFile/byteLength", json!(99)),
        ("/music/audio/duration", json!(1)),
        ("/envelopes/frame_count", json!(7)),
        ("/music/beats", json!([0, 0.000001, 1])),
        ("/music/downbeats", json!([0.1])),
        ("/envelopes/channels/mix_rms", json!([0, 1])),
        ("/envelopes/channels/high_power/0", json!(1.1)),
    ] {
        let mut v = input();
        *v.pointer_mut(pointer).unwrap() = value;
        assert!(prepare(&v)["error"].is_string(), "accepted {pointer}");
    }
    let mut v = input();
    v["envelopes"]["channels"]["vocal_rms"] = json!(vec![0; 8]);
    v["envelopes"]["normalization"]["scales"]["vocal_rms"] = json!(0.1);
    assert!(prepare(&v)["error"].is_string());
}
#[test]
fn analysis_binding_and_responses_validate_before_persistence_and_never_render_unresolved() {
    let s = source();
    assert!(valid(&s));
    assert!(resolve(&s, None, 0)["error"].is_string());
    let mut wrong = data();
    wrong["provenance"]["inputSha256"] = json!("b".repeat(64));
    assert!(resolve(&s, Some(wrong), 0)["error"].is_string());
    for (pointer, value) in [
        ("/recipe/audio/resource", json!("missing.json")),
        ("/recipe/audio/inputSha256", json!("bad")),
        ("/recipe/post/0/audio/0/effect", json!(5)),
        ("/recipe/post/0/audio/0/amount", json!(2)),
        (
            "/recipe/post/0/audio/0/signal/channel",
            json!("guessed_vocals"),
        ),
    ] {
        let mut v = s.clone();
        *v.pointer_mut(pointer).unwrap() = value;
        assert!(!valid(&v), "accepted {pointer}");
    }
    let mut v = s;
    v["recipe"].as_object_mut().unwrap().remove("audio");
    assert!(!valid(&v));
}
#[test]
fn interpolates_measured_envelopes_and_real_nonuniform_beat_intervals_without_extrapolation() {
    let mut s = source();
    for (f, expected) in [(0, 0.0), (3, 0.5), (6, 1.0), (9, 0.5), (12, 0.0), (45, 1.0)] {
        assert!((amount(&s, f) - expected).abs() < 1e-9);
    }
    s["recipe"]["post"][0]["audio"][0]["signal"] =
        json!({"kind":"beatPulse","decay":std::f64::consts::LN_2,"clock":"song","missing":"zero"});
    for (f, expected) in [
        (0, 1.0),
        (6, 2.0f64.powf(-0.5)),
        (12, 1.0),
        (24, 2.0f64.powf(-2.0 / 3.0)),
        (30, 0.0),
        (42, 0.0),
    ] {
        assert!((amount(&s, f) - expected).abs() < 1e-9);
    }
    s["recipe"]["post"][0]["audio"][0]["signal"]["missing"] = json!("error");
    assert!(resolve(&s, Some(data()), 30)["error"].is_string());
    s["recipe"]["post"][0]["audio"][0]["signal"] = signal("vocal_rms", "song", "error");
    assert!(resolve(&s, Some(data()), 0)["error"].is_string());
    s["recipe"]["post"][0]["audio"][0]["signal"]["missing"] = json!("zero");
    assert_eq!(amount(&s, 0), 0.0);
}
#[test]
fn source_and_song_clocks_are_explicit_and_entrance_zero_cannot_be_resurrected() {
    let mut s = source();
    let mut image = s["resources"][0].clone();
    image["id"] = json!("image.png");
    image["kind"] = json!("image");
    image["mimeType"] = json!("image/png");
    s["resources"].as_array_mut().unwrap().push(image);
    let pose = json!({"x":0.5,"y":0.5,"height":0.5,"rotation":0,"opacity":1});
    s["recipe"]["nodes"] = json!([{"id":"a","scene":{"kind":"illust","motion":{"startFrame":0,"durationFrames":48},"easing":"linear","sprites":[{"image":"image.png","role":"foreground","from":pose,"to":pose,"anchor":[0.5,0.5],
        "audio":[{"target":"x","signal":signal("mix_rms","source","error"),"amount":0.25}]}]}},
        {"id":"held","scene":{"kind":"ref","input":"a","timeMap":[{"atFrame":0,"sourceFrame":0}]}}]);
    s["recipe"]["root"] = json!("held");
    assert!(valid(&s));
    let r = resolve(&s, Some(data()), 6);
    assert_eq!(
        r["frame"]["recipePlan"]["root"]["input"]["sprites"][0]["pose"]["x"],
        0.5
    );
    assert_eq!(
        r["frame"]["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"],
        1.0
    );
    s["recipe"]["nodes"][0]["scene"]["sprites"][0]["audio"][0]["signal"]["clock"] = json!("song");
    assert_eq!(
        resolve(&s, Some(data()), 6)["frame"]["recipePlan"]["root"]["input"]["sprites"][0]["pose"]
            ["x"],
        0.75
    );
    let sprite = &mut s["recipe"]["nodes"][0]["scene"]["sprites"][0];
    sprite["audio"][0]["target"] = json!("opacity");
    sprite["from"]["opacity"] = json!(0);
    sprite["to"]["opacity"] = json!(0);
    sprite["enter"] = json!({"span":{"startFrame":0,"durationFrames":4},"easing":"linear","offset":[0,0],"scale":1,"rotation":0,"opacity":0});
    assert_eq!(
        resolve(&s, Some(data()), 6)["frame"]["recipePlan"]["root"]["input"]["sprites"][0]["pose"]
            ["opacity"],
        0.0
    );
}

#[test]
fn camera_responses_clamp_and_duplicate_targets_fail_before_persistence() {
    let mut s = source();
    let mut image = s["resources"][0].clone();
    image["id"] = json!("image.png");
    image["kind"] = json!("image");
    image["mimeType"] = json!("image/png");
    s["resources"].as_array_mut().unwrap().push(image);
    let camera = json!({"x":0.9,"y":-0.9,"zoom":7});
    s["recipe"]["nodes"][0]["scene"] = json!({"kind":"illust","motion":{"startFrame":0,"durationFrames":48},"easing":"linear",
        "background":{"image":"image.png","from":camera,"to":camera,"audio":[
            {"target":"x","signal":signal("mix_rms","song","error"),"amount":1},
            {"target":"y","signal":signal("mix_rms","song","error"),"amount":-1},
            {"target":"zoom","signal":signal("mix_rms","song","error"),"amount":1}]}});
    assert!(valid(&s));
    assert_eq!(
        resolve(&s, Some(data()), 6)["frame"]["recipePlan"]["root"]["background"]["camera"],
        json!({"x":1.0,"y":-1.0,"zoom":8.0})
    );
    s["recipe"]["nodes"][0]["scene"]["background"]["audio"][1]["target"] = json!("x");
    assert!(!valid(&s));
    s["recipe"]["nodes"][0]["scene"]["background"]["audio"][1]["target"] = json!("y");
    let response = s["recipe"]["post"][0]["audio"][0].clone();
    s["recipe"]["post"][0]["audio"]
        .as_array_mut()
        .unwrap()
        .push(response);
    assert!(!valid(&s));
}

#[test]
fn fractional_fps_uses_integer_ticks_and_inactive_shots_do_not_request_missing_signals() {
    let mut s = source();
    s["frameRate"] = json!({"numerator":30000,"denominator":1001});
    s["durationFrames"] = json!(60);
    let request = json!({"source":s,"clipStart":0,"clipDuration":240000,"trimStart":0,"timelineTime":28028,"analysis":data()});
    let resolved: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
    // 7 * 1001/30000 seconds is on the first 0 -> 1 envelope ramp.
    let sampled = resolved["frame"]["recipePlan"]["post"][0]["effects"][0]["effect"]["amount"]
        .as_f64()
        .unwrap();
    assert!((sampled - 0.9342666666666667).abs() < 1e-12);

    s = source();
    s["recipe"]["post"] = json!([]);
    let mut image = s["resources"][0].clone();
    image["id"] = json!("image.png");
    image["kind"] = json!("image");
    image["mimeType"] = json!("image/png");
    s["resources"].as_array_mut().unwrap().push(image);
    let camera = json!({"x":0,"y":0,"zoom":1});
    s["recipe"]["nodes"].as_array_mut().unwrap().extend([
        json!({"id":"missing","scene":{"kind":"illust","motion":{"startFrame":0,"durationFrames":48},"easing":"linear",
            "background":{"image":"image.png","from":camera,"to":camera,"audio":[{"target":"zoom","signal":signal("vocal_rms","song","error"),"amount":1}]}}}),
        json!({"id":"seq","scene":{"kind":"sequence","items":[
            {"input":"a","span":{"startFrame":0,"durationFrames":24},"timeMap":[{"atFrame":0,"sourceFrame":0}]},
            {"input":"missing","span":{"startFrame":24,"durationFrames":24},"timeMap":[{"atFrame":0,"sourceFrame":0}]}]}}),
    ]);
    s["recipe"]["root"] = json!("seq");
    assert!(valid(&s));
    assert!(resolve(&s, Some(data()), 0)["error"].is_null());
    assert!(
        resolve(&s, Some(data()), 24)["error"]
            .as_str()
            .unwrap()
            .contains("signal unavailable")
    );
}
