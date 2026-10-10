use super::*;

fn recipe() -> Recipe {
    serde_json::from_value(serde_json::json!({
        "version":1,"root":"fill","songStartSeconds":5,"outputRoles":["background"],
        "nodes":[{"id":"fill","scene":{"kind":"solid","role":"background","color":[0,0,0,1]}}]
    })).unwrap()
}

#[test]
fn native_tick_remap_keeps_subframe_time_and_outer_song_clock() {
    let recipe = recipe();
    let clock = Clock::new(&recipe, 0, 4000, 1, 1920, 1080, None, &[], 0, None, None, None, None).unwrap();
    let child = clock.remap_song_ticks(608075).unwrap();
    assert_eq!(child.frame, 2);
    assert_eq!(child.source_ticks, 8075);
    assert_eq!(child.sequence_source_ticks, 8075);
    assert_eq!(child.root_song_seconds, 5.0);
    let (song, frame) = child.drawing(None);
    assert!((song - 5.067291666666667).abs() < 1e-12);
    assert_eq!(frame, 2.01875);
    assert_eq!(child.elapsed(&Span { start_frame: 2, duration_frames: 4 }).unwrap(), 75);
    let (_, quantized) = child.drawing(Some(30));
    assert_eq!(quantized, 2.0);
}

#[test]
fn native_tick_remap_does_not_silently_clamp_before_the_source() {
    let recipe = recipe();
    let clock = Clock::new(&recipe, 0, 4000, 1, 1920, 1080, None, &[], 0, None, None, None, None).unwrap();
    assert!(clock.remap_song_ticks(-1).is_err());
    assert!(clock.remap_song_ticks(599999).is_err());
    assert_eq!(clock.remap_song_ticks(600000).unwrap().drawing(None), (5.0, 0.0));
}
