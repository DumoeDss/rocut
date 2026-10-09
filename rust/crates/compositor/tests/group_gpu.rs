mod support;
use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, FrameDescriptor, FrameItemDescriptor,
    IsolatedGroupDescriptor, LayerDescriptor, QuadTransformDescriptor,
};
use support::{assert_pixel, context, read_pixel, texture};

fn layer(id: &str) -> FrameItemDescriptor {
    FrameItemDescriptor::Layer(LayerDescriptor {
        texture_id: id.into(),
        transform: QuadTransformDescriptor {
            center_x: 0.5,
            center_y: 0.5,
            width: 1.0,
            height: 1.0,
            rotation_degrees: 0.0,
            flip_x: false,
            flip_y: false,
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![],
        mask: None,
    })
}
fn group(items: Vec<FrameItemDescriptor>, opacity: f32) -> FrameItemDescriptor {
    FrameItemDescriptor::Group(IsolatedGroupDescriptor {
        items,
        opacity,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![],
    })
}
fn frame(items: Vec<FrameItemDescriptor>) -> FrameDescriptor {
    FrameDescriptor {
        width: 1,
        height: 1,
        clear: CanvasClearDescriptor { color: [0.0; 4] },
        items,
    }
}
fn gray() -> FrameItemDescriptor {
    serde_json::from_value(
        serde_json::json!({"type":"sceneEffect", "effectPassGroups":[[{
            "shader":"color-adjustment", "uniforms":{"exposure":0,"contrast":0,"saturation":-100,
                "temperature":0,"tint":0}
        }]]}),
    )
    .unwrap()
}

#[test]
#[ignore = "requires a native GPU"]
fn group_effects_and_child_blends_cannot_read_or_modify_the_parent() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut renderer = Compositor::new(&context);
    renderer.upsert_texture("red".into(), texture(&context, [255, 0, 0, 255]));
    renderer.upsert_texture("green".into(), texture(&context, [0, 255, 0, 255]));
    let mut multiply = layer("red");
    if let FrameItemDescriptor::Layer(layer) = &mut multiply {
        layer.blend_mode = BlendMode::Multiply;
    }
    for (items, expected) in [
        // An empty group's scene effect cannot turn the outside red picture gray.
        (
            vec![layer("red"), group(vec![gray()], 1.0)],
            [255, 0, 0, 255],
        ),
        // Multiplying against group transparency leaves red; against green would be black.
        (
            vec![layer("green"), group(vec![multiply], 1.0)],
            [255, 0, 0, 255],
        ),
        // A group effect cannot touch a subsequent sibling either.
        (
            vec![group(vec![layer("red"), gray()], 1.0), layer("green")],
            [0, 255, 0, 255],
        ),
    ] {
        let output = renderer
            .render_frame_to_texture(&context, &frame(items))
            .unwrap();
        assert_pixel(read_pixel(&context, &output), expected);
    }
}

#[test]
#[ignore = "requires a native GPU"]
fn group_opacity_is_once_after_children_and_nested_groups_replay_deterministically() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut renderer = Compositor::new(&context);
    for (id, rgba) in [
        ("red", [255, 0, 0, 255]),
        ("blue", [0, 0, 255, 255]),
        ("green", [0, 255, 0, 255]),
    ] {
        renderer.upsert_texture(id.into(), texture(&context, rgba));
    }
    let cases = [
        (
            vec![
                layer("green"),
                group(vec![layer("red"), layer("blue")], 0.5),
            ],
            [0, 127, 128, 255],
        ),
        (
            vec![
                layer("green"),
                group(vec![group(vec![layer("blue")], 0.5)], 0.5),
            ],
            [0, 191, 64, 255],
        ),
        (vec![group(vec![layer("blue")], 0.5)], [0, 0, 255, 128]),
        (
            vec![layer("green"), group(vec![layer("blue")], 0.0)],
            [0, 255, 0, 255],
        ),
    ];
    for index in [0, 1, 2, 3, 2, 0] {
        let (items, expected) = &cases[index];
        let output = renderer
            .render_frame_to_texture(&context, &frame(items.clone()))
            .unwrap();
        assert_pixel(read_pixel(&context, &output), *expected);
    }
}

