use super::*;
use sha2::{Digest, Sha256};
fn fixture() -> (Session, HeartShatter, Vec<Resource>) {
    let rgba = vec![255; 20 * 20 * 4];
    let sha = "ab".repeat(32);
    let resource:Resource=serde_json::from_value(serde_json::json!({"id":"heart","kind":"image","mimeType":"image/png","byteLength":100,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{}",sha)})).unwrap();
    let binding = Binding {
        source: resource.clone(),
        decoded_width: 20,
        decoded_height: 20,
        decoded_rgba_sha256: format!("{:x}", Sha256::digest(&rgba)),
        decoder: plan::prepared::DECODER.into(),
        algorithm: plan::prepared::ALGORITHM.into(),
    };
    let session = Session::prepare(binding, &rgba, 256 * 1024 * 1024).unwrap();
    let args = HeartShatter {
        heart: "heart".into(),
        bg: None,
        break_beat: 2,
        break_at: None,
        x: 960.0,
        y: 470.0,
    };
    (session, args, vec![resource])
}
#[test]
fn full_shatter_produces_all_original_time_regions_without_scratch_leaks() {
    let (session, args, resources) = fixture();
    let beats = [
        0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000,
    ];
    for song_ticks in [
        0, 1200, 12000, 90000, 119999, 120000, 127920, 128040, 128041, 132000, 143880, 144000,
        240000, 480000,
    ] {
        let frame = session
            .frame(
                &args,
                &Sample {
                    shot_start_ticks: 0,
                    shot_end_ticks: 600000,
                    song_ticks,
                    beats: &beats,
                    bpm: 120.0,
                    resources: &resources,
                    background: None,
                },
            )
            .unwrap();
        assert!(frame.raster_budget_bytes > 0 && frame.raster_budget_bytes <= 256 * 1024 * 1024);
        let value = serde_json::to_value(frame).unwrap();
        let commands = value["commands"].as_array().unwrap();
        assert_eq!(commands[0]["id"], "heart-body");
        assert_eq!(commands.last().unwrap()["surface"], "heart-body");
        assert!(commands.iter().any(|c| c["id"] == "heart-halftone"));
        if song_ticks >= 120000 {
            assert!(commands.iter().any(|c| c["id"] == "heart-piece"));
        } else {
            assert!(commands.iter().any(|c| c["id"] == "heart-cracks"));
        }
    }
}
#[test]
fn source_and_prepared_rgba_identity_are_not_user_labels() {
    let (session, args, resources) = fixture();
    let images = session.images();
    let (image, rgba) = images[0];
    image.validate_rgba(image, rgba).unwrap();
    let mut changed = rgba.to_vec();
    changed[0] ^= 1;
    assert!(image.validate_rgba(image, &changed).is_err());
    let mut bad = image.clone();
    bad.width += 1;
    assert!(bad.validate_rgba(image, rgba).is_err());
    let mut source = serde_json::to_value(&resources[0]).unwrap();
    source["sha256"] = serde_json::json!("cd".repeat(32));
    source["attachmentKey"] = serde_json::json!(format!("programmatic-sha256-{}", "cd".repeat(32)));
    let changed_resources = vec![serde_json::from_value(source).unwrap()];
    assert!(session
        .frame(
            &args,
            &Sample {
                shot_start_ticks: 0,
                shot_end_ticks: 600000,
                song_ticks: 120000,
                beats: &[0, 60000, 120000],
                bpm: 120.0,
                resources: &changed_resources,
                background: None
            }
        )
        .is_err());
}
#[test]
fn empty_beats_and_unbound_background_fail_closed() {
    let (session, mut args, resources) = fixture();
    let sample = Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 600000,
        song_ticks: 120000,
        beats: &[],
        bpm: 120.0,
        resources: &resources,
        background: None,
    };
    assert!(session.frame(&args, &sample).is_err());
    args.bg = Some("background".into());
    let sample = Sample {
        beats: &[0, 60000, 120000],
        ..sample
    };
    assert!(session.frame(&args, &sample).is_err());
}

#[test]
fn optional_full_scene_oracle_artifact() {
    let Some(path) = std::env::var_os("MV_HEART_ORACLE_ARTIFACT_PATH") else {
        return;
    };
    let (session, args, resources) = fixture();
    let beats = [
        0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000,
    ];
    let mut frames = Vec::new();
    for song_ticks in [
        0, 1200, 12000, 90000, 119999, 120000, 127920, 128040, 128041, 132000, 143880, 144000,
        240000, 480000,
    ] {
        frames.push(serde_json::json!({"songTicks":song_ticks,"plan":session.frame(&args,&Sample{shot_start_ticks:0,shot_end_ticks:600000,song_ticks,beats:&beats,bpm:120.0,resources:&resources,background:None}).unwrap()}));
    }
    let burn = HeartBurn {
        heart: "heart".into(),
        bg: None,
        break_beat: 1,
        break_at: None,
        x: 960.0,
        y: 470.0,
    };
    for song_ticks in [
        0, 1200, 12000, 30000, 59999, 60000, 67920, 68040, 68041, 72000, 83880, 84000, 120000,
        240000, 480000,
    ] {
        frames.push(serde_json::json!({"mode":"burn","songTicks":song_ticks,"plan":session.burn_frame(&burn,&Sample{shot_start_ticks:0,shot_end_ticks:600000,song_ticks,beats:&beats,bpm:120.0,resources:&resources,background:None}).unwrap()}));
    }
    std::fs::write(path, serde_json::to_vec(&frames).unwrap()).unwrap();
}

#[test]
fn preparation_reserves_external_owners_before_component_allocation() {
    let (session, _, _) = fixture();
    let rgba = vec![255; 1600];
    assert!(Session::prepare(session.binding.clone(), &rgba, 16 * 1024 * 1024).is_err());
    assert!(Session::prepare(session.binding.clone(), &rgba[..1599], 256 * 1024 * 1024).is_err());
    let remaining = admission::reserve(&session.binding, rgba.len(), 256 * 1024 * 1024).unwrap();
    assert!(remaining < 256 * 1024 * 1024 - 16 * 1024 * 1024);
}

#[test]
fn full_burn_default_beat_and_phase_lifetimes() {
    let (session, _, resources) = fixture();
    let args: HeartBurn = serde_json::from_value(serde_json::json!({"heart":"heart"})).unwrap();
    assert_eq!(args.break_beat, 1);
    let beats = [
        0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000,
    ];
    for song_ticks in [
        0, 12000, 30000, 59999, 60000, 68041, 72000, 120000, 240000, 480000,
    ] {
        let frame = session
            .burn_frame(
                &args,
                &Sample {
                    shot_start_ticks: 0,
                    shot_end_ticks: 600000,
                    song_ticks,
                    beats: &beats,
                    bpm: 120.0,
                    resources: &resources,
                    background: None,
                },
            )
            .unwrap();
        assert!(frame.raster_budget_bytes <= 256 * 1024 * 1024);
        let value = serde_json::to_value(frame).unwrap();
        let commands = value["commands"].as_array().unwrap();
        assert_eq!(commands.last().unwrap()["surface"], "heart-body");
        if song_ticks < 60000 {
            assert!(commands.iter().any(|c| c["id"] == "heart-hot-body"));
        } else {
            assert!(commands.iter().any(|c| c["id"] == "heart-piece"));
        }
    }
}

#[test]
fn producer_preserves_earlier_break_and_zero_beat_semantics() {
    let (session, mut args, resources) = fixture();
    let beats = [0, 60000, 120000, 180000, 240000, 300000];
    args.break_at = Some(0.25);
    let frame = session
        .frame(
            &args,
            &Sample {
                shot_start_ticks: 120000,
                shot_end_ticks: 600000,
                song_ticks: 132000,
                beats: &beats,
                bpm: 120.0,
                resources: &resources,
                background: None,
            },
        )
        .unwrap();
    let value = serde_json::to_value(frame).unwrap();
    assert!(value["commands"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["id"] == "heart-piece"));
    args.break_at = None;
    args.break_beat = 0;
    session
        .frame(
            &args,
            &Sample {
                shot_start_ticks: 0,
                shot_end_ticks: 600000,
                song_ticks: 0,
                beats: &beats,
                bpm: 120.0,
                resources: &resources,
                background: None,
            },
        )
        .unwrap();
}
