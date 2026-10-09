use editor_api::{mv_recipe_catalog_json, prepare_mv_audio_json, resolve_programmatic_frame_json};
use serde_json::{Value, json};

// Same reviewed Creator artifacts used by mv_audio.rs, imported by the real API.
fn analysis() -> Value {
    let fp = |c: char| json!({"sha256":c.to_string().repeat(64),"bytes":100});
    let input = json!({
        "manifest":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
            "command":"analyze","status":"complete","review":"required",
            "inputs":{"audio":fp('a')},"outputs":{"music.json":fp('b'),"envelopes.json":fp('c')}},
        "music":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
            "audio":{"duration":2},"review":"required","beats":[0,0.5,1.25],"downbeats":[0,1.25]},
        "envelopes":{"schema":"creator-mv-audio/1","time_coordinate":"source-audio-seconds",
            "duration":2,"fps":4,"frame_count":8,
            "channels":{"mix_rms":[0,1,0,1,0,1,0,1],"low_power":[0,0,0,0,1,1,1,1],
                "mid_power":vec![0.5;8],"high_power":vec![1;8]},
            "normalization":{"method":"per-channel p95 (max if p95 is zero), clipped to [0,1]",
                "scales":{"mix_rms":0.2,"low_power":5,"mid_power":2,"high_power":1}}},
        "manifestFile":{"sha256":"d".repeat(64),"byteLength":100},
        "musicFile":{"sha256":"b".repeat(64),"byteLength":100},
        "envelopesFile":{"sha256":"c".repeat(64),"byteLength":100},
        "expectedAudioSha256":"a".repeat(64),
        "review":{"status":"accepted","reference":"synthetic fixture ground truth"}});
    let result: Value = serde_json::from_str(&prepare_mv_audio_json(input.to_string())).unwrap();
    assert!(result["data"].is_object(), "{result}");
    assert_eq!(result["data"]["beats"], json!([0, 60000, 150000]));
    result["data"].clone()
}

fn resource(id: &str, kind: &str, hash: u64) -> Value {
    let sha = format!("{hash:064x}");
    json!({"id":id,"kind":kind,"sha256":sha,"byteLength":1,
        "attachmentKey":format!("{}{}",if kind=="source" {"programmatic-source-sha256-"} else {"programmatic-sha256-"},sha),
        "mimeType":match kind {"source"=>"application/octet-stream","font"=>"font/woff2",
            "analysis"=>"application/json","imageSequence"=>"application/vnd.rocut.image-sequence+json",_=>"image/png"}})
}

fn suggestion(field: &Value) -> Value {
    match field["type"].as_str() {
        Some("resource") => json!("fixture-font"),
        Some("tuple") => field["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(suggestion)
            .collect(),
        _ => field["suggested"].clone(),
    }
}

pub fn request(mode: &str) -> Value {
    let mut font = resource("fixture-font", "font", 90002);
    font["font"] = json!({"family":"Fixture","style":"normal","weight":400});
    let mut settings = if mode == "quiet" {
        json!({"mode":"quiet","font":"fixture-font","glyphs":[{"text":"A","opticalScale":1}],
            "fontSize":0.1,"center":[0.5,0.5],"orientation":"horizontal","gap":0.36,
            "lead":0.1,"stagger":0.12,"fade":0.6,"color":[1,1,1,1],"background":[0,0,0,1],
            "rule":null,"subtitle":null,"grain":0})
    } else {
        let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
        catalog["generators"]["typeCard"]["variants"][mode]["parameters"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), suggestion(v)))
            .collect()
    };
    settings["grain"] = json!(0);
    if mode == "flicker" {
        settings["beats"] = json!({"kind":"analysis"});
        for (i, text) in ["ONE", "TWO", "THREE", "FOUR"].into_iter().enumerate() {
            settings["layouts"][i]["parts"][0]["text"] = json!(text);
        }
    }
    let mut request = json!({"source":{"version":1,"runtime":"canvas-worker","code":"",
        "width":160,"height":96,"frameRate":{"numerator":30000,"denominator":1001},
        "durationFrames":300,"seed":3,"resources":[font,resource("song.json","analysis",90003)],
        "recipe":{"version":1,"root":"card","songStartSeconds":0,"outputRoles":["foreground","background"],
            "audio":{"resource":"song.json","inputSha256":"a".repeat(64)},"post":[],
            "nodes":[{"id":"card","scene":{"kind":"typeCard","role":"foreground","settings":settings,
                "span":{"startFrame":0,"durationFrames":300}}}]}},
        "clipStart":0,"clipDuration":1201200,"trimStart":0,"timelineTime":28028,"analysis":analysis()});
    if mode == "quiet" {
        // Controlled platform input, not a claim about browser-measured font facts.
        request["fontMetrics"] = json!([{"resource":request["source"]["resources"][0],
            "glyphs":[{"text":"A","left":20,"right":30,"ascent":40,"descent":10}]}]);
    }
    request
}

pub fn combined() -> Value {
    let mut r = request("quiet");
    r["source"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(resource("shot-a/sequence.json", "imageSequence", 90000));
    // Same Blender provenance/manifest construction as image_sequence_frame.rs.
    r["sequenceManifests"] = json!([{"resourceId":"shot-a/sequence.json","manifest":{
        "version":1,"shotId":"shot-a","renderId":"render-a","frameRate":{"numerator":24000,"denominator":1001},
        "width":1920,"height":1080,"firstFileFrame":1001,"alpha":"straight","colorSpace":"srgb",
        "frames":(0..222).map(|i|resource(&format!("frames/{i}.png"),"image",i+1)).collect::<Vec<_>>(),
        "provenance":{"engine":"blender","version":"5.0.0","entryFile":"scene.blend","parameters":{},
            "originalManifest":resource("original/render.json","source",80000),
            "sourceFiles":[{"path":"scene.blend","byteLength":1,"sha256":format!("{:064x}",80001),
                "parts":[resource("source/scene.blend","source",80001)]}]}}}]);
    r["source"]["recipe"]["root"] = json!("mix");
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().extend([
        json!({"id":"sequence","scene":{"kind":"imageSequence","sequence":"shot-a/sequence.json",
            "originSourceTicks":0,"rate":{"numerator":1,"denominator":1},"role":"background","view":{"x":0,"y":0,"zoom":1}}}),
        json!({"id":"mix","scene":{"kind":"transition","from":"card","to":"sequence",
            "span":{"startFrame":0,"durationFrames":300},"easing":"linear","style":{"kind":"xfade"}}}),
    ]);
    r["source"]["recipe"]["post"] = json!([{"roles":["foreground"],
        "effects":[{"kind":"vignette","amount":0}],"audio":[{"effect":0,"amount":1,
            "signal":{"kind":"envelope","channel":"mix_rms","clock":"song","missing":"error"}}]}]);
    r
}

pub fn resolve(r: &Value) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap()
}
pub fn frame(r: &Value) -> Value {
    let result = resolve(r);
    assert!(result.get("error").is_none(), "{result}");
    assert!(result["frame"]["recipePlan"].is_object(), "{result}");
    result["frame"].clone()
}
pub fn reject(r: &Value) -> String {
    let result = resolve(r);
    assert!(
        result.get("frame").is_none(),
        "partial frame escaped: {result}"
    );
    result["error"]
        .as_str()
        .expect("explicit frame error")
        .to_owned()
}
