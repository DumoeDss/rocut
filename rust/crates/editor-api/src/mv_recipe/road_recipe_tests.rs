use super::*;
use serde_json::json;
fn analysis() -> Data {
    serde_json::from_value(json!({"schema":"rocut-mv-audio/1","duration":30,"fps":1,
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"Road synthetic clock fixture"}},
        "beats":(0..60).map(|n|n*60000).collect::<Vec<_>>(),"downbeats":(0..15).map(|n|n*240000).collect::<Vec<_>>(),"stops":[{"kind":"stop","start":15,"end":16}],
        "channels":{"mix_rms":vec![0;30],"low_power":vec![0;30],"mid_power":vec![0;30],"high_power":vec![0;30]},
        "scales":{"mix_rms":0,"low_power":0,"mid_power":0,"high_power":0}})).unwrap()
}
fn resources() -> Vec<Resource> {
    serde_json::from_value(
        json!([{"id":"audio","kind":"analysis","mimeType":"application/json","byteLength":1,
        "sha256":"b".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","b".repeat(64))}]),
    )
    .unwrap()
}
fn recipe() -> serde_json::Value {
    json!({"version":1,"root":"road","songStartSeconds":0,"outputRoles":["background","foreground"],
        "audio":{"resource":"audio","inputSha256":"a".repeat(64)},
        "nodes":[{"id":"road","scene":{"kind":"road","role":"background","span":{"startFrame":0,"durationFrames":600},"settings":{"bpm":120}}}]})
}
fn resolve(recipe: serde_json::Value, index: u64) -> serde_json::Value {
    let recipe: super::super::Recipe = serde_json::from_value(recipe).unwrap();
    let resources = resources();
    assert!(
        recipe
            .validate(&resources, 600, 1920, 1080, 4000)
            .is_empty()
    );
    serde_json::to_value(
        recipe
            .resolve(
                index,
                4000,
                17,
                1920,
                1080,
                Some(&analysis()),
                &resources,
                index * 4000,
                None,
            )
            .unwrap(),
    )
    .unwrap()
}
#[test]
fn bpm_is_explicit_default_tear_and_dimensions_are_closed() {
    assert!(serde_json::from_value::<Road>(json!({})).is_err());
    let a: Road = serde_json::from_value(json!({"bpm":120})).unwrap();
    assert!(a.mode == road::model::Mode::Tear);
    let span = Span {
        start_frame: 0,
        duration_frames: 60,
    };
    assert!(a.valid(0, &span, 2000));
    assert!(a.resources_valid(&[]));
    for bpm in [0.0, 1001.0] {
        let a: Road = serde_json::from_value(json!({"bpm":bpm})).unwrap();
        assert!(!a.valid(0, &span, 2000));
    }
    let sample = Sample {
        song_ticks: 0,
        shot_start_ticks: 0,
        shot_end_ticks: 120000,
        analysis: None,
    };
    assert!(a.produce(&sample, 1280, 720, None, &[]).is_err());
    assert!(a.produce(&sample, 1920, 1080, None, &[]).is_err());
    assert!(serde_json::from_value::<Road>(json!({"bpm":120,"width":1920})).is_err());
    let run: Road = serde_json::from_value(json!({"bpm":120,"mode":"run"})).unwrap();
    assert!(!run.resources_valid(&[]));
}
#[test]
fn public_road_emits_required_original_post_and_reference_clock_replays() {
    let direct = resolve(recipe(), 60);
    assert_eq!(direct["root"]["kind"], "road");
    let post = &direct["root"]["nativePost"];
    assert_eq!(post["required"], true);
    assert_eq!(post["bloom"], 0.55);
    assert_eq!(post["dawn"]["stops"][1], json!([0.3, "#3a2d63"]));
    assert_eq!(post["beats"].as_array().unwrap().len(), 60);
    assert_eq!(post["songTicks"], 240000);
    let mut mapped = recipe();
    mapped["root"] = json!("reverse");
    mapped["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{"kind":"ref","input":"road","timeMap":[{"atFrame":0,"sourceFrame":90},{"atFrame":30,"sourceFrame":0}]}}));
    assert_eq!(resolve(mapped, 10)["root"]["input"], direct["root"]);
}
#[test]
fn expanded_road_graph_and_unreviewed_or_missing_stop_evidence_fail_closed() {
    let mut graph = recipe();
    graph["root"] = json!("pair");
    graph["nodes"].as_array_mut().unwrap().push(json!({"id":"pair","scene":{"kind":"transition","from":"road","to":"road","span":{"startFrame":0,"durationFrames":600},"easing":"linear","style":{"kind":"xfade"}}}));
    let graph: super::super::Recipe = serde_json::from_value(graph).unwrap();
    assert!(
        !graph
            .validate(&resources(), 600, 1920, 1080, 4000)
            .is_empty()
    );
    let a: Road = serde_json::from_value(json!({"bpm":120})).unwrap();
    let mut data = analysis();
    data.stops = None;
    let sample = Sample {
        song_ticks: 240000,
        shot_start_ticks: 0,
        shot_end_ticks: 2400000,
        analysis: Some(&data),
    };
    assert!(a.runtime_ready(&sample, None, &resources()).is_err());
    data.stops = Some(vec![]);
    data.provenance.review.status = "unreviewed".into();
    let sample = Sample {
        analysis: Some(&data),
        song_ticks: 240000,
        shot_start_ticks: 0,
        shot_end_ticks: 2400000,
    };
    assert!(a.runtime_ready(&sample, None, &resources()).is_err());
}
#[test]
fn public_run_discovers_and_binds_exact_native_image_facts_before_plan() {
    let character = json!({"id":"character","kind":"image","mimeType":"image/png","byteLength":1,
        "sha256":"c".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","c".repeat(64))});
    let mut graph = recipe();
    graph["nodes"][0]["scene"]["settings"] = json!({"bpm":120,"mode":"run","char":"character"});
    let mut sources = serde_json::to_value(resources()).unwrap();
    sources.as_array_mut().unwrap().push(character.clone());
    let mut request = json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":600,"seed":17,"resources":sources,"recipe":graph},
        "clipStart":0,"clipDuration":2400000,"trimStart":0,"timelineTime":240000,"analysis":analysis()});
    let resolve = |request: &serde_json::Value| -> serde_json::Value {
        serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
            request.to_string(),
        ))
        .unwrap()
    };
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert_eq!(
        pending["frame"]["imageDimensionRequests"][0]["resource"],
        character
    );
    request["imageDimensions"] = json!([{"resource":character,"width":64,"height":64}]);
    let ready = resolve(&request);
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(
        ready["frame"]["recipePlan"]["root"]["nativePost"]["beatCA"],
        2
    );
    let mut mismatch = request.clone();
    mismatch["imageDimensions"][0]["resource"]["sha256"] = json!("d".repeat(64));
    assert!(resolve(&mismatch).get("error").is_some());
    request["source"]["recipe"]["nodes"][0]["scene"]["settings"]["width"] = json!(64);
    assert!(resolve(&request).get("error").is_some());
}
