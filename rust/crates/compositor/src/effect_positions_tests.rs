use super::{EffectPassPosition, PassLocation, visit_passes};
use crate::FrameDescriptor;
use serde_json::{Value, json};
use std::collections::HashSet;

fn pass() -> Value {
    // Position enumeration deliberately does not resolve or simulate the pass.
    json!({"shader":"canvas", "uniforms":{"identical":[0,0,0,0]}})
}
fn scene(groups: Value) -> Value {
    json!({"type":"sceneEffect","effectPassGroups":groups})
}
fn group(items: Vec<Value>, post: Value) -> Value {
    json!({"items":items,"effectPassGroups":post,"opacity":0,"blendMode":"normal"})
}
fn frame(progress: f64) -> FrameDescriptor {
    let p = pass();
    let child = scene(json!([[p.clone(), p.clone()]]));
    let mut isolated = group(vec![child], json!([[p.clone()]]));
    isolated["type"] = json!("group");
    let branch = group(vec![scene(json!([[p.clone()]]))], json!([[p.clone()]]));
    let layer = json!({"textureId":"fixture", "transform":{"centerX":8,"centerY":6,
        "width":16,"height":12,"rotationDegrees":0,"flipX":false,"flipY":false},
        "opacity":1,"blendMode":"normal","mask":null,"effectPassGroups":[[p]]});
    serde_json::from_value(json!({"width":16,"height":12,"clear":{"color":[0,0,0,0]},
        "items":[isolated,
            {"type":"sceneTransition","outgoing":branch.clone(),"incoming":branch,"progress":progress},
            {"type":"transition","outgoing":[layer.clone()],"incoming":[layer],"progress":progress}]})).unwrap()
}
fn positions(frame: &FrameDescriptor) -> Vec<EffectPassPosition> {
    let mut positions = Vec::new();
    visit_passes(frame, |position, _| positions.push(position));
    positions
}

#[test]
fn identical_passes_keep_distinct_nested_group_and_transition_positions() {
    let keys = positions(&frame(0.0));
    assert_eq!(keys.len(), 9);
    assert_eq!(keys.iter().collect::<HashSet<_>>().len(), 9);
    assert_eq!(
        keys[0].location,
        PassLocation::Nested(vec![0], Box::new(PassLocation::Scene(0)))
    );
    assert_eq!((keys[0].group, keys[0].pass_index), (0, 0));
    assert_eq!((keys[1].group, keys[1].pass_index), (0, 1));
    assert_eq!(keys[2].location, PassLocation::Group(vec![0]));
    assert_eq!(
        keys[3].location,
        PassLocation::SceneBranch(vec![1], 0, Box::new(PassLocation::Scene(0)))
    );
    assert_eq!(
        keys[4].location,
        PassLocation::SceneBranch(vec![1], 0, Box::new(PassLocation::Group(vec![])))
    );
    assert_eq!(
        keys[5].location,
        PassLocation::SceneBranch(vec![1], 1, Box::new(PassLocation::Scene(0)))
    );
    assert_eq!(keys[7].location, PassLocation::Outgoing(2, 0));
    assert_eq!(keys[8].location, PassLocation::Incoming(2, 0));
    assert_eq!(keys, positions(&frame(1.0)));
}

#[test]
fn frozen_frame_clone_retains_positions_and_group_changes_do_not_alias() {
    let mut frame = frame(0.5);
    let before = positions(&frame);
    assert_eq!(before, positions(&frame.clone()));
    let crate::FrameItemDescriptor::Group(group) = &mut frame.items[0] else {
        panic!()
    };
    let crate::FrameItemDescriptor::SceneEffect { effect_pass_groups } = &mut group.items[0] else {
        panic!()
    };
    let second = effect_pass_groups[0].pop().unwrap();
    effect_pass_groups.push(vec![second]);
    let after = positions(&frame);
    assert_eq!(before.len(), after.len());
    assert_ne!(before[1], after[1]);
    assert_eq!((after[1].group, after[1].pass_index), (1, 0));
    assert_eq!(before[2..], after[2..]);
}
