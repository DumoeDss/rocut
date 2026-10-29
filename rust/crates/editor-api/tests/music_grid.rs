use editor_api::{
    plan_music_grid_edit_json, query_music_grid_json, validate_music_grid_state_json,
};
use serde_json::{json, Value};
fn document() -> Value {
    json!({"revision":0,"project":{"id":"project","frameRate":{"numerator":30,"denominator":1},"sceneState":{"scenes":[{"id":"scene"}]}},
        "tracks":[{"id":"audio","sceneId":"scene","kind":"audio"}],
        "clips":[{"id":"song","trackId":"audio","assetId":"source","startTime":600000,"duration":1200000,"trimStart":240000,"trimEnd":0}],
        "assets":[{"id":"source","kind":"audio","sourceSha256":"a".repeat(64),"duration":2400000}]})
}
fn edit(doc: &Value, operation: Value) -> Value {
    serde_json::from_str(&plan_music_grid_edit_json(json!({"document":doc,"request":{"expectedNativeRevision":doc["revision"],"idempotencyKey":"operation-1","operation":operation}}).to_string())).unwrap()
}
fn create(doc: &mut Value, points: Value) -> Value {
    let response = edit(
        doc,
        json!({"kind":"create-manual","clipId":"song","points":points,"reviewReference":"review-fixture"}),
    );
    assert_eq!(response["status"], "admitted", "{response}");
    doc["project"]["musicGridState"] =
        response["batch"]["operations"][0]["patch"]["musicGridState"].clone();
    doc["revision"] = json!(doc["revision"].as_u64().unwrap() + 1);
    response["created"].clone()
}
fn query(doc: &Value, binding: &Value, request: Value) -> Value {
    let mut req = request.as_object().unwrap().clone();
    req.insert("bindingId".into(), binding["bindingId"].clone());
    serde_json::from_str(&query_music_grid_json(
        json!({"document":doc,"request":req}).to_string(),
    ))
    .unwrap()
}
fn bpm_segment(id: &str, start: i64, end: i64, meter_n: i64, phase_n: i64, phase_d: i64) -> Value {
    json!({"id":id,"sourceStartTick":start,"sourceEndTick":end,"meter":{"numerator":meter_n,"denominator":8},"beatUnit":{"numerator":1,"denominator":8},"phaseQuarterNotes":{"numerator":phase_n,"denominator":phase_d},"barNumber":0,"confidence":0.9,"quarterNoteBpm":{"numerator":120,"denominator":1},"interpolation":"step"})
}
#[test]
fn independent_anchor_boundaries_are_closed_and_reverse_without_sample_offset() {
    let mut doc = document();
    doc["clips"][0]["trimStart"] = json!(0);
    doc["clips"][0]["duration"] = json!(2400000);
    let binding = create(&mut doc, json!([{"id":"beat","sourceTick":0}]));
    let request = json!({"kind":"project-anchors","anchorSource":{
        "sourceSha256":"a".repeat(64),"resourceSha256":"b".repeat(64),
        "resourceRevision":1,"reviewReference":"boundary-review",
        "anchors":[{"key":"start","sourceTick":0},{"key":"end","sourceTick":2400000},
        {"key":"trim-start","sourceTick":240000},{"key":"trim-end","sourceTick":1440000}]}});
    let forward = query(&doc, &binding, request.clone());
    assert_eq!(forward["results"][1]["tick"], 3000000, "{forward}");
    doc["clips"][0]["retime"] = json!({"rate":1,"reverse":true});
    let reverse = query(&doc, &binding, request.clone());
    assert_eq!(reverse["results"][0]["tick"], 3000000);
    assert_eq!(reverse["results"][1]["tick"], 600000);
    assert_eq!(reverse["results"][1]["sourceMappingDelta"], 0);
    doc["clips"][0]["trimStart"] = json!(240000);
    doc["clips"][0]["duration"] = json!(600000);
    doc["clips"][0]["retime"]["rate"] = json!(2);
    for reverse in [false, true] {
        doc["clips"][0]["retime"]["reverse"] = json!(reverse);
        let trimmed = query(&doc, &binding, request.clone());
        assert_eq!(trimmed["results"][0]["status"], "unavailable");
        assert_eq!(trimmed["results"][1]["status"], "unavailable");
        assert_eq!(
            trimmed["results"][2]["tick"],
            if reverse { 1200000 } else { 600000 }
        );
        assert_eq!(
            trimmed["results"][3]["tick"],
            if reverse { 600000 } else { 1200000 }
        );
    }
    let invalid_beat = edit(
        &doc,
        json!({"kind":"create-manual","clipId":"song",
        "points":[{"id":"end","sourceTick":2400000}],"reviewReference":"review"}),
    );
    assert_ne!(invalid_beat["status"], "admitted");
}
#[test]
fn manual_bpm_preserves_pickup_meter_changes_units_and_exact_generation_provenance() {
    let mut doc = document();
    doc["clips"][0]["trimStart"] = json!(0);
    let segments = json!([
        bpm_segment("pickup-six", 0, 180000, 6, 5, 2),
        bpm_segment("seven", 180000, 600000, 7, 0, 1)
    ]);
    let response = edit(
        &doc,
        json!({"kind":"create-manual-bpm","clipId":"song","segments":segments,"reviewReference":"meter-review"}),
    );
    assert_eq!(response["status"], "admitted", "{response}");
    let state = response["batch"]["operations"][0]["patch"]["musicGridState"].clone();
    assert_eq!(state["grids"][0]["manualBpmProvenance"], segments);
    assert_eq!(state["grids"][0]["points"][0]["downbeat"], false);
    assert_eq!(state["grids"][0]["points"][1]["sourceTick"], 30000);
    assert_eq!(state["grids"][0]["points"][1]["downbeat"], true);
    assert_eq!(state["grids"][0]["points"][13]["sourceTick"], 390000);
    assert_eq!(state["grids"][0]["points"][13]["downbeat"], true); // 7/8 = 3.5 quarter notes
    doc["project"]["musicGridState"] = state.clone();
    doc["revision"] = json!(1);
    let ids = response["created"].clone();
    let read = query(&doc, &ids, json!({"kind":"read"}));
    assert_eq!(read["meterSegments"][1]["meter"]["numerator"], 7);
    let mut invalid = state;
    invalid["grids"][0]["points"][0]["sourceTick"] = json!(1);
    assert_ne!(validate_music_grid_state_json(invalid.to_string()), "[]");
    let old_hash = read["mappingHash"].clone();
    let replacement = edit(
        &doc,
        json!({"kind":"replace-structure","gridId":ids["gridId"],"expectedGridRevision":1,"meterSegments":[],"reviewReference":"meter-unknown-review"}),
    );
    assert_eq!(replacement["status"], "admitted");
    doc["project"]["musicGridState"] =
        replacement["batch"]["operations"][0]["patch"]["musicGridState"].clone();
    doc["revision"] = json!(2);
    let changed = query(&doc, &ids, json!({"kind":"read"}));
    assert_ne!(changed["mappingHash"], old_hash);
    assert_eq!(changed["grid"]["points"], read["grid"]["points"]);
}
#[test]
fn bpm_rejects_curves_invalid_phase_overlap_and_rounds_absolute_rationals() {
    let doc = document();
    let mut segment = bpm_segment("six", 0, 180000, 6, 3, 1);
    let attempt = |segments: Value| {
        edit(
            &doc,
            json!({"kind":"create-manual-bpm","clipId":"song","segments":segments,"reviewReference":"review"}),
        )
    };
    assert_eq!(attempt(json!([segment]))["status"], "unavailable"); // phase equals bar length
    segment["phaseQuarterNotes"] = json!({"numerator":0,"denominator":1});
    segment["interpolation"] = json!("linear");
    assert_eq!(attempt(json!([segment]))["status"], "unavailable");
    segment["interpolation"] = json!("step");
    assert_eq!(
        attempt(json!([segment, bpm_segment("other", 1, 180000, 7, 0, 1)]))["status"],
        "unavailable"
    );
    segment["quarterNoteBpm"] = json!({"numerator":137,"denominator":1});
    let generated = attempt(json!([segment]));
    assert_eq!(generated["status"], "admitted");
    let points =
        &generated["batch"]["operations"][0]["patch"]["musicGridState"]["grids"][0]["points"];
    assert_eq!(points[2]["sourceTick"], 52555); // round(7200000 / 137), not 2*round(3600000/137)
}
#[test]
fn authoritative_clock_and_independent_anchor_projection_preserve_identity_and_order() {
    let mut doc = document();
    doc["project"]["sceneState"]["scenes"][0]["isMain"] = json!(true);
    let ids = create(&mut doc, json!([{"id":"beat","sourceTick":1200000}]));
    let project = query(
        &doc,
        &ids,
        json!({"kind":"read","clock":"project-timeline-ticks"}),
    );
    assert_eq!(project["status"], "ready");
    assert_eq!(project["clock"], "project-timeline-ticks");
    assert_eq!(project["mapping"]["sceneOffsetTick"], 0);
    doc["project"]["sceneState"]["scenes"][0]["isMain"] = json!(false);
    assert_eq!(
        query(
            &doc,
            &ids,
            json!({"kind":"read","clock":"project-timeline-ticks"})
        )["status"],
        "unavailable"
    );
    assert_eq!(
        query(
            &doc,
            &ids,
            json!({"kind":"read","clock":"sequence-timeline-ticks"})
        )["status"],
        "unavailable"
    );
    let source = json!({"sourceSha256":"a".repeat(64),"resourceSha256":"b".repeat(64),"resourceRevision":3,"reviewReference":"lyric-review","anchors":[{"key":"later","sourceTick":1200000},{"key":"trimmed","sourceTick":0},{"key":"same-time","sourceTick":1200000}]});
    let projected = query(
        &doc,
        &ids,
        json!({"kind":"project-anchors","anchorSource":source}),
    );
    assert_eq!(projected["status"], "ready", "{projected}");
    assert_eq!(projected["results"][0]["key"], "later");
    assert_eq!(projected["results"][0]["tick"], 1560000);
    assert_eq!(projected["results"][1]["status"], "unavailable");
    assert_eq!(projected["results"][2]["key"], "same-time");
    assert!(projected["results"][0]["frameTick"].is_number());
    assert_eq!(
        doc["project"]["musicGridState"]["grids"][0]["points"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn live_trim_rate_and_move_reproject_without_modifying_source_points() {
    let mut doc = document();
    let ids = create(&mut doc, json!([{"id":"beat","sourceTick":1200000}]));
    let read = query(&doc, &ids, json!({"kind":"list"}));
    assert_eq!(read["points"][0]["tick"], 1560000); // 5 + (10 - 2)
    doc["clips"][0]["retime"] = json!({"rate":2});
    doc["clips"][0]["duration"] = json!(1080000);
    doc["revision"] = json!(2);
    let moved = query(&doc, &ids, json!({"kind":"list"}));
    assert_eq!(moved["points"][0]["tick"], 1080000); // 5 + (10 - 2)/2
    assert_ne!(read["mappingHash"], moved["mappingHash"]);
    assert_eq!(
        query(
            &doc,
            &ids,
            json!({"kind":"read","expectedMappingHash":read["mappingHash"]})
        )["status"],
        "conflict"
    );
    assert_eq!(
        query(
            &doc,
            &ids,
            json!({"kind":"read","expectedNativeRevision":1})
        )["status"],
        "conflict"
    );
}
#[test]
fn snap_keeps_caller_order_signed_delta_and_earlier_tie_without_inventing_downbeats() {
    let mut doc = document();
    doc["clips"][0]["trimStart"] = json!(0);
    doc["clips"][0]["startTime"] = json!(0);
    let ids = create(
        &mut doc,
        json!([{"id":"early","sourceTick":1000},{"id":"late","sourceTick":3000}]),
    );
    let snap = query(
        &doc,
        &ids,
        json!({"kind":"snap","maxDistanceTicks":2000,"samples":[{"key":"b","tick":2900},{"key":"a","tick":2000}]}),
    );
    assert_eq!(snap["results"][0]["key"], "b");
    assert_eq!(snap["results"][0]["delta"], 100);
    assert_eq!(snap["results"][1]["pointId"], "early");
    assert_eq!(snap["results"][1]["delta"], -1000);
    assert_eq!(snap["downbeatsKnown"], false);
    assert_eq!(
        query(&doc, &ids, json!({"kind":"list","pointKind":"downbeat"}))["total"],
        0
    );
    assert_eq!(
        query(&doc, &ids, json!({"kind":"snap","samples":[]}))["status"],
        "unavailable"
    );
}
#[test]
fn rational_frame_quantization_has_exact_residual_and_ties_go_earlier() {
    let mut doc = document();
    doc["project"]["frameRate"] = json!({"numerator":30000,"denominator":1001});
    doc["clips"][0]["startTime"] = json!(0);
    doc["clips"][0]["trimStart"] = json!(0);
    let ids = create(&mut doc, json!([{"id":"tie","sourceTick":2002}]));
    let read = query(&doc, &ids, json!({"kind":"list"}));
    assert_eq!(read["points"][0]["frameTick"], 0);
    assert_eq!(read["points"][0]["frameQuantizationDelta"], -2002);
    doc["clips"][0]["retime"] = json!({"rate":1.5});
    let read = query(&doc, &ids, json!({"kind":"list"}));
    assert_eq!(
        read["points"][0]["exactTick"],
        json!({"numerator":20020,"denominator":15})
    );
    assert_eq!(
        read["points"][0]["frameQuantizationResidual"],
        json!({"numerator":-20020,"denominator":15})
    );
}
#[test]
fn reverse_uses_canonical_last_tick_and_freeze_curves_are_unavailable() {
    let mut doc = document();
    doc["clips"][0]["retime"] = json!({"rate":1,"reverse":true});
    let ids = create(&mut doc, json!([{"id":"last","sourceTick":1439999}]));
    assert_eq!(
        query(&doc, &ids, json!({"kind":"list"}))["points"][0]["tick"],
        600000
    );
    doc["clips"][0]["freezeFrame"] = json!(0);
    assert_eq!(
        query(&doc, &ids, json!({"kind":"list"}))["status"],
        "unavailable"
    );
    doc["clips"][0]
        .as_object_mut()
        .unwrap()
        .remove("freezeFrame");
    doc["clips"][0]["retime"]["curve"] = json!([]);
    assert_eq!(
        query(&doc, &ids, json!({"kind":"list"}))["status"],
        "unavailable"
    );
}
#[test]
fn binding_requires_explicit_live_clip_source_pin_and_grid_revision() {
    let mut doc = document();
    let ids = create(&mut doc, json!([{"id":"beat","sourceTick":1200000}]));
    assert_eq!(
        query(&doc, &ids, json!({"kind":"read","expectedGridRevision":99}))["status"],
        "conflict"
    );
    let mut changed = doc.clone();
    changed["assets"][0]["sourceSha256"] = json!("b".repeat(64));
    assert_eq!(
        query(&changed, &ids, json!({"kind":"read"}))["status"],
        "conflict"
    );
    changed["clips"] = json!([]);
    assert_eq!(
        query(&changed, &ids, json!({"kind":"read"}))["status"],
        "unavailable"
    );
    let bad = edit(
        &doc,
        json!({"kind":"replace-points","gridId":ids["gridId"],"expectedGridRevision":0,"points":[{"id":"b","sourceTick":1}],"reviewReference":"review"}),
    );
    assert_eq!(bad["status"], "conflict");
    let bad = edit(
        &doc,
        json!({"kind":"replace-points","gridId":ids["gridId"],"expectedGridRevision":1,"points":[{"id":"b","sourceTick":2},{"id":"a","sourceTick":1}],"reviewReference":"review"}),
    );
    assert_eq!(bad["status"], "unavailable");
    assert_eq!(
        serde_json::from_str::<Value>(&validate_music_grid_state_json(
            doc["project"]["musicGridState"].to_string()
        ))
        .unwrap(),
        json!([])
    );
}

#[test]
fn measured_import_uses_reviewed_analysis_and_never_synthesizes_downbeats() {
    let mut doc = document();
    let analysis = json!({"schema":"rocut-mv-audio/1","duration":20,"fps":1,"beats":[240000,1200000],"downbeats":[],
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"vocalSha256":null,"manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"fixture reviewed"}},
        "channels":{"mix_rms":vec![0.0;20],"low_power":vec![0.0;20],"mid_power":vec![0.0;20],"high_power":vec![0.0;20]},
        "scales":{"mix_rms":1,"low_power":1,"mid_power":1,"high_power":1}});
    let imported = edit(
        &doc,
        json!({"kind":"create-measured","clipId":"song","analysis":analysis,"reviewReference":"reviewed points"}),
    );
    assert_eq!(imported["status"], "admitted", "{imported}");
    doc["project"]["musicGridState"] =
        imported["batch"]["operations"][0]["patch"]["musicGridState"].clone();
    let result = query(&doc, &imported["created"], json!({"kind":"read"}));
    assert_eq!(result["downbeatsKnown"], false);
    assert_eq!(result["grid"]["mode"], "measured");
    let mut wrong = analysis.clone();
    wrong["provenance"]["inputSha256"] = json!("f".repeat(64));
    assert_eq!(
        edit(
            &document(),
            json!({"kind":"create-measured","clipId":"song","analysis":wrong,"reviewReference":"review"})
        )["status"],
        "conflict"
    );
}

#[test]
fn bindings_are_per_clip_and_trimmed_half_open_ranges_are_not_reused_globally() {
    let mut doc = document();
    let ids = create(
        &mut doc,
        json!([{"id":"outside","sourceTick":0},{"id":"inside","sourceTick":240000},{"id":"end","sourceTick":1440000}]),
    );
    let first = query(&doc, &ids, json!({"kind":"list","limit":1}));
    assert_eq!(first["total"], 1);
    assert_eq!(first["points"][0]["id"], "inside");
    let mut second = doc["clips"][0].clone();
    second["id"] = json!("song-copy");
    second["startTime"] = json!(3000000);
    doc["clips"].as_array_mut().unwrap().push(second);
    let bound = edit(
        &doc,
        json!({"kind":"bind","gridId":ids["gridId"],"expectedGridRevision":1,"clipId":"song-copy"}),
    );
    assert_eq!(bound["status"], "admitted");
    doc["project"]["musicGridState"] =
        bound["batch"]["operations"][0]["patch"]["musicGridState"].clone();
    assert_eq!(
        query(&doc, &bound["created"], json!({"kind":"list"}))["points"][0]["tick"],
        3000000
    );
    assert_eq!(
        query(&doc, &ids, json!({"kind":"list"}))["points"][0]["tick"],
        600000
    );
}
