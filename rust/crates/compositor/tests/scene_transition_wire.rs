use compositor::{FrameDescriptor, FramePreparation};
use serde_json::{Value, json};

fn group(items: Vec<Value>) -> Value {
    json!({"items":items,"effectPassGroups":[],"opacity":1,"blendMode":"normal"})
}
fn transition(items: Vec<Value>) -> Value {
    json!({"type":"sceneTransition","outgoing":group(items),"incoming":group(vec![]),"progress":0.5})
}
fn frame(items: Vec<Value>, size: u32) -> FrameDescriptor {
    serde_json::from_value(
        json!({"width":size,"height":size,"clear":{"color":[0,0,0,0]},"items":items}),
    )
    .unwrap()
}
fn admission(item: Value) -> bool {
    FramePreparation::new(frame(vec![item], 1)).is_ok()
}

#[test]
fn strict_scene_picture_wire_does_not_replace_legacy_layer_lists() {
    let original = frame(vec![transition(vec![])], 1);
    let encoded = serde_json::to_value(&original).unwrap();
    assert_eq!(encoded["items"][0]["type"], "sceneTransition");
    assert!(encoded["items"][0]["outgoing"].get("type").is_none());
    assert!(FramePreparation::new(original).is_ok());
    for path in ["progress", "outgoing", "incoming"] {
        let mut item = transition(vec![]);
        item.as_object_mut().unwrap().remove(path);
        assert!(serde_json::from_value::<compositor::FrameItemDescriptor>(item).is_err());
    }
    for field in ["unexpected", "type"] {
        let mut item = transition(vec![]);
        item["outgoing"][field] = json!("group");
        assert!(serde_json::from_value::<compositor::FrameItemDescriptor>(item).is_err());
    }
    let legacy = json!({"type":"transition","outgoing":[],"incoming":[],"progress":0.5});
    assert!(admission(legacy));
}

#[test]
fn transition_branches_share_group_depth_count_and_expanded_item_limits() {
    let mut nested = transition(vec![]);
    for _ in 1..8 {
        nested = transition(vec![nested]);
    }
    assert!(admission(nested.clone()));
    assert!(!admission(transition(vec![nested])));
    assert!(FramePreparation::new(frame(vec![transition(vec![]); 32], 1)).is_ok());
    assert!(FramePreparation::new(frame(vec![transition(vec![]); 33], 1)).is_err());
    let child = json!({"type":"sceneEffect","effectPassGroups":[]});
    assert!(admission(transition(vec![child.clone(); 4093])));
    assert!(!admission(transition(vec![child; 4094])));
}

#[test]
fn inactive_endpoint_branches_and_root_siblings_still_reserve_resources() {
    for progress in [0.0, 1.0] {
        let mut item = transition(vec![]);
        item["progress"] = json!(progress);
        item["incoming"]["opacity"] = json!(-0.1);
        assert!(!admission(item));
    }
    for progress in [-0.1, 1.1] {
        let mut item = transition(vec![]);
        item["progress"] = json!(progress);
        assert!(!admission(item));
    }
    // Root clear + two branch clears/blends + picture crossfade = six targets.
    assert!(FramePreparation::new(frame(vec![transition(vec![])], 2048)).is_ok());
    assert!(FramePreparation::new(frame(vec![transition(vec![])], 4096)).is_err());
    let effect = json!({"type":"sceneEffect","effectPassGroups":[]});
    let mut siblings = vec![transition(vec![])];
    siblings.extend(vec![effect; 11]);
    assert!(FramePreparation::new(frame(siblings, 2048)).is_err());
}

#[test]
fn nested_effect_totals_and_transport_are_charged_without_a_root_group() {
    let mut item = transition(vec![]);
    item["outgoing"]["effectPassGroups"] = json!(vec![Vec::<Value>::new(); 4096]);
    assert!(admission(item.clone()));
    item["incoming"]["effectPassGroups"] = json!([[]]);
    assert!(!admission(item));
    let mut item = transition(vec![]);
    item["incoming"]["effectPassGroups"] = json!([[{
        "shader":"unused", "uniforms":{"large":vec![0.0; 2_097_152]}
    }]]);
    assert!(!admission(item));
}
