use super::{model::Ember, plan::Command, test_support::*};
use crate::mv_recipe::model::Span;
use serde_json::json;

fn work(commands: &[Command]) -> usize {
    commands
        .iter()
        .map(|command| match command {
            Command::Path { path, paints, .. } => path.len() + paints.len(),
            Command::Surface { commands, .. } => 1 + work(commands),
            Command::Grain { .. } => 256,
            Command::Text { text, .. } => text.chars().count(),
            Command::Image { clip, .. } => 1 + clip.as_ref().map_or(0, |v| v.path.len()),
            _ => 1,
        })
        .sum()
}
#[test]
fn simultaneous_cues_and_dense_beats_fit_explicit_vertex_paint_and_scratch_budgets() {
    let data = audio();
    for mode in ["breathe", "ignite"] {
        let mut settings = author(mode);
        settings["hud"]["title"] = json!("Ō".repeat(96));
        let time = if mode == "breathe" {
            settings["flaresTicks"] = json!(vec![[1200000, 1440000]; 32]);
            settings["thumpsTicks"] = json!(vec![1200000; 32]);
            1212000
        } else {
            settings["blackFrom"] = json!({"kind":"at","songTicks":1800000});
            settings["crackAtTicks"] = json!(1380000);
            settings["beats"] = json!({"kind":"manual","songTicks":(0..12).map(|i|1380000+i*1200).collect::<Vec<_>>()});
            1398000
        };
        let fonts = fonts(settings.clone());
        for seed in [0, 1, 5, 17, 64, u32::MAX] {
            if mode == "ignite" {
                settings["seed"] = json!(seed);
            }
            let model: Ember = serde_json::from_value(settings.clone()).unwrap();
            let mut s = sample(time, Some(&data), Some(&fonts), None);
            s.shot_start_ticks = if mode == "ignite" { 1380000 } else { 0 };
            s.shot_end_ticks = 1860000;
            let plan = model.plan(&s).unwrap();
            let actual = work(&plan.commands);
            assert!(
                actual <= model.work() as usize,
                "{mode} seed={seed}: {actual}>{}",
                model.work()
            );
            assert!(model.work() <= 4096);
            if mode == "breathe" {
                assert_eq!(model.scratch_pixels(), 2 * 1600 * 900 + 2 * 65536);
            }
        }
    }
}
#[test]
fn strict_author_fields_and_whip_extrema_reject_before_rendering() {
    let span = Span {
        start_frame: 0,
        duration_frames: 60,
    };
    for mode in ["breathe", "ignite", "collapse"] {
        let settings = author(mode);
        let model: Ember = serde_json::from_value(settings.clone()).unwrap();
        assert!(model.valid(0, &span, 4000));
        assert!(model.resources_valid(&resources()));
        for field in settings.as_object().unwrap().keys() {
            let mut missing = settings.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<Ember>(missing).is_err(),
                "missing {mode}.{field}"
            );
        }
        let mut unknown = settings;
        unknown["nativeDimensions"] = json!([1920, 1080]);
        assert!(serde_json::from_value::<Ember>(unknown).is_err());
    }
    let mut settings = author("collapse");
    settings["keys"]["values"][1]["easing"] = json!("whip");
    let model: Ember = serde_json::from_value(settings.clone()).unwrap();
    assert!(!model.valid(0, &span, 4000));
    settings["keys"]["values"][0]["factor"] = json!(0.8);
    let model: Ember = serde_json::from_value(settings).unwrap();
    assert!(model.valid(0, &span, 4000));
    let mut settings = author("breathe");
    settings["flaresTicks"] = json!(vec![[0, 12000]; 33]);
    let model: Ember = serde_json::from_value(settings).unwrap();
    assert!(!model.valid(0, &span, 4000));
}
#[test]
fn fonts_collect_whole_normalized_scalar_prefixes_and_all_resident_images() {
    let mut settings = author("breathe");
    settings["hud"]["title"] = json!("😀Ōō");
    let recipe = recipe(settings);
    let fonts = recipe.font_metric_requests(&resources()).unwrap();
    assert_eq!(fonts.len(), 1);
    assert!(fonts[0].glyphs.is_empty());
    let texts: Vec<_> = fonts[0].advances.iter().map(|a| a.text.as_str()).collect();
    for text in ["", "😀", "😀O", "😀Oo", "O"] {
        assert!(texts.contains(&text));
    }
    assert!(!texts.contains(&"Ō"));
    assert!(!texts.contains(&"ō"));
    // Both raster backends retain all declared images, even when this mode
    // does not sample one directly. Admission must measure that resident set.
    let resident = recipe.image_dimension_requests(&resources()).unwrap();
    assert_eq!(resident.len(), 1);
    assert_eq!(resident[0].resource.id, "fixture-image");
    let collapse = super::test_support::recipe(author("collapse"));
    assert!(
        collapse
            .font_metric_requests(&resources())
            .unwrap()
            .is_empty()
    );
    let requests = collapse.image_dimension_requests(&resources()).unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].resource.id, "fixture-image");
}
