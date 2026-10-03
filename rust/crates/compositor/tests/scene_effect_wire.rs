use compositor::{FrameDescriptor, FrameItemDescriptor};

#[test]
fn scene_effect_accepts_the_browser_camel_case_contract() {
    let value = serde_json::json!({
        "width": 640, "height": 360, "clear": {"color": [0, 0, 0, 1]},
        "items": [{"type": "sceneEffect", "effectPassGroups": [[{
            "shader": "color-adjustment",
            "uniforms": {"exposure": 0, "contrast": 0, "saturation": -100, "temperature": 0, "tint": 0}
        }]]}]
    });
    let frame: FrameDescriptor = serde_json::from_value(value.clone()).unwrap();
    let FrameItemDescriptor::SceneEffect { effect_pass_groups } = &frame.items[0] else {
        panic!("not an effect");
    };
    assert_eq!(effect_pass_groups[0][0].shader, "color-adjustment");
    let roundtrip = serde_json::to_value(frame).unwrap();
    assert!(roundtrip["items"][0].get("effectPassGroups").is_some());
    assert!(roundtrip["items"][0].get("effect_pass_groups").is_none());
}

#[test]
fn scene_effect_does_not_silently_drop_a_missing_pass_group() {
    assert!(
        serde_json::from_value::<FrameItemDescriptor>(serde_json::json!({"type": "sceneEffect"}))
            .is_err()
    );
}
