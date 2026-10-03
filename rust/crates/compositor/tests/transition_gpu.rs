mod support;
use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, CompositorError, FrameDescriptor,
    FrameItemDescriptor, LayerDescriptor, QuadTransformDescriptor,
};
use support::{assert_pixel, context, read_pixel, texture};

fn layer(id: &str) -> LayerDescriptor {
    LayerDescriptor {
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
    }
}
fn frame(clear: [f32; 4], items: Vec<FrameItemDescriptor>) -> FrameDescriptor {
    FrameDescriptor {
        width: 1,
        height: 1,
        clear: CanvasClearDescriptor { color: clear },
        items,
    }
}

#[test]
#[ignore = "requires a native GPU; run cargo test -p compositor --test transition_gpu -- --ignored"]
fn normal_compositing_preserves_straight_alpha_before_transition_mixing() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = Compositor::new(&context);
    compositor.upsert_texture("red".into(), texture(&context, [255, 0, 0, 128]));
    for (clear, expected) in [
        ([0.0, 0.0, 0.0, 0.0], [255, 0, 0, 128]),
        ([0.0, 1.0, 0.0, 128.0 / 255.0], [170, 85, 0, 192]),
        ([0.0, 1.0, 0.0, 1.0], [128, 127, 0, 255]),
        ([0.0, 1.0, 0.0, 0.0], [255, 0, 0, 128]),
    ] {
        let output = compositor
            .render_frame_to_texture(
                &context,
                &frame(clear, vec![FrameItemDescriptor::Layer(layer("red"))]),
            )
            .unwrap();
        assert_pixel(read_pixel(&context, &output), expected);
    }
    compositor.upsert_texture("empty".into(), texture(&context, [255, 0, 255, 0]));
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame(
                [0.0, 1.0, 0.0, 0.0],
                vec![FrameItemDescriptor::Layer(layer("empty"))],
            ),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [0, 0, 0, 0]);
}
fn transition(
    outgoing: Vec<LayerDescriptor>,
    incoming: Vec<LayerDescriptor>,
    progress: f32,
) -> FrameItemDescriptor {
    FrameItemDescriptor::Transition {
        outgoing,
        incoming,
        progress,
    }
}

#[test]
#[ignore = "requires a native GPU; run cargo test -p compositor --test transition_gpu -- --ignored"]
fn cross_dissolve_uses_two_independent_branches_and_preserves_alpha() {
    let _gpu = support::lock_gpu();
    let context = context();
    let mut compositor = Compositor::new(&context);
    compositor.upsert_texture("red".into(), texture(&context, [255, 0, 0, 255]));
    compositor.upsert_texture("blue".into(), texture(&context, [0, 0, 255, 255]));
    for (progress, expected) in [
        (0.0, [255, 0, 0, 255]),
        (0.25, [191, 0, 64, 255]),
        (0.5, [128, 0, 128, 255]),
        (1.0, [0, 0, 255, 255]),
    ] {
        let output = compositor
            .render_frame_to_texture(
                &context,
                &frame(
                    [0.0; 4],
                    vec![transition(
                        vec![layer("red")],
                        vec![layer("blue")],
                        progress,
                    )],
                ),
            )
            .unwrap();
        assert_pixel(read_pixel(&context, &output), expected);
    }
    compositor.upsert_texture("red".into(), texture(&context, [255, 0, 0, 128]));
    compositor.upsert_texture("blue".into(), texture(&context, [0, 0, 255, 64]));
    for (clear, expected) in [
        ([0.0; 4], [170, 0, 85, 96]),
        ([0.0, 1.0, 0.0, 1.0], [64, 159, 32, 255]),
    ] {
        let output = compositor
            .render_frame_to_texture(
                &context,
                &frame(
                    clear,
                    vec![transition(vec![layer("red")], vec![layer("blue")], 0.5)],
                ),
            )
            .unwrap();
        assert_pixel(read_pixel(&context, &output), expected);
    }
    let mut red = layer("red");
    let mut blue = layer("blue");
    red.blend_mode = BlendMode::Multiply;
    blue.blend_mode = BlendMode::Multiply;
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame(
                [0.0, 1.0, 0.0, 1.0],
                vec![transition(vec![red], vec![blue], 0.5)],
            ),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [0, 159, 0, 255]);

    compositor.upsert_texture("mask".into(), texture(&context, [255, 255, 255, 128]));
    let mut red = layer("red");
    red.mask = Some(compositor::LayerMaskDescriptor {
        texture_id: "mask".into(),
        feather: 0.0,
        inverted: false,
    });
    let mut blue = layer("blue");
    blue.opacity = 0.5;
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame([0.0; 4], vec![transition(vec![red], vec![blue], 0.5)]),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [170, 0, 85, 48]);

    // Subsequent layers and effects must still see one complete scene.
    compositor.upsert_texture("green".into(), texture(&context, [0, 255, 0, 255]));
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame(
                [0.0; 4],
                vec![
                    transition(vec![layer("red")], vec![layer("blue")], 0.5),
                    FrameItemDescriptor::Layer(layer("green")),
                ],
            ),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [0, 255, 0, 255]);
    let gray: FrameItemDescriptor = serde_json::from_value(serde_json::json!({
        "type": "sceneEffect", "effectPassGroups": [[{"shader": "color-adjustment", "uniforms": {
            "exposure": 0, "contrast": 0, "saturation": -100, "temperature": 0, "tint": 0
        }}]]
    }))
    .unwrap();
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame(
                [0.0; 4],
                vec![
                    transition(vec![layer("red")], vec![layer("blue")], 0.5),
                    gray,
                ],
            ),
        )
        .unwrap();
    let pixel = read_pixel(&context, &output);
    assert!(pixel[0].abs_diff(pixel[1]) <= 1 && pixel[1].abs_diff(pixel[2]) <= 1);
    assert!(pixel[3].abs_diff(96) <= 1);

    for progress in [-0.01, 1.01, f32::NAN, f32::INFINITY] {
        let result = compositor.render_frame_to_texture(
            &context,
            &frame(
                [0.0; 4],
                vec![transition(
                    vec![layer("red")],
                    vec![layer("blue")],
                    progress,
                )],
            ),
        );
        assert!(matches!(
            result,
            Err(CompositorError::InvalidTransitionProgress(_))
        ));
    }
    let result = compositor.render_frame_to_texture(
        &context,
        &frame(
            [0.0; 4],
            vec![transition(vec![layer("missing")], vec![layer("blue")], 0.5)],
        ),
    );
    assert!(matches!(
        result,
        Err(CompositorError::MissingTexture { .. })
    ));
    // An error must not poison the next frame or the recycled texture pool.
    let output = compositor
        .render_frame_to_texture(
            &context,
            &frame([0.0; 4], vec![FrameItemDescriptor::Layer(layer("green"))]),
        )
        .unwrap();
    assert_pixel(read_pixel(&context, &output), [0, 255, 0, 255]);
}
