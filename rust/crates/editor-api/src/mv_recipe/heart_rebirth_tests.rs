use super::*;
use sha2::{Digest, Sha256};
fn resource(id: &str) -> Resource {
    let sha = "ab".repeat(32);
    serde_json::from_value(serde_json::json!({"id":id,"kind":"image","mimeType":"image/png","byteLength":100,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{}",sha)})).unwrap()
}
fn fixture() -> (Session, Vec<Resource>) {
    let rgba = vec![255; 1600];
    let resources = vec![resource("heart"), resource("fixture-character")];
    let binding = Binding {
        source: resources[0].clone(),
        decoded_width: 20,
        decoded_height: 20,
        decoded_rgba_sha256: format!("{:x}", Sha256::digest(&rgba)),
        decoder: plan::prepared::DECODER.into(),
        algorithm: plan::prepared::ALGORITHM.into(),
    };
    (
        Session::prepare(binding, &rgba, 256 * 1024 * 1024).unwrap(),
        resources,
    )
}
const BEATS: [u64; 11] = [
    0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000,
];
fn sample(resources: &[Resource], song_ticks: u64) -> Sample<'_> {
    Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 600000,
        song_ticks,
        beats: &BEATS,
        bpm: 120.0,
        resources,
        background: None,
    }
}
fn gather_args(ff: bool) -> rebirth_contract::Gather {
    serde_json::from_value(
        serde_json::json!({"heart":"heart","char":"fixture-character","firefly":ff}),
    )
    .unwrap()
}
fn sun_args() -> rebirth_contract::Sun {
    serde_json::from_value(serde_json::json!({"heart":"heart","char":"fixture-character"})).unwrap()
}
#[test]
fn original_gather_and_sun_regions_have_admitted_lifetimes() {
    let (session, resources) = fixture();
    let character = BackgroundFact {
        resource: &resources[1],
        width: 20,
        height: 20,
    };
    let mut gather_multi_piece = false;
    let mut sun_multi_piece = false;
    let mut sun_multi_halftone = false;
    fn wirewalk(plan: &Plan) -> bool {
        let wire = serde_json::to_value(plan).unwrap();
        let commands = wire["commands"].as_array().unwrap();
        // Independent full-frame walk, not only the Rust budget's approval.
        super::tests::assert_frame_lifetimes(commands);
        commands
            .iter()
            .filter(|command| {
                command["id"]
                    .as_str()
                    .is_some_and(|id| id.starts_with("heart-piece-"))
            })
            .count()
            > 1
    }
    for ticks in [
        0, 1200, 58799, 58800, 119999, 120000, 120001, 127199, 127200, 128040, 128041, 144000,
        240000, 540000, 128040, 0,
    ] {
        for ff in [false, true] {
            let p = gather::frame(
                &session,
                &gather_args(ff),
                &sample(&resources, ticks),
                &character,
            )
            .unwrap_or_else(|error| panic!("Gather at {ticks}, firefly={ff}: {error}"));
            assert!(p.raster_budget_bytes <= 256 * 1024 * 1024);
            gather_multi_piece |= wirewalk(&p);
        }
        let p = sun::frame(
            &session,
            &sun_args(),
            &sample(&resources, ticks),
            &character,
        )
        .unwrap_or_else(|error| panic!("Sun at {ticks}: {error}"));
        assert!(p.raster_budget_bytes <= 256 * 1024 * 1024);
        sun_multi_piece |= wirewalk(&p);
        let wire = serde_json::to_value(&p).unwrap();
        sun_multi_halftone |= wire["commands"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|command| {
                command["id"]
                    .as_str()
                    .is_some_and(|id| id.starts_with("heart-halftone-"))
            })
            .count()
            > 1;
    }
    assert!(
        gather_multi_piece && sun_multi_piece,
        "Both producers must exercise multiple distinct piece lifetimes"
    );
    assert!(
        sun_multi_halftone,
        "Sun must exercise both independent halftone lifetimes"
    );
}
#[test]
fn character_and_author_bounds_are_not_native_facts() {
    let (session, resources) = fixture();
    let mut a = gather_args(false);
    a.char_h = Some(f64::NAN);
    let fact = BackgroundFact {
        resource: &resources[1],
        width: 20,
        height: 20,
    };
    assert!(gather::frame(&session, &a, &sample(&resources, 0), &fact).is_err());
    let wrong = BackgroundFact {
        resource: &resources[0],
        width: 20,
        height: 20,
    };
    assert!(sun::frame(&session, &sun_args(), &sample(&resources, 0), &wrong).is_err());
    let mut a = sun_args();
    a.sun_r = Some(-1.0);
    assert!(sun::frame(&session, &a, &sample(&resources, 0), &fact).is_err());
}
#[test]
fn optional_rebirth_scene_artifacts() {
    let gather_path = std::env::var_os("MV_HEART_GATHER_ARTIFACT_PATH");
    let sun_path = std::env::var_os("MV_HEART_SUN_ARTIFACT_PATH");
    if gather_path.is_none() && sun_path.is_none() {
        return;
    }
    let (session, resources) = fixture();
    let character = BackgroundFact {
        resource: &resources[1],
        width: 20,
        height: 20,
    };
    if let Some(path) = gather_path {
        let mut rows = Vec::new();
        for ff in [false, true] {
            for ticks in [
                0, 1200, 12000, 48000, 58799, 58800, 60000, 119999, 120000, 128040, 128041, 144000,
                240000, 480000, 540000,
            ] {
                let a = gather_args(ff);
                let plan =
                    gather::frame(&session, &a, &sample(&resources, ticks), &character).unwrap();
                rows.push(serde_json::json!({"songTicks":ticks,"args":a,"plan":plan}));
            }
        }
        std::fs::write(path, serde_json::to_vec(&rows).unwrap()).unwrap();
    }
    if let Some(path) = sun_path {
        let mut rows = Vec::new();
        for ticks in [
            0, 1200, 12000, 90000, 119999, 120000, 120001, 127199, 127200, 128040, 128041, 132000,
            156000, 240000, 480000,
        ] {
            let a = sun_args();
            let plan = sun::frame(&session, &a, &sample(&resources, ticks), &character).unwrap();
            rows.push(serde_json::json!({"songTicks":ticks,"args":a,"plan":plan}));
        }
        std::fs::write(path, serde_json::to_vec(&rows).unwrap()).unwrap();
    }
}
