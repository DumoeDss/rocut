use compositor::{FrameDescriptor, FrameItemDescriptor, FramePreparation};
use serde_json::{Value, json};

fn group(items: Vec<Value>) -> Value {
    json!({"type":"group", "items":items, "effectPassGroups":[], "opacity":1.0,
        "blendMode":"normal"})
}
fn frame(items: Vec<Value>, size: [u32; 2]) -> FrameDescriptor {
    serde_json::from_value(json!({"width":size[0],"height":size[1],
        "clear":{"color":[0,0,0,1]},"items":items}))
    .unwrap()
}
fn layer() -> Value {
    json!({"type":"layer", "textureId":"image", "opacity":1.0, "blendMode":"normal",
        "effectPassGroups":[], "mask":null, "transform":{"centerX":1.0,"centerY":1.0,
        "width":2.0,"height":2.0,"rotationDegrees":0.0,"flipX":false,"flipY":false}})
}

#[test]
fn group_wire_preserves_nested_items_effects_and_once_only_opacity() {
    let mut value = group(vec![layer(), group(vec![layer()])]);
    value["opacity"] = json!(0.25);
    value["blendMode"] = json!("multiply");
    let item: FrameItemDescriptor = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(item).unwrap(), value);
    assert!(
        FramePreparation::new(frame(vec![value], [2, 2]))
            .unwrap()
            .complete()
            .is_ok()
    );
}

#[test]
fn incomplete_or_ambiguous_group_wire_fails_closed() {
    for field in ["items", "opacity", "blendMode", "effectPassGroups"] {
        let mut value = group(vec![]);
        value.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<FrameItemDescriptor>(value).is_err());
    }
    let mut value = group(vec![]);
    value["passthrough"] = json!(true);
    assert!(serde_json::from_value::<FrameItemDescriptor>(value).is_err());
}

#[test]
fn group_opacity_limits_apply_even_when_children_are_empty() {
    for opacity in [-0.1, 1.1, f32::NAN, f32::INFINITY] {
        let mut value = frame(vec![group(vec![])], [2, 2]);
        let FrameItemDescriptor::Group(group) = &mut value.items[0] else {
            unreachable!()
        };
        group.opacity = opacity;
        assert!(FramePreparation::new(value).is_err());
    }
    for opacity in [0, 1] {
        let mut value = group(vec![]);
        value["opacity"] = json!(opacity);
        assert!(FramePreparation::new(frame(vec![value], [2, 2])).is_ok());
    }
}

#[test]
fn depth_count_and_expanded_items_cannot_hide_under_transparent_groups() {
    let mut value = layer();
    for _ in 0..8 {
        value = group(vec![value]);
    }
    assert!(FramePreparation::new(frame(vec![value.clone()], [2, 2])).is_ok());
    assert!(FramePreparation::new(frame(vec![group(vec![value])], [2, 2])).is_err());
    assert!(FramePreparation::new(frame(vec![group(vec![]); 64], [2, 2])).is_ok());
    assert!(FramePreparation::new(frame(vec![group(vec![]); 65], [2, 2])).is_err());
    let mut value = group(vec![layer(); 4096]);
    value["opacity"] = json!(0);
    assert!(FramePreparation::new(frame(vec![value], [2, 2])).is_err());
}

#[test]
fn group_target_budget_is_aggregate_and_does_not_change_ordinary_admission() {
    assert!(FramePreparation::new(frame(vec![group(vec![])], [4096, 4096])).is_ok());
    // Root clear + 3 groups * 2 full-size targets is over the 256MiB budget.
    assert!(FramePreparation::new(frame(vec![group(vec![]); 3], [4096, 4096])).is_err());
    assert!(FramePreparation::new(frame(vec![group(vec![])], [8193, 1])).is_err());
    assert!(FramePreparation::new(frame(vec![layer()], [8193, 1])).is_ok());
}

#[test]
fn descendant_masks_and_both_transition_branches_share_the_target_budget() {
    let mut masked = layer();
    masked["mask"] = json!({"textureId":"mask", "feather":1.0,"inverted":false});
    assert!(
        FramePreparation::new(frame(vec![group(vec![masked.clone(); 7])], [1024, 1024])).is_ok()
    );
    assert!(FramePreparation::new(frame(vec![group(vec![masked; 8])], [1024, 1024])).is_err());
    let mut leaf = layer();
    leaf.as_object_mut().unwrap().remove("type");
    let transition = |incoming| {
        json!({"type":"transition", "outgoing":vec![leaf.clone(); 16],
        "incoming":incoming,"progress":0.5})
    };
    assert!(
        FramePreparation::new(frame(vec![group(vec![transition(vec![])])], [1024, 1024])).is_ok()
    );
    let mut hidden = group(vec![transition(vec![leaf.clone(); 16])]);
    hidden["opacity"] = json!(0);
    assert!(FramePreparation::new(frame(vec![hidden], [1024, 1024])).is_err());
}

#[test]
fn non_liquid_post_cannot_hide_targets_or_transport_in_small_canvases() {
    let pass = json!({"shader":"color-adjustment", "uniforms":{"exposure":0.0,
        "contrast":0.0,"saturation":0.0,"temperature":0.0,"tint":0.0}});
    let scene =
        |count| json!({"type":"sceneEffect", "effectPassGroups":[vec![pass.clone();count]]});
    // Include a root sibling: adding a group cannot exempt the rest of its request.
    assert!(FramePreparation::new(frame(vec![group(vec![]), scene(60)], [1024, 1024])).is_ok());
    assert!(FramePreparation::new(frame(vec![group(vec![]), scene(61)], [1024, 1024])).is_err());
    assert!(FramePreparation::new(frame(vec![group(vec![scene(4097)])], [1, 1])).is_err());
    let mut wide = group(vec![]);
    wide["effectPassGroups"] = json!(vec![Vec::<Value>::new(); 4097]);
    assert!(FramePreparation::new(frame(vec![wide], [1, 1])).is_err());
    let mut huge = layer();
    huge["textureId"] = json!("x".repeat(8 * 1024 * 1024));
    assert!(FramePreparation::new(frame(vec![group(vec![huge])], [1, 1])).is_err());
}
