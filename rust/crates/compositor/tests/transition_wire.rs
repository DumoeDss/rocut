use compositor::FrameItemDescriptor;

fn layer() -> serde_json::Value {
    serde_json::json!({
        "textureId": "clip", "opacity": 1.0, "blendMode": "normal", "mask": null,
        "effectPassGroups": [], "transform": {
            "centerX": 1.0, "centerY": 1.0, "width": 2.0, "height": 2.0,
            "rotationDegrees": 0.0, "flipX": false, "flipY": false
        }
    })
}
#[test]
fn transition_branches_preserve_browser_layer_fields() {
    let value = serde_json::json!({"type": "transition", "outgoing": [layer()], "incoming": [layer()], "progress": 0.5});
    let item: FrameItemDescriptor = serde_json::from_value(value.clone()).unwrap();
    let FrameItemDescriptor::Transition {
        outgoing,
        incoming,
        progress,
    } = &item
    else {
        panic!("not a transition")
    };
    assert_eq!(outgoing[0].texture_id, "clip");
    assert_eq!(incoming[0].transform.width, 2.0);
    assert_eq!(*progress, 0.5);
    assert_eq!(serde_json::to_value(item).unwrap(), value);
}
#[test]
fn malformed_transition_descriptors_are_not_silently_discarded() {
    for missing in ["outgoing", "incoming", "progress"] {
        let mut value = serde_json::json!({"type": "transition", "outgoing": [layer()], "incoming": [layer()], "progress": 0.5});
        value.as_object_mut().unwrap().remove(missing);
        assert!(serde_json::from_value::<FrameItemDescriptor>(value).is_err());
    }
    for invalid in [
        serde_json::json!(null),
        serde_json::json!("0.5"),
        serde_json::json!({}),
    ] {
        let value = serde_json::json!({"type": "transition", "outgoing": [layer()], "incoming": [layer()], "progress": invalid});
        assert!(serde_json::from_value::<FrameItemDescriptor>(value).is_err());
    }
}
