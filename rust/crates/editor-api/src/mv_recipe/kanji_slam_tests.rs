use super::{
    budget,
    clock::Clock,
    math,
    model::{Beats, KanjiSlam},
    plan::Command,
    state::State,
};
#[path = "kanji_slam_test_support.rs"]
mod support;
use support::*;
#[test]
fn original_shot_tolerance_end_exclusion_and_two_frame_anticipation() {
    let a = settings("default");
    let c = Clock::new(&a, &sample(4.0)).unwrap();
    assert_eq!(c.shot_beats.len(), 8);
    assert!((c.elapsed - 0.045).abs() < 1e-12);
    for (t, expected) in [
        (4.5 - 2.0 / 30.0, 0.0),
        (4.5 - 1.0 / 30.0, 0.25),
        (4.5, 0.0),
    ] {
        let c = Clock::new(&a, &sample(t)).unwrap();
        assert!((c.anticipation() - expected).abs() < 1e-10);
    }
    for (index, tick, count) in [
        (8, 474599, 8),
        (8, 474600, 8),
        (8, 485400, 8),
        (8, 485401, 9),
        (16, 954599, 9),
        (16, 954600, 8),
        (16, 954601, 8),
    ] {
        let mut a = settings("default");
        if let Beats::Manual { song_ticks } = &mut a.beats {
            song_ticks[index] = tick;
        }
        assert_eq!(
            Clock::new(&a, &sample(4.0)).unwrap().shot_beats.len(),
            count
        );
    }
}
#[test]
fn kanji_small_kana_alternation_rekick_and_exact_quant_are_preserved() {
    let a = settings("default");
    let c = Clock::new(&a, &sample(4.8)).unwrap();
    let s = State::new(&a, &c);
    assert!(!s.rekick);
    assert_eq!(s.glyphs.len(), 2);
    assert_eq!(s.glyphs[0].ch, 'っ');
    assert_eq!(s.glyphs[0].y, 470.0);
    assert_eq!(s.glyphs[1].scale, 1.1);
    let c = Clock::new(&a, &sample(5.6)).unwrap();
    let s = State::new(&a, &c);
    assert_eq!(s.glyphs[0].y, 800.0);
    let c = Clock::new(&a, &sample(6.0)).unwrap();
    let s = State::new(&a, &c);
    assert!(s.rekick);
    assert!(s.previous.is_empty());
    assert_eq!(s.smear, 0.0);
    assert_eq!(math::quant(1.0 / 12.0 - 1e-9, 12.0), 1.0 / 12.0);
    assert_eq!(math::out(0.0), 0.0);
    assert_eq!(math::out(1.0), 1.0);
}
#[test]
fn all_variants_emit_real_transport_layers_and_repeat_after_nonmonotonic_seek() {
    for variant in ["default", "night", "hand"] {
        let a = settings(variant);
        let sample = sample(4.8);
        let (fonts, images) = facts(&a, &sample);
        let first = a.produce(&sample, 1920, 1080, &fonts, &images).unwrap();
        let encoded = serde_json::to_string(&first).unwrap();
        assert!(encoded.contains("textStroke"));
        assert!(encoded.contains("rectBatch"));
        assert!(encoded.contains("sourceRect"));
        assert!(encoded.contains("ks-rim-inner"));
        assert!(encoded.contains("ks-cast"));
        assert!(encoded.contains("grain"));
        if variant == "hand" {
            assert!(encoded.contains("alphaPixels"));
            assert!(encoded.contains("surfacePatternRect"));
            assert!(encoded.contains("ks-heat"));
        }
        let other = support::sample(7.8);
        let (f2, i2) = facts(&a, &other);
        a.produce(&other, 1920, 1080, &f2, &i2).unwrap();
        assert_eq!(
            encoded,
            serde_json::to_string(&a.produce(&sample, 1920, 1080, &fonts, &images).unwrap())
                .unwrap()
        );
        let (count, steps) = budget::work(&first.commands);
        assert!(count < 4096);
        assert!(steps < 100_000);
        assert!(first.commands.iter().any(|c| matches!(
            c,
            Command::ReleaseSurface {
                surface: "ks-finished"
            }
        )));
    }
}
#[test]
fn font_image_and_parameter_readiness_rejects_missing_facts() {
    let a = settings("default");
    let s = sample(4.8);
    let (fonts, images) = facts(&a, &s);
    let empty_fonts = crate::mv_font_metrics::Context::new(&[], &[]).unwrap();
    assert!(a.produce(&s, 1920, 1080, &empty_fonts, &images).is_err());
    let empty_images = crate::mv_image_dimensions::Context::new(&[], &[]).unwrap();
    assert!(a.produce(&s, 1920, 1080, &fonts, &empty_images).is_err());
    let span = crate::mv_recipe::model::Span {
        start_frame: 0,
        duration_frames: 120,
    };
    assert!(a.valid(480000, &span, 4000));
    let mut json = author("default");
    json["wind"]["from"] = serde_json::json!(1);
    let bad: KanjiSlam = serde_json::from_value(json).unwrap();
    assert!(!bad.valid(480000, &span, 4000));
}
