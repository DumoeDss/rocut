use super::*;
use crate::{
    BlendMode, CanvasClearDescriptor, EffectPassDescriptor, IsolatedGroupDescriptor,
    LayerMaskDescriptor, QuadTransformDescriptor,
};
fn layer() -> LayerDescriptor {
    LayerDescriptor {
        texture_id: "source".into(),
        transform: QuadTransformDescriptor {
            center_x: 8.0,
            center_y: 8.0,
            width: 16.0,
            height: 16.0,
            rotation_degrees: 0.0,
            flip_x: false,
            flip_y: false,
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![],
        mask: None,
    }
}
fn frame(items: Vec<FrameItemDescriptor>) -> FrameDescriptor {
    let mut all = vec![FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![vec![EffectPassDescriptor {
            shader: "canvas".into(),
            uniforms: Default::default(),
        }]],
    }];
    all.extend(items);
    FrameDescriptor {
        width: 16,
        height: 16,
        clear: CanvasClearDescriptor { color: [0.0; 4] },
        items: all,
    }
}
#[test]
fn late_inactive_texture_and_mask_reject() {
    let mut l = layer();
    l.texture_id = "missing".into();
    let group = IsolatedGroupDescriptor {
        items: vec![FrameItemDescriptor::Layer(l)],
        effect_pass_groups: vec![],
        opacity: 0.0,
        blend_mode: BlendMode::Normal,
    };
    assert!(
        validate(
            &frame(vec![FrameItemDescriptor::Group(group)]),
            &mut |id| id == "source"
        )
        .is_err()
    );
    let mut l = layer();
    l.mask = Some(LayerMaskDescriptor {
        texture_id: "missing-mask".into(),
        feather: 0.0,
        inverted: false,
    });
    assert!(
        validate(
            &frame(vec![FrameItemDescriptor::Transition {
                outgoing: vec![],
                incoming: vec![l],
                progress: 0.0,
                style: None,
            }]),
            &mut |id| id == "source"
        )
        .is_err()
    );
}
#[test]
fn bad_metadata_and_progress_reject() {
    for v in [f32::NAN, f32::INFINITY, -0.1, 1.1] {
        assert!(
            validate(
                &frame(vec![FrameItemDescriptor::Transition {
                    outgoing: vec![],
                    incoming: vec![],
                    progress: v,
                    style: None,
                }]),
                &mut |_| true
            )
            .is_err()
        );
    }
    let mut l = layer();
    l.transform.rotation_degrees = f32::NAN;
    assert!(validate(&frame(vec![FrameItemDescriptor::Layer(l)]), &mut |_| true).is_err());
    let mut l = layer();
    l.mask = Some(LayerMaskDescriptor {
        texture_id: "mask".into(),
        feather: f32::NAN,
        inverted: false,
    });
    assert!(validate(&frame(vec![FrameItemDescriptor::Layer(l)]), &mut |_| true).is_err());
    let mut f = frame(vec![]);
    f.clear.color[0] = f32::NAN;
    assert!(validate(&f, &mut |_| true).is_err());
}
#[test]
fn valid_and_noncanvas_legacy_policy() {
    let f = frame(vec![FrameItemDescriptor::Layer(layer())]);
    let mut seen = vec![];
    validate(&f, &mut |id| {
        seen.push(id.to_owned());
        true
    })
    .unwrap();
    assert_eq!(seen, vec!["source"]);
    let mut f = f;
    f.items.remove(0);
    f.clear.color[0] = f32::NAN;
    validate(&f, &mut |_| panic!("ordinary frame must not lookup")).unwrap();
}

#[test]
fn peel_without_canvas_admits_both_endpoint_branches_and_masks_before_gpu() {
    let style: crate::NativeTransitionStyle = serde_json::from_value(serde_json::json!({
        "kind":"peel", "direction":"left", "curl":0.17,"segments":32,"shading":0.6,"perspective":0.5
    }))
    .unwrap();
    for progress in [0.0, 0.5, 1.0] {
        let mut incoming = layer();
        incoming.texture_id = "incoming".into();
        incoming.mask = Some(LayerMaskDescriptor {
            texture_id: "incoming-mask".into(),
            feather: 0.0,
            inverted: false,
        });
        let mut f = frame(vec![FrameItemDescriptor::Transition {
            outgoing: vec![layer()],
            incoming: vec![incoming],
            progress,
            style: Some(style.clone()),
        }]);
        f.items.remove(0); // No Canvas pass to trigger the historical preflight.
        assert!(matches!(
            validate(&f, &mut |id| id != "incoming-mask"),
            Err(CompositorError::MissingTexture { .. })
        ));
        let mut seen = vec![];
        validate(&f, &mut |id| {
            seen.push(id.to_owned());
            true
        })
        .unwrap();
        assert_eq!(seen, ["source", "incoming", "incoming-mask"]);
    }
}
