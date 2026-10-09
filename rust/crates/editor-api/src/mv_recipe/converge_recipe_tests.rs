use super::{Converge, tests::author};
use crate::mv_recipe::{Recipe, model::Span};
use serde_json::{Value, json};

fn recipe() -> Value {
    json!({"version":1,"root":"a","songStartSeconds":0,"outputRoles":["foreground"],
        "nodes":[{"id":"a","scene":{"kind":"converge","role":"foreground",
            "span":{"startFrame":0,"durationFrames":60},"settings":author()}}]})
}
fn errors(value: Value) -> Vec<crate::model::Issue> {
    serde_json::from_value::<Recipe>(value)
        .unwrap()
        .validate(&[], 60, 1920, 1080, 4000)
}

#[test]
fn all_catalog_fields_are_explicit_and_admit_the_full_single_scene() {
    let settings = author();
    assert!(errors(recipe()).is_empty());
    for key in settings.as_object().unwrap().keys() {
        let mut missing = settings.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<Converge>(missing).is_err(),
            "missing {key}"
        );
    }
    let mut extra = settings;
    extra["commands"] = json!([]);
    assert!(serde_json::from_value::<Converge>(extra).is_err());
}

#[test]
fn advertised_beat_unions_and_all_nested_palette_fields_are_enforced() {
    let parameters = super::catalog_entry()["parameters"].clone();
    let span = Span {
        start_frame: 0,
        duration_frames: 60,
    };
    for variant in parameters["beats"]["variants"].as_array().unwrap() {
        let mut settings = author();
        settings["beats"] = variant["suggested"].clone();
        let model: Converge = serde_json::from_value(settings.clone()).unwrap();
        assert!(model.valid(0, &span, 4000));
        assert_eq!(model.uses_audio(), settings["beats"]["kind"] == "analysis");
        settings["beats"]["unknown"] = json!(true);
        assert!(serde_json::from_value::<Converge>(settings).is_err());
    }
    for parent in ["/palette", "/palette/shard", "/palette/firefly"] {
        let base = author();
        for key in base.pointer(parent).unwrap().as_object().unwrap().keys() {
            let mut missing = base.clone();
            missing
                .pointer_mut(parent)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(
                serde_json::from_value::<Converge>(missing).is_err(),
                "{parent}/{key}"
            );
        }
    }
    for palette in [
        "shadow",
        "dusk",
        "verm",
        "sunset",
        "glow",
        "hi",
        "core",
        "white",
        "shard/body",
        "shard/rim",
        "shard/edge",
        "firefly/body",
        "firefly/core",
        "firefly/edge",
        "background/0",
        "background/1",
        "background/2",
    ] {
        for channel in 0..4 {
            for bad in [-0.01, 1.01] {
                let mut settings = author();
                *settings
                    .pointer_mut(&format!("/palette/{palette}/{channel}"))
                    .unwrap() = json!(bad);
                let model: Converge = serde_json::from_value(settings).unwrap();
                assert!(!model.valid(0, &span, 4000), "{palette}/{channel}={bad}");
            }
        }
    }
}

#[test]
fn white_cue_may_exceed_span_but_cannot_equal_or_precede_absolute_shot_start() {
    let mut settings = author();
    let span = Span {
        start_frame: 30,
        duration_frames: 30,
    };
    for (white, valid) in [
        (0, false),
        (180000, false),
        (180001, true),
        (360000, true),
        (super::MAX_SAFE_TICKS, true),
        (super::MAX_SAFE_TICKS + 1, false),
    ] {
        settings["whiteAtTicks"] = json!(white);
        let model: Converge = serde_json::from_value(settings.clone()).unwrap();
        assert_eq!(model.valid(60000, &span, 4000), valid, "cue {white}");
    }
}

#[test]
fn repeated_converge_branches_are_charged_and_rejected_without_raising_global_limits() {
    let mut value = recipe();
    value["root"] = json!("mix");
    value["nodes"].as_array_mut().unwrap().push(json!({"id":"mix","scene":{"kind":"transition",
        "from":"a","to":"a","span":{"startFrame":0,"durationFrames":60},"easing":"linear","style":{"kind":"xfade"}}}));
    let issues = errors(value);
    assert_eq!(issues.len(), 1);
    assert!(
        issues[0]
            .message
            .contains("4096 expanded generator primitives")
    );
}

#[test]
fn reject_palette_cue_beat_and_analysis_authoring_errors_before_frame_resolution() {
    for (path, value) in [
        ("/palette/background/0/3", json!(-0.01)),
        ("/palette/shard/body/0", json!(1.01)),
        ("/grain", json!(1.01)),
        ("/whiteAtTicks", json!(0)),
        ("/beats/songTicks", json!([0, 0])),
        ("/beats/songTicks", json!([5, 2])),
        ("/beats/songTicks", json!(vec![1; 4097])),
    ] {
        let mut r = recipe();
        *r["nodes"][0]["scene"]["settings"]
            .pointer_mut(path)
            .unwrap() = value;
        assert!(!errors(r).is_empty(), "accepted {path}");
    }
    let mut r = recipe();
    r["nodes"][0]["scene"]["settings"]["beats"] = json!({"kind":"analysis"});
    assert!(errors(r)[0].message.contains("reviewed analysis binding"));
}
