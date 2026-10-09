mod support;
use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, FrameDescriptor, FrameItemDescriptor,
    IsolatedGroupDescriptor, LayerDescriptor, QuadTransformDescriptor, SceneTransitionDescriptor,
};
use support::{assert_pixel, context, read_pixel, texture};

fn layer(id: &str) -> FrameItemDescriptor {
    FrameItemDescriptor::Layer(LayerDescriptor {
        texture_id: id.into(),
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![],
        mask: None,
        transform: QuadTransformDescriptor {
            center_x: 0.5,
            center_y: 0.5,
            width: 1.0,
            height: 1.0,
            rotation_degrees: 0.0,
            flip_x: false,
            flip_y: false,
        },
    })
}
fn group(items: Vec<FrameItemDescriptor>, opacity: f32) -> IsolatedGroupDescriptor {
    IsolatedGroupDescriptor {
        items,
        opacity,
        blend_mode: BlendMode::Normal,
        effect_pass_groups: vec![],
    }
}
fn transition(
    outgoing: IsolatedGroupDescriptor,
    incoming: IsolatedGroupDescriptor,
    progress: f32,
) -> FrameItemDescriptor {
    FrameItemDescriptor::SceneTransition(Box::new(SceneTransitionDescriptor {
        outgoing,
        incoming,
        progress,
    }))
}
fn frame(items: Vec<FrameItemDescriptor>) -> FrameDescriptor {
    FrameDescriptor {
        width: 1,
        height: 1,
        clear: CanvasClearDescriptor { color: [0.0; 4] },
        items,
    }
}
fn populated(context: &gpu::GpuContext) -> Compositor {
    let mut compositor = Compositor::new(context);
    for (id, rgba) in [
        ("red", [255, 0, 0, 255]),
        ("green", [0, 255, 0, 255]),
        ("blue", [0, 0, 255, 255]),
    ] {
        compositor.upsert_texture(id.into(), texture(context, rgba));
    }
    compositor
}

#[test]
#[ignore = "requires a native GPU"]
fn whole_scene_pictures_use_once_opacity_and_the_same_backdrop() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = populated(&context);
    for (progress, expected) in [
        (0.0, [0, 127, 128, 255]),
        (1.0, [64, 191, 0, 255]),
        (0.5, [32, 159, 64, 255]),
        (0.0, [0, 127, 128, 255]),
    ] {
        let descriptor = frame(vec![
            layer("green"),
            transition(
                group(vec![layer("red"), layer("blue")], 0.5),
                group(vec![layer("red")], 0.25),
                progress,
            ),
        ]);
        let result = compositor
            .render_frame_to_texture(&context, &descriptor)
            .unwrap();
        assert_pixel(read_pixel(&context, &result), expected);
    }
    let mut from = group(vec![layer("red")], 0.5);
    from.blend_mode = BlendMode::Multiply;
    let mut to = group(vec![layer("blue")], 0.5);
    to.blend_mode = BlendMode::Screen;
    let result = compositor
        .render_frame_to_texture(
            &context,
            &frame(vec![layer("green"), transition(from, to, 0.5)]),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &result), [0, 191, 64, 255]);
}

#[test]
#[ignore = "requires a native GPU"]
fn transparent_and_nested_scenes_crossfade_premultiplied_contributions() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = populated(&context);
    let cases = [
        (
            transition(
                group(vec![layer("red")], 1.0),
                group(vec![layer("blue")], 0.5),
                0.5,
            ),
            [170, 0, 85, 191],
        ),
        (
            transition(
                group(
                    vec![transition(
                        group(vec![layer("red")], 1.0),
                        group(vec![layer("blue")], 1.0),
                        0.5,
                    )],
                    0.5,
                ),
                group(vec![layer("green")], 1.0),
                0.25,
            ),
            [77, 102, 77, 159],
        ),
    ];
    for index in [0, 1, 0, 1] {
        let (item, expected) = &cases[index];
        let result = compositor
            .render_frame_to_texture(&context, &frame(vec![item.clone()]))
            .unwrap();
        assert_pixel(read_pixel(&context, &result), *expected);
    }
}

#[test]
#[ignore = "requires a native GPU"]
fn scene_branch_effects_are_isolated_and_endpoint_failures_recover() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = populated(&context);
    let effect: FrameItemDescriptor = serde_json::from_value(serde_json::json!({"type":"sceneEffect","effectPassGroups":[[{
        "shader":"color-adjustment","uniforms":{"exposure":0,"contrast":0,"saturation":-100,"temperature":0,"tint":0}
    }]]})).unwrap();
    for progress in [0.0, 0.5, 1.0] {
        let descriptor = frame(vec![
            layer("green"),
            transition(
                group(vec![effect.clone()], 1.0),
                group(vec![], 1.0),
                progress,
            ),
        ]);
        let result = compositor
            .render_frame_to_texture(&context, &descriptor)
            .unwrap();
        assert_pixel(read_pixel(&context, &result), [0, 255, 0, 255]);
    }
    for progress in [0.0, 1.0] {
        let missing = group(vec![layer("missing")], 0.0);
        let valid = group(vec![layer("red")], 1.0);
        let (from, to) = if progress == 0.0 {
            (valid, missing)
        } else {
            (missing, valid)
        };
        assert!(
            compositor
                .render_frame_to_texture(&context, &frame(vec![transition(from, to, progress)]))
                .is_err()
        );
        let recovered = compositor
            .render_frame_to_texture(&context, &frame(vec![layer("blue")]))
            .unwrap();
        assert_pixel(read_pixel(&context, &recovered), [0, 0, 255, 255]);
    }
}

#[test]
#[ignore = "requires a native GPU"]
fn distinct_branch_liquid_preparations_are_consumed_in_the_real_render_order() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = populated(&context);
    let pass = |amount| {
        let value: serde_json::Value = serde_json::from_str(&effects::resolve_stylized_effect_json(serde_json::json!({
            "effectType":"liquid","params":{"amount":amount,"columns":8,"rows":8,"durationTicks":4000},
            "localTime":4000,"frameRate":{"numerator":30,"denominator":1}
        }).to_string())).unwrap();
        serde_json::from_value(value["passes"][0].clone()).unwrap()
    };
    let mut from = group(vec![layer("red")], 1.0);
    from.items.push(FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![vec![pass(0.1)]],
    });
    from.effect_pass_groups = vec![vec![pass(0.2)]];
    let mut to = group(vec![layer("blue")], 0.5);
    to.items.push(FrameItemDescriptor::SceneEffect {
        effect_pass_groups: vec![vec![pass(0.3)]],
    });
    to.effect_pass_groups = vec![vec![pass(0.4)]];
    for (progress, expected) in [
        (0.0, [255, 0, 0, 255]),
        (0.5, [170, 0, 85, 191]),
        (1.0, [0, 0, 255, 128]),
        (0.0, [255, 0, 0, 255]),
    ] {
        let descriptor = frame(vec![transition(from.clone(), to.clone(), progress)]);
        let mut preparation = compositor::FramePreparation::new(descriptor).unwrap();
        while !preparation
            .advance(std::num::NonZeroU64::new(1).unwrap())
            .unwrap()
        {}
        let result = compositor
            .render_prepared_frame_to_texture(&context, preparation.finish().unwrap())
            .unwrap();
        assert_pixel(read_pixel(&context, &result), expected);
    }
}
