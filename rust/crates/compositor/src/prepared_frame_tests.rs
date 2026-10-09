use std::num::NonZeroU64;

use serde_json::json;

use crate::prepared_frame::{FramePreparation, PassLocation};
use crate::{EffectPassDescriptor, FrameDescriptor, FrameItemDescriptor};

fn pass() -> EffectPassDescriptor {
    let resolved: serde_json::Value = serde_json::from_str(&effects::resolve_stylized_effect_json(
        json!({
            "effectType":"liquid", "params":{"columns":8,"rows":8,"durationTicks":4000},
            "localTime":4000,"frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    serde_json::from_value(resolved["passes"][0].clone()).unwrap()
}

fn frame() -> FrameDescriptor {
    let pass = serde_json::to_value(pass()).unwrap();
    let layer = json!({"textureId":"fixture", "transform":{"centerX":32,"centerY":24,
        "width":64,"height":48,"rotationDegrees":0,"flipX":false,"flipY":false},
        "opacity":1,"blendMode":"normal","effectPassGroups":[[pass.clone()]],"mask":null});
    let mut first = layer.clone();
    first["type"] = json!("layer");
    serde_json::from_value(json!({"width":64,"height":48,"clear":{"color":[0,0,0,1]},
        "items":[first,{"type":"transition","outgoing":[layer.clone()],"incoming":[layer],"progress":0.5},
            {"type":"sceneEffect","effectPassGroups":[[pass]]}]})).unwrap()
}

#[test]
fn liquid_frame_paths_and_shared_step_quota_cover_entire_graph() {
    let mut preparation = FramePreparation::new(frame()).unwrap();
    assert_eq!(
        preparation
            .specs
            .iter()
            .map(|spec| spec.location.clone())
            .collect::<Vec<_>>(),
        vec![
            PassLocation::Layer(0),
            PassLocation::Outgoing(1, 0),
            PassLocation::Incoming(1, 0),
            PassLocation::Scene(2)
        ]
    );
    for _ in 0..15 {
        assert!(!preparation.advance(NonZeroU64::new(1).unwrap()).unwrap());
    }
    assert!(preparation.advance(NonZeroU64::new(1).unwrap()).unwrap());
    let prepared = preparation.finish().unwrap();
    assert_eq!(prepared.liquid.len(), 4);
    assert_eq!(prepared.dimensions(), (64, 48));
}

#[test]
fn every_pass_is_admitted_before_any_cpu_replay() {
    let mut frame = frame();
    if let FrameItemDescriptor::SceneEffect { effect_pass_groups } = &mut frame.items[2] {
        effect_pass_groups[0][0].uniforms.clear();
    }
    assert!(FramePreparation::new(frame).is_err());
}

#[test]
fn aggregate_memory_limit_rejects_individually_valid_passes() {
    let mut frame = frame();
    let pass = pass();
    frame.items = vec![FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![vec![pass; 300]],
    }];
    assert!(FramePreparation::new(frame).is_err());
}

#[test]
fn ordinary_frame_finishes_without_replay_or_tasks() {
    let mut frame = frame();
    frame.items.clear();
    let mut preparation = FramePreparation::new(frame).unwrap();
    assert!(preparation.advance(NonZeroU64::new(1).unwrap()).unwrap());
    assert!(preparation.finish().unwrap().liquid.is_empty());
}

#[test]
fn dropping_or_finishing_partial_request_cannot_expose_prepared_prefix() {
    let mut preparation = FramePreparation::new(frame()).unwrap();
    assert!(!preparation.advance(NonZeroU64::new(4).unwrap()).unwrap());
    assert_eq!(preparation.prepared.len(), 1);
    assert!(preparation.finish().is_err());
    let fresh = FramePreparation::new(frame()).unwrap().complete().unwrap();
    assert_eq!(fresh.liquid.len(), 4);
}

#[test]
fn groups_and_non_liquid_passes_do_not_shift_prepared_identity() {
    let mut frame = frame();
    let mut first = pass();
    let mut second = first.clone();
    first.uniforms.insert(
        "amount".into(),
        crate::frame::EffectUniformValueDescriptor::Number(0.2),
    );
    second.uniforms.insert(
        "amount".into(),
        crate::frame::EffectUniformValueDescriptor::Number(0.8),
    );
    let other = EffectPassDescriptor {
        shader: "unrelated".into(),
        uniforms: Default::default(),
    };
    frame.items = vec![FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![
            vec![other.clone()],
            vec![first.clone(), other, second.clone()],
        ],
    }];
    let preparation = FramePreparation::new(frame).unwrap();
    assert_eq!(
        preparation
            .specs
            .iter()
            .map(|spec| (spec.group, spec.pass_index))
            .collect::<Vec<_>>(),
        vec![(1, 0), (1, 2)]
    );
    let prepared = preparation.complete().unwrap();
    let first = crate::compositor::map_effect_passes(&[first]).remove(0);
    let second = crate::compositor::map_effect_passes(&[second]).remove(0);
    assert!(prepared.liquid[0].matches(&first, [64, 48]));
    assert!(!prepared.liquid[0].matches(&second, [64, 48]));
    assert!(prepared.liquid[1].matches(&second, [64, 48]));
}

#[test]
fn isolated_groups_prepare_children_then_group_post_without_skipping_zero_opacity() {
    let children = frame().items;
    let group = crate::IsolatedGroupDescriptor {
        items: children,
        opacity: 0.0,
        blend_mode: crate::BlendMode::Normal,
        effect_pass_groups: vec![vec![pass()]],
    };
    let mut frame = frame();
    frame.items = vec![FrameItemDescriptor::Group(group)];
    let preparation = FramePreparation::new(frame).unwrap();
    assert_eq!(
        preparation
            .specs
            .iter()
            .map(|spec| spec.location.clone())
            .collect::<Vec<_>>(),
        vec![
            PassLocation::Nested(vec![0], Box::new(PassLocation::Layer(0))),
            PassLocation::Nested(vec![0], Box::new(PassLocation::Outgoing(1, 0))),
            PassLocation::Nested(vec![0], Box::new(PassLocation::Incoming(1, 0))),
            PassLocation::Nested(vec![0], Box::new(PassLocation::Scene(2))),
            PassLocation::Group(vec![0]),
        ]
    );
    assert_eq!(preparation.complete().unwrap().liquid.len(), 5);
}

#[test]
fn invalid_nested_liquid_is_rejected_before_replay_even_in_an_invisible_group() {
    let mut invalid = pass();
    invalid.uniforms.clear();
    let group = crate::IsolatedGroupDescriptor {
        items: vec![FrameItemDescriptor::SceneEffect {
            effect_pass_groups: vec![vec![invalid]],
        }],
        opacity: 0.0,
        blend_mode: crate::BlendMode::Normal,
        effect_pass_groups: vec![],
    };
    let mut frame = frame();
    frame.items = vec![FrameItemDescriptor::Group(group)];
    assert!(FramePreparation::new(frame).is_err());
}
