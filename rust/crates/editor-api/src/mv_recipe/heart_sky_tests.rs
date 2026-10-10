use super::*;
fn resources() -> Vec<Resource> {
    let sha = "ab".repeat(32);
    ["fixture-sky","fixture-character"].into_iter().map(|id|serde_json::from_value(serde_json::json!({"id":id,"kind":"image","mimeType":"image/png","byteLength":100,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{}",sha)})).unwrap()).collect()
}
fn args() -> sky::Args {
    serde_json::from_value(serde_json::json!({"bg":"fixture-sky","char":"fixture-character"}))
        .unwrap()
}
const BEATS: [u64; 11] = [
    0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000,
];
fn sample(resources: &[Resource], ticks: u64) -> Sample<'_> {
    Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 600000,
        song_ticks: ticks,
        beats: &BEATS,
        bpm: 120.0,
        resources,
        background: Some(BackgroundFact {
            resource: &resources[0],
            width: 20,
            height: 20,
        }),
    }
}
#[test]
fn sky_release_layers_and_native_scratch_are_jointly_admitted() {
    let r = resources();
    let session = sky::Session::prepare(
        r[0].clone(),
        20,
        20,
        3913,
        [1150.0, 300.0],
        "#070b1c",
        256 * 1024 * 1024,
    )
    .unwrap();
    let character = BackgroundFact {
        resource: &r[1],
        width: 20,
        height: 20,
    };
    for ticks in [0, 60000, 120000, 240000, 480000] {
        let p = session
            .frame(&args(), &sample(&r, ticks), &character)
            .unwrap();
        assert!(p.raster_budget_bytes > 0 && p.raster_budget_bytes <= 256 * 1024 * 1024);
    }
}
#[test]
fn sky_rejects_forged_session_settings_and_unadmitted_sources() {
    let r = resources();
    assert!(
        sky::Session::prepare(r[0].clone(), 20, 20, 3913, [1150.0, 300.0], "#070b1c", 1024)
            .is_err()
    );
    let session = sky::Session::prepare(
        r[0].clone(),
        20,
        20,
        3913,
        [1150.0, 300.0],
        "#070b1c",
        256 * 1024 * 1024,
    )
    .unwrap();
    let character = BackgroundFact {
        resource: &r[1],
        width: 20,
        height: 20,
    };
    let mut a = args();
    a.seed = Some(1);
    assert!(session.frame(&a, &sample(&r, 0), &character).is_err());
    let mut a = args();
    a.bands = Some(0);
    assert!(session.frame(&a, &sample(&r, 0), &character).is_err());
}
#[test]
fn optional_sky_scene_artifact() {
    let Some(path) = std::env::var_os("MV_SKY_SHATTER_ARTIFACT_PATH") else {
        return;
    };
    let r = resources();
    let session = sky::Session::prepare(
        r[0].clone(),
        20,
        20,
        3913,
        [1150.0, 300.0],
        "#070b1c",
        256 * 1024 * 1024,
    )
    .unwrap();
    let character = BackgroundFact {
        resource: &r[1],
        width: 20,
        height: 20,
    };
    let mut rows = Vec::new();
    for ticks in [
        0, 1200, 48000, 59999, 60000, 60001, 72000, 119999, 120000, 180000, 240000, 300000, 480000,
        540000,
    ] {
        let a = args();
        let plan = session.frame(&a, &sample(&r, ticks), &character).unwrap();
        rows.push(serde_json::json!({"songTicks":ticks,"args":a,"plan":plan}));
    }
    std::fs::write(path, serde_json::to_vec(&rows).unwrap()).unwrap();
}
