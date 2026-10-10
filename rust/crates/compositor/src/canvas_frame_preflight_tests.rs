use crate::{EffectPassDescriptor, FrameDescriptor, FrameItemDescriptor, FramePreparation};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn pass() -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let definition = catalog.iter().find(|d| d["id"] == "canvas").unwrap();
    let parameters: BTreeMap<_, _> = definition["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["required"] == true)
        .map(|f| (f["key"].as_str().unwrap(), f["default"].as_f64().unwrap()))
        .collect();
    let resolved: Value = serde_json::from_str(&effects::resolve_stylized_effect_json(
        json!({"effectType":"canvas", "params":parameters, "localTime":4000,
            "frameRate":{"numerator":30,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    resolved["passes"][0].clone()
}
fn frame(items: Vec<Value>) -> FrameDescriptor {
    serde_json::from_value(json!({"width":16,"height":12,
        "clear":{"color":[0,0,0,0]},"items":items}))
    .unwrap()
}
fn scene(pass: Value) -> Value {
    json!({"type":"sceneEffect","effectPassGroups":[[pass]]})
}

#[test]
fn late_inactive_canvas_is_admitted_before_any_frame_replay() {
    let valid = pass();
    let mut invalid = valid.clone();
    invalid["uniforms"]["version"] = json!(1);
    let branch = |p| {
        json!({"items":[scene(p)], "effectPassGroups":[],
        "opacity":0,"blendMode":"normal"})
    };
    let mut transition = json!({"type":"sceneTransition", "outgoing":branch(valid.clone()),
        "incoming":branch(invalid),"progress":0});
    for progress in [0, 1] {
        transition["progress"] = json!(progress);
        assert!(
            FramePreparation::new(frame(vec![scene(valid.clone()), transition.clone()])).is_err()
        );
    }
    let prepared = FramePreparation::new(frame(vec![scene(valid)]))
        .unwrap()
        .complete()
        .unwrap();
    assert_eq!(prepared.dimensions(), (16, 12));
    assert!(prepared.liquid.is_empty());
    // CPU-only readiness is not permission to skip the remaining GPU capture.
}

#[test]
fn canvas_frame_preflight_uses_full_schedule_dimensions_and_budget() {
    let active: EffectPassDescriptor = serde_json::from_value(pass()).unwrap();
    let mut good = frame(vec![]);
    good.items.push(FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![vec![active]],
    });
    assert!(FramePreparation::new(good.clone()).is_ok());
    for (width, height) in [(0, 12), (16385, 1), (16384, 16384)] {
        let mut invalid = good.clone();
        invalid.width = width;
        invalid.height = height;
        assert!(FramePreparation::new(invalid).is_err());
    }
}

#[test]
fn raw_canvas_transport_is_bounded_before_mapping_and_all_passes_are_validated() {
    let valid = pass();
    let mut malformed = valid.clone();
    malformed["uniforms"]["version"] = json!(vec![0; 4096]);
    assert!(FramePreparation::new(frame(vec![scene(malformed)])).is_err());
    let unknown = json!({"shader":"not-a-render-shader","uniforms":{}});
    let invisible = json!({"type":"group","opacity":0,"blendMode":"normal",
        "items":[scene(unknown)],"effectPassGroups":[]});
    assert!(FramePreparation::new(frame(vec![scene(valid.clone()), invisible])).is_err());
    let empty_group = json!({"type":"sceneEffect","effectPassGroups":[[]]});
    assert!(FramePreparation::new(frame(vec![scene(valid), empty_group])).is_err());
}

#[test]
fn identical_canvas_occurrences_all_count_towards_frame_capture_admission() {
    let active = pass();
    let mut single = frame(vec![scene(active.clone())]);
    single.width = 1024;
    single.height = 1024;
    assert!(FramePreparation::new(single.clone()).is_ok());
    single.items = vec![single.items[0].clone(); 16];
    assert!(FramePreparation::new(single).is_err());
    let many = frame(vec![scene(active); 65]);
    assert!(FramePreparation::new(many).is_err());
}
