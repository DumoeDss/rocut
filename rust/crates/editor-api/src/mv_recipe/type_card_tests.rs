use super::{
    TypeCard, math,
    model::{Beats, TypeCard as Card},
    test_support::*,
};
use serde_json::json;

#[test]
fn quiet_requires_metrics_and_exact_optical_placement_is_done_in_rust() {
    let mut value = settings("quiet");
    value["fontSize"] = json!(100.0 / 1080.0);
    value["gap"] = json!(0.2);
    value["glyphs"] = json!([{"text":"A","opticalScale":1},{"text":"B","opticalScale":0.5}]);
    value["lead"] = json!(0);
    value["stagger"] = json!(0);
    value["fade"] = json!(0.1);
    value["grain"] = json!(0);
    let fonts = context(value.clone());
    let a: TypeCard = serde_json::from_value(value.clone()).unwrap();
    assert!(
        a.plan(&sample(1.0, None))
            .err()
            .unwrap()
            .contains("verified font metrics")
    );
    let plan = a.plan(&sample(1.0, Some(&fonts))).unwrap();
    let q = plan.quiet.unwrap();
    // Extents 50/25, gap20, total95; center baseline at960/540.
    assert_eq!(q.glyphs[0].position, [932.5, 540.0]);
    assert_eq!(q.glyphs[1].position, [992.5, 540.0]);
    assert_eq!(q.glyphs[1].font_size, 50.0);
    assert_eq!(q.glyphs[0].opacity, 0.96);
    assert_eq!(q.rule[0].opacity, 0.95);
    value["orientation"] = json!("vertical");
    let a: TypeCard = serde_json::from_value(value).unwrap();
    let q = a.plan(&sample(1.0, Some(&fonts))).unwrap().quiet.unwrap();
    assert_eq!(q.glyphs[0].position, [955.0, 532.5]);
    assert_eq!(q.glyphs[1].position, [957.5, 582.5]);
}

#[test]
fn settings_reject_control_text_unknown_fields_missing_nullable_and_invalid_nested_values() {
    for mode in ["quiet", "flicker"] {
        let base = settings(mode);
        assert!(
            serde_json::from_value::<TypeCard>(base.clone())
                .unwrap()
                .valid()
        );
        for key in base.as_object().unwrap().keys() {
            let mut value = base.clone();
            value.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<TypeCard>(value).is_err(),
                "required {mode}.{key}"
            );
        }
    }
    for (mode, path, value) in [
        ("quiet", "/glyphs/0/text", json!("AB")),
        ("quiet", "/glyphs/0/opticalScale", json!(0)),
        ("quiet", "/subtitle/text", json!("line\nline")),
        ("quiet", "/fade", json!(0)),
        ("flicker", "/layouts/0/parts/0/text", json!("a".repeat(129))),
        ("flicker", "/morse/elements", json!([1, 2])),
        ("flicker", "/flood/colors/3/3", json!(1)),
        ("flicker", "/beats/songTicks", json!([10, 10])),
    ] {
        let mut v = settings(mode);
        *v.pointer_mut(path).unwrap() = value;
        assert!(
            !serde_json::from_value::<TypeCard>(v).unwrap().valid(),
            "{path}"
        );
    }
    let mut value = settings("quiet");
    value["unrequested"] = json!(true);
    assert!(serde_json::from_value::<TypeCard>(value).is_err());
    let mut value = settings("flicker");
    value["beats"] = json!({"kind":"analysis","unknown":true});
    assert!(serde_json::from_value::<TypeCard>(value).is_err());
    let mut value = settings("flicker");
    value["layouts"][0]["frame"]
        .as_object_mut()
        .unwrap()
        .remove("indicator");
    assert!(serde_json::from_value::<TypeCard>(value).is_err());
}

