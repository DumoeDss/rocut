use super::{
    Sample, clock,
    draw::Draw,
    ease, keys,
    model::*,
    plan::{Command, Operation},
    shimmer,
    test_support::*,
};
use serde_json::json;

#[test]
fn beat_windows_are_strict_and_synthetic_visual_beats_do_not_enter_pulses() {
    assert_eq!(clock::last_before(&[1.0, 1.95], 2.0), 1.0);
    assert_eq!(clock::last_before(&[], 2.0), 1.54);
    assert_eq!(
        clock::from(&[0.96, 1.0, 1.46], 1.0, 4),
        vec![0.96, 1.0, 1.46, 1.92]
    );
    assert_eq!(clock::from(&[], 2.0, 2), vec![2.46, 2.92]);
    assert_eq!(clock::pulse(&[], 3.0, 9.0), 0.0);
    assert!((clock::pulse(&[0.5, 1.0], 1.5, 9.0) - (-4.5_f64).exp()).abs() < 1e-15);
}
#[test]
fn shimmer_is_one_native_scratch_and_exactly_225_explicit_four_pixel_strips() {
    let mut d = Draw::new(384.0, 216.0);
    let a = model("breathe");
    shimmer::draw(&mut d, 961.0, 539.0, 0.7, 1.25, 200.0, a.palette());
    let Command::Surface { size, commands, .. } = &d.commands[0] else {
        panic!("surface first")
    };
    assert_eq!(*size, [1600, 900]);
    assert_eq!(commands.len(), 5);
    assert_eq!(d.commands.len(), 226);
    for (index, command) in d.commands[1..].iter().enumerate() {
        let Command::Blit {
            source_rect,
            destination_rect,
            transform,
            composite,
            ..
        } = command
        else {
            panic!("strip")
        };
        assert_eq!(*source_rect, [0.0, index as f64 * 4.0, 1600.0, 4.0]);
        assert_eq!(destination_rect[1], 19.0 + index as f64 * 4.0);
        assert_eq!(*transform, [0.2, 0.0, 0.0, 0.2, 0.0, 0.0]);
        assert_eq!(*composite, "lighter");
    }
}
#[test]
fn breathe_keeps_song_time_fade_and_half_open_stops_require_real_facts() {
    let data = audio();
    let font = fonts(author("breathe"));
    let a = model("breathe");
    let mut s = sample(120000, Some(&data), Some(&font), None);
    let first = serde_json::to_value(a.plan(&s).unwrap()).unwrap();
    s.shot_start_ticks = 72000;
    assert_eq!(first, serde_json::to_value(a.plan(&s).unwrap()).unwrap());
    let mut settings = author("breathe");
    settings["stopsTicks"] = json!([[120000, 150000]]);
    let a: Ember = serde_json::from_value(settings).unwrap();
    assert_eq!(a.plan(&s).unwrap().commands.len(), 1);
    s.song_ticks = 149999;
    assert_eq!(a.plan(&s).unwrap().commands.len(), 1);
    s.song_ticks = 150000;
    assert!(a.plan(&s).unwrap().commands.len() > 226);
    s.song_ticks = 120000;
    s.fonts = None;
    assert!(a.plan(&s).is_err());
    let env = clock::Envelope::sample(&s).unwrap();
    assert_eq!(env.vocal, 0.0);
}
#[test]
fn overlapping_flare_response_is_max_not_sum() {
    let data = audio();
    let mut one = author("breathe");
    one["grain"] = json!(0);
    one["flaresTicks"] = json!([[0, 240000]]);
    let fonts = fonts(one.clone());
    let mut two = one.clone();
    two["flaresTicks"] = json!([[0, 240000], [60000, 240000]]);
    let a: Ember = serde_json::from_value(one).unwrap();
    let b: Ember = serde_json::from_value(two).unwrap();
    // Both bursts have expired; only the held flare response remains.
    let s = sample(192000, Some(&data), Some(&fonts), None);
    assert_eq!(
        serde_json::to_value(a.plan(&s).unwrap()).unwrap(),
        serde_json::to_value(b.plan(&s).unwrap()).unwrap()
    );
}
#[test]
fn collapse_manual_bypasses_audio_and_uses_real_cover_plus_independent_clip_transforms() {
    let images = image();
    let a = model("collapse");
    let mut s = sample(100000, None, None, Some(&images));
    let plan = a.plan(&s).unwrap();
    let image = plan
        .commands
        .iter()
        .find(|c| matches!(c, Command::Image { .. }))
        .unwrap();
    let Command::Image {
        destination_rect,
        operations,
        clip,
        ..
    } = image
    else {
        unreachable!()
    };
    assert_eq!(*destination_rect, [-960.0, -720.0, 1920.0, 1440.0]);
    assert!(clip.as_ref().unwrap().operations.is_empty());
    assert!(matches!(
        operations.as_slice(),
        [
            Operation::Translate { .. },
            Operation::Rotate { .. },
            Operation::Scale { .. },
            Operation::Translate { .. },
            Operation::Translate {
                offset: [960.0, 540.0]
            }
        ]
    ));
    s.song_ticks = 240000;
    s.images = None;
    assert!(a.plan(&s).is_err());
}
#[test]
fn automatic_collapse_preserves_late_hit_then_earlier_fallback_order() {
    let data = audio();
    let mut settings = author("collapse");
    settings["endTicks"] = json!(2400000);
    settings["keys"] = json!({"kind":"analysis","beats":{"kind":"analysis"}});
    let a: Ember = serde_json::from_value(settings).unwrap();
    let Ember::Collapse(a) = a else {
        unreachable!()
    };
    let mut s = sample(2200000, Some(&data), None, None);
    s.shot_start_ticks = 1920000;
    s.shot_end_ticks = 2400000;
    let result = keys::resolve(&a, &s).unwrap();
    assert_eq!(result.len(), 9);
    assert_eq!(result[4].time, 19.5);
    assert!(result[4].time > result[5].time);
    assert_eq!(result[4].factor, 0.5);
    assert_eq!(result[5].factor, 0.35);
    let mut missing = audio();
    missing.strong_onsets = None;
    let missing_sample = Sample {
        analysis: Some(&missing),
        ..s
    };
    assert!(keys::resolve(&a, &missing_sample).is_err());
    let mut empty = audio();
    let facts = empty.strong_onsets.as_mut().unwrap();
    facts.events.clear();
    facts.normalization_scale = 0.0;
    let empty_sample = Sample {
        analysis: Some(&empty),
        ..s
    };
    assert!(keys::resolve(&a, &empty_sample).is_ok());
}
#[test]
fn zero_seed_is_reference_five_and_native_camera_operations_are_ordered() {
    let data = audio();
    let mut settings = author("ignite");
    settings["blackFrom"] = json!({"kind":"at","songTicks":480000});
    let fonts = fonts(settings.clone());
    let s = sample(180000, Some(&data), Some(&fonts), None);
    let five: Ember = serde_json::from_value(settings.clone()).unwrap();
    settings["seed"] = json!(0);
    let zero: Ember = serde_json::from_value(settings).unwrap();
    let a = serde_json::to_value(five.plan(&s).unwrap()).unwrap();
    assert_eq!(a, serde_json::to_value(zero.plan(&s).unwrap()).unwrap());
    let commands = a["commands"].as_array().unwrap();
    let ops = &commands[2]["operations"];
    assert_eq!(ops[0]["kind"], "translate");
    assert_eq!(ops[1]["kind"], "scale");
    assert_eq!(ops[2]["kind"], "translate");
}
#[test]
fn whip_rejects_unrenderable_overshoot_without_rejecting_safe_authored_segments() {
    assert!(!ease::iris_segment_valid(1.0, 0.86, Easing::Whip));
    assert!(!ease::iris_segment_valid(0.0, 0.2, Easing::Whip));
    assert!(ease::iris_segment_valid(0.8, 0.6, Easing::Whip));
    assert!(ease::iris_segment_valid(1.0, 0.86, Easing::Soft));
}
