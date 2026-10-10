use super::*;
#[test]
fn child_only_mappers_match_full_plans_and_default_work_fits() {
    let freeze: Freeze = serde_json::from_str("{}").unwrap();
    let melt: Melt = serde_json::from_str("{}").unwrap();
    for t in [120000, 240000, 480000] {
        assert_eq!(
            serde_json::to_value(freeze.child_sample("child", &sample(t)).unwrap()).unwrap(),
            serde_json::to_value(freeze.plan("child", &sample(t), 1920, 1080).unwrap().child)
                .unwrap()
        );
        assert_eq!(
            serde_json::to_value(melt.child_sample("child", &sample(t)).unwrap()).unwrap(),
            serde_json::to_value(melt.plan("child", &sample(t), 1920, 1080).unwrap().child)
                .unwrap()
        );
    }
    assert!(freeze.expanded_work().unwrap() <= 4096);
    assert!(melt.expanded_work().unwrap() <= 4096);
    let panels: Panels = serde_json::from_str(r#"{"panels":[{},{},{},{}]}"#).unwrap();
    assert!(panels.expanded_work().unwrap() <= 4096);
    assert!(panels.plan_bytes_bound().unwrap() <= 8 * 1024 * 1024);
}
fn beat_fixture() -> crate::mv_audio::Data {
    serde_json::from_value(serde_json::json!({"schema":"rocut-mv-audio/1","provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"meta CPU unit fixture"}},"duration":6,"fps":1,"beats":[0,60000,120000,180000,240000,300000,360000,420000,480000,540000,600000,660000],"downbeats":[0,240000,480000],"channels":{"mix_rms":vec![0.1;6],"low_power":vec![0.1;6],"mid_power":vec![0.1;6],"high_power":vec![0.1;6]},"scales":{"mix_rms":1,"low_power":1,"mid_power":1,"high_power":1}})).unwrap()
}
#[test]
fn rewind_child_discovery_has_no_font_requirement() {
    let a: Rewind = serde_json::from_str("{}").unwrap();
    let data = beat_fixture();
    let mut s = sample(480000);
    s.analysis = Some(&data);
    let candidates = [ShotCandidate {
        input: "child",
        start_ticks: 120000,
        is_reference: false,
    }];
    assert!(a
        .child_sample("child", "rewind", &s, &candidates)
        .unwrap()
        .is_some());
    assert!(a
        .plan("child", "rewind", &s, &candidates, &[], None, 1920, 1080)
        .is_err());
    let a: Rewind = serde_json::from_str(r#"{"osd":false}"#).unwrap();
    assert_eq!(
        serde_json::to_value(a.child_sample("child", "rewind", &s, &candidates).unwrap()).unwrap(),
        serde_json::to_value(
            a.plan("child", "rewind", &s, &candidates, &[], None, 1920, 1080)
                .unwrap()
                .child
        )
        .unwrap()
    );
}
#[test]
fn panels_lightweight_discovery_matches_paint_and_metadata_bound() {
    let a:Panels=serde_json::from_str(r#"{"panels":[{"input":"first","alt":{"input":"other"}},{"tone":{"step":32}}],"collapseAt":4}"#).unwrap();
    let data = beat_fixture();
    let mut s = sample(360000);
    s.analysis = Some(&data);
    let p = a.plan(&s, 120.0, 1920, 1080).unwrap();
    let samples = a.child_samples(&s, 120.0, 1920, 1080).unwrap();
    assert_eq!(
        serde_json::to_value(samples).unwrap(),
        serde_json::to_value(p.panels.iter().map(|p| &p.child).collect::<Vec<_>>()).unwrap()
    );
    assert!(serde_json::to_vec(&p).unwrap().len() as u64 <= a.plan_bytes_bound().unwrap());
    assert_eq!(a.inputs(), vec!["first", "other"]);
}
#[test]
fn panels_original_focus_speed_and_collapse_paths_are_bounded() {
    let data = beat_fixture();
    let mut s = sample(480000);
    s.analysis = Some(&data);
    let focus: Panels =
        serde_json::from_str(r#"{"panels":[{"input":"first","lines":"focus"}],"collapseAt":4}"#)
            .unwrap();
    let p = focus.plan(&s, 120.0, 1920, 1080).unwrap();
    assert_eq!(p.panels[0].lines.len(), 2);
    assert_eq!(p.panels[0].lines[0].triangles.len(), 110);
    assert_eq!(p.panels[0].lines[1].triangles.len(), 170);
    let speed: Panels = serde_json::from_str(
        r#"{"panels":[{"input":"first","lines":"speed","linesN":256}],"collapseAt":4}"#,
    )
    .unwrap();
    let p = speed.plan(&s, 120.0, 1920, 1080).unwrap();
    assert_eq!(p.panels[0].lines[1].triangles.len(), 256);
    assert!(serde_json::to_vec(&p).unwrap().len() as u64 <= speed.plan_bytes_bound().unwrap());
    let q = speed.plan(&s, 120.0, 1920, 1080).unwrap();
    assert_eq!(
        serde_json::to_value(p).unwrap(),
        serde_json::to_value(q).unwrap()
    );
    let invalid: Panels =
        serde_json::from_str(r#"{"panels":[{"lines":"speed","linesN":257}]}"#).unwrap();
    assert!(invalid.validate().is_err());
}
fn sample<'a>(t: u64) -> Sample<'a> {
    Sample {
        song_ticks: t,
        shot_start_ticks: 120000,
        shot_end_ticks: 600000,
        analysis: None,
    }
}
#[test]
fn freeze_keeps_live_prefix_and_exact_held_child() {
    let a: Freeze = serde_json::from_str(r#"{"at":2,"crackAt":3}"#).unwrap();
    let p = a.plan("child", &sample(120000), 1920, 1080).unwrap();
    assert!(p.live);
    assert_eq!(p.child.song_ticks, 120000);
    let p = a.plan("child", &sample(360000), 1920, 1080).unwrap();
    assert!(!p.live);
    assert_eq!(p.child.song_ticks, 240000);
    assert!(!p.strokes.is_empty());
    let p = a.plan("child", &sample(480000), 1920, 1080).unwrap();
    assert_eq!(p.frames.len(), 2);
    assert!(p.frames.iter().all(|f| f.clip.is_some()));
}
#[test]
fn freeze_closed_author_and_deterministic_seek() {
    assert!(serde_json::from_str::<Freeze>(r#"{"greyMix":0.3}"#).is_err());
    let a: Freeze = serde_json::from_str(r#"{"at":2,"crackAt":3,"crackSeed":23}"#).unwrap();
    let p = a.plan("child", &sample(480000), 1920, 1080).unwrap();
    let q = a.plan("child", &sample(480000), 1920, 1080).unwrap();
    assert_eq!(
        serde_json::to_value(p).unwrap(),
        serde_json::to_value(q).unwrap()
    );
    assert!(a.plan("child", &sample(480000), 1280, 720).is_err());
}
#[test]
fn melt_closed_form_columns_cover_frame_and_child_clock() {
    let a: Melt = serde_json::from_str(r#"{"live":true,"rate":0.25}"#).unwrap();
    let p = a.plan("child", &sample(360000), 1920, 1080).unwrap();
    assert_eq!(p.child.song_ticks, 180000);
    assert_eq!(p.columns.first().unwrap().x, 0.0);
    let last = p.columns.last().unwrap();
    assert_eq!(last.x + last.width, 1920.0);
    let q = a.plan("child", &sample(360000), 1920, 1080).unwrap();
    assert_eq!(
        serde_json::to_value(p).unwrap(),
        serde_json::to_value(q).unwrap()
    );
    assert!(serde_json::from_str::<Melt>(r#"{"staticRgba":[]}"#).is_err());
    let bad: Melt = serde_json::from_str(r#"{"meltAt":4,"meltEnd":2}"#).unwrap();
    assert!(bad.plan("child", &sample(360000), 1920, 1080).is_err());
}
