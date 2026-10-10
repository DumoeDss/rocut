use super::*;
#[test]
fn road_preparation_requires_explicit_art_and_admitted_dimensions() {
    let default: model::Args = serde_json::from_value(serde_json::json!({})).unwrap();
    assert!(default.mode == model::Mode::Tear);
    let args: model::Args = serde_json::from_value(serde_json::json!({"mode":"run"})).unwrap();
    assert!(Session::prepare(args, vec![], None, 256 * 1024 * 1024).is_err());
    let args: model::Args = serde_json::from_value(serde_json::json!({"mode":"tear"})).unwrap();
    assert!(Session::prepare(args, vec![], None, 1024).is_err());
}
#[test]
fn pinhole_clips_near_plane_and_negative_log_rails_remain_original_noops() {
    let c = camera::Camera::new([0.0, 1.25, 0.0], 0.0, 0.15, 1150.0);
    assert!(c.p([0.0, 0.0, -10.0]).is_none());
    assert_eq!(c.quad(-1.0, 1.0, 0.0, 10.0).len(), 4);
    let mut d = plan::Draw::new();
    tiles::rail(&mut d, c, 0.0, -380.0, 50.0, 0.02, &|_| 1.0, 1.0);
    assert!(d.commands.is_empty());
}

fn tear_session() -> Session {
    let a = serde_json::from_value(serde_json::json!({"mode":"tear"})).unwrap();
    Session::prepare(a, vec![], None, 256 * 1024 * 1024).unwrap()
}
#[test]
fn complete_tear_frames_and_clock_negatives_are_budgeted() {
    let s = tear_session();
    let beats: Vec<u64> = (0..32).map(|i| i * 60000).collect();
    for tick in [
        0, 12000, 179999, 180000, 190000, 372000, 504000, 768000, 874800,
    ] {
        let p = s
            .frame(&model::Sample {
                song_ticks: tick,
                shot_start_ticks: 0,
                shot_end_ticks: 874800,
                beats: &beats,
                bpm: 120.0,
                stops: &[],
                downbeats: &[],
                resources: &[],
            })
            .unwrap();
        assert!(p.raster_budget_bytes > 0 && p.raster_budget_bytes <= 256 * 1024 * 1024);
        assert!(p.commands.len() <= 16384);
    }
    assert!(s
        .frame(&model::Sample {
            song_ticks: 0,
            shot_start_ticks: 0,
            shot_end_ticks: 874800,
            beats: &beats,
            bpm: 120.0,
            stops: &[2, 1],
            downbeats: &[],
            resources: &[]
        })
        .is_err());
}
#[test]
fn malformed_native_graph_and_nonfinite_actions_fail_before_replay() {
    use plan::{Action as A, Command as C, Plan};
    let s = tear_session();
    for commands in [
        vec![C::Native {
            target: "main",
            action: A::Restore,
        }],
        vec![C::Capture {
            surface: "absent",
            source_rect: [0.0; 4],
            destination_rect: [0.0; 4],
        }],
        vec![C::Native {
            target: "main",
            action: A::Alpha { value: f64::NAN },
        }],
        vec![C::Native {
            target: "main",
            action: A::Image {
                source: "main".into(),
                source_kind: "surface",
                source_rect: None,
                destination_rect: [0.0; 4],
                intrinsic: false,
            },
        }],
        vec![C::Native {
            target: "main",
            action: A::Image {
                source: "fallback.png".into(),
                source_kind: "asset",
                source_rect: None,
                destination_rect: [0.0; 4],
                intrinsic: false,
            },
        }],
        vec![C::Surface {
            id: "leaked",
            size: [1, 1],
        }],
        vec![
            C::Surface {
                id: "huge",
                size: [8192, 8192],
            },
            C::Release { surface: "huge" },
        ],
    ] {
        assert!(budget::frame(
            &Plan {
                commands,
                raster_budget_bytes: 0
            },
            &s
        )
        .is_err());
    }
}
#[test]
fn stop_downbeat_heuristics_and_freeze_motion_preserve_original() {
    let a: model::Args =
        serde_json::from_value(serde_json::json!({"mode":"run","char":"runner.png"})).unwrap();
    let sample = model::Sample {
        song_ticks: 120000,
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        beats: &[0, 60000],
        bpm: 120.0,
        stops: &[360000],
        downbeats: &[120000],
        resources: &[],
    };
    let t = timing::run(&a, &sample);
    assert_eq!(t.slow, 1.0);
    assert_eq!(t.freeze, 3.0);
    assert_eq!(timing::speed(3.0, &t), 0.0);
    assert_eq!(timing::distance(3.0, &t), timing::distance(4.0, &t));
    assert_eq!(timing::speed(0.9, &t), 8.5);
    assert!((timing::speed(1.4, &t) - 1.5).abs() < 1e-12);
}