#[test]
#[ignore = "requires a native GPU"]
fn group_post_runs_after_children_before_opacity_and_outer_blending() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut renderer = Compositor::new(&context);
    renderer.upsert_texture("red".into(), texture(&context, [255, 0, 0, 255]));
    renderer.upsert_texture("green".into(), texture(&context, [0, 255, 0, 255]));
    let FrameItemDescriptor::SceneEffect { effect_pass_groups } = gray() else {
        unreachable!()
    };
    let isolated = FrameItemDescriptor::Group(IsolatedGroupDescriptor {
        items: vec![layer("red")],
        effect_pass_groups,
        opacity: 0.5,
        blend_mode: BlendMode::Normal,
    });
    let output = renderer
        .render_frame_to_texture(&context, &frame(vec![layer("green"), isolated]))
        .unwrap();
    let pixel = read_pixel(&context, &output);
    // Group grayscale changes red before it blends against untouched green.
    assert!(pixel[0].abs_diff(pixel[2]) <= 1);
    assert!((i16::from(pixel[1]) - i16::from(pixel[0]) - 127).abs() <= 2);
    assert_eq!(pixel[3], 255);
}

#[test]
#[ignore = "requires a native GPU"]
fn missing_child_in_a_zero_opacity_group_is_not_skipped_and_next_frame_recovers() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut renderer = Compositor::new(&context);
    assert!(
        renderer
            .render_frame_to_texture(&context, &frame(vec![group(vec![layer("missing")], 0.0)]))
            .is_err()
    );
    renderer.upsert_texture("red".into(), texture(&context, [255, 0, 0, 128]));
    let output = renderer
        .render_frame_to_texture(&context, &frame(vec![group(vec![layer("red")], 1.0)]))
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [255, 0, 0, 128]);
}

#[test]
#[ignore = "requires a native GPU"]
fn nested_distinct_liquid_passes_consume_the_frozen_preparation_in_render_order() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut renderer = Compositor::new(&context);
    renderer.upsert_texture("red".into(), texture(&context, [255, 0, 0, 255]));
    renderer.upsert_texture("blue".into(), texture(&context, [0, 0, 255, 255]));
    let pass = |amount: f32| {
        let value: serde_json::Value =
            serde_json::from_str(&effects::resolve_stylized_effect_json(
                serde_json::json!({"effectType":"liquid", "params":{"amount":amount,
                "columns":8,"rows":8,"durationTicks":4000}, "localTime":4000,
                "frameRate":{"numerator":30,"denominator":1}})
                .to_string(),
            ))
            .unwrap();
        serde_json::from_value(value["passes"][0].clone()).unwrap()
    };
    let mut red = layer("red");
    if let FrameItemDescriptor::Layer(layer) = &mut red {
        layer.effect_pass_groups = vec![vec![pass(0.1)]];
    }
    let nested = FrameItemDescriptor::Group(IsolatedGroupDescriptor {
        items: vec![layer("blue")],
        opacity: 0.5,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![vec![pass(0.2)]],
    });
    let outer = FrameItemDescriptor::Group(IsolatedGroupDescriptor {
        items: vec![red, nested],
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![vec![pass(0.3)]],
    });
    let descriptor = frame(vec![
        outer,
        FrameItemDescriptor::SceneEffect {
            effect_pass_groups: vec![vec![pass(0.4)]],
        },
    ]);
    // Distinct pass signatures make a wrong DFS/FIFO order fail in the real GPU
    // consumer, even though this zero-velocity fixture has neutral optical output.
    for _ in 0..2 {
        let mut preparation = compositor::FramePreparation::new(descriptor.clone()).unwrap();
        while !preparation
            .advance(std::num::NonZeroU64::new(1).unwrap())
            .unwrap()
        {}
        let output = renderer
            .render_prepared_frame_to_texture(&context, preparation.finish().unwrap())
            .unwrap();
        assert_pixel(read_pixel(&context, &output), [127, 0, 128, 255]);
    }
}