#[test]
fn fewer_than_four_beats_select_the_last_layouts_and_analysis_is_not_invented() {
    let s = sample(0.0, None);
    let p = super::beats::phase(&Beats::Manual { song_ticks: vec![] }, &s).unwrap();
    assert_eq!(p.layout, 3);
    let p = super::beats::phase(
        &Beats::Manual {
            song_ticks: vec![0, 120_000],
        },
        &s,
    )
    .unwrap();
    assert_eq!(p.layout, 2);
    assert!(super::beats::phase(&Beats::Analysis {}, &s).is_err());
    let p = super::beats::phase(
        &Beats::Manual {
            song_ticks: vec![0, 60_000, 120_000, 180_000, 240_000],
        },
        &sample(0.75, None),
    )
    .unwrap();
    assert_eq!(p.layout, 0);
    assert_eq!(p.since, 0.25);
    let mut shifted = sample(0.0, None);
    shifted.shot_start_ticks = 120_000;
    let p = super::beats::phase(
        &Beats::Manual {
            song_ticks: vec![116_000, 200_000],
        },
        &shifted,
    )
    .unwrap();
    assert_eq!(p.since, 4000.0 / 120_000.0);
}

#[test]
fn flicker_builds_crt_rgb_slices_morse_grain_flood_and_negative_and_replays_exactly() {
    let mut value = settings("flicker");
    value["layouts"][2]["hold"] = json!({"kind":"sustain"});
    value["layouts"][3]["hold"] = json!({"kind":"sustain"});
    let a: TypeCard = serde_json::from_value(value).unwrap();
    let p = a.plan(&sample(0.0, None)).unwrap();
    let f = p.flicker.unwrap();
    assert_eq!(f.text.len(), 3);
    assert_eq!(f.erasers.len(), 360);
    assert!(!f.bands.is_empty());
    assert_eq!(f.blocks.len(), 16);
    assert!(f.frame.is_some());
    assert!(p.grain.is_some());
    let idle = a.plan(&sample(0.4, None)).unwrap().flicker.unwrap();
    assert!(idle.text.is_empty() && idle.bands.is_empty());
    assert!(idle.idle_scan.is_some());
    let early = a.plan(&sample(1.1, None)).unwrap();
    assert!(early.flicker.as_ref().unwrap().kick_glow.is_some());
    let last = a.plan(&sample(4.0, None)).unwrap();
    assert!(last.flood.is_some() && last.white.is_some() && last.negative.is_some());
    let again = a.plan(&sample(1.1, None)).unwrap();
    assert_eq!(
        serde_json::to_value(&early).unwrap(),
        serde_json::to_value(&again).unwrap()
    );
    let mut other = sample(1.1, None);
    other.seed = 1;
    assert_ne!(
        serde_json::to_value(&again).unwrap(),
        serde_json::to_value(a.plan(&other).unwrap()).unwrap()
    );
    let Card::Flicker(a) = a else {
        panic!("flicker")
    };
    assert_eq!(
        super::finishing::morse(&a.morse, &sample(4.0, None)).elements[0].color,
        a.morse.lit_color
    );
}

#[test]
fn grain_matches_original_single_tile_and_seeded_offsets_not_afterimage_noise() {
    let grain = math::grain(0, 37, 0.05).unwrap();
    // Evaluated from the original util.js/typo.js in an isolated Node VM.
    assert_eq!(
        grain
            .gray
            .iter()
            .fold(2166136261u32, |h, b| (h ^ u32::from(*b))
                .wrapping_mul(16777619)),
        4133160733
    );
    for (x, expected) in [
        (0.1, 0.038582096949656794),
        (0.25, 0.3151471677894433),
        (0.5, 0.7912565774213536),
        (0.75, 0.9603364455481088),
    ] {
        assert!((math::soft(x) - expected).abs() < 1e-14);
    }
    assert!((math::out(0.25) - 0.8256230475093821).abs() < 1e-14);
    assert_eq!(grain.gray.len(), 65536);
    assert_eq!(grain.offset, [214, 224]);
    assert_eq!(grain.gray, math::grain(0, 38, 0.05).unwrap().gray);
    assert_ne!(grain.gray, math::grain(1, 37, 0.05).unwrap().gray);
    assert!(math::grain(0, 0, 0.0).is_none());
}
