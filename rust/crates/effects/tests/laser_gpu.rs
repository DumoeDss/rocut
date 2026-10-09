mod support;
use effects::{
    ApplyEffectsOptions, EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json,
};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(params: Value) -> EffectPass {
    let result: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"laser", "params":params, "localTime":0,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "laser".into(),
        uniforms: result["passes"][0]["uniforms"]
            .as_object()
            .expect("laser pass")
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    UniformValue::Number(value.as_f64().unwrap() as f32),
                )
            })
            .collect(),
    }
}

fn pattern() -> Vec<u8> {
    (0..16)
        .flat_map(|y| {
            (0..32).flat_map(move |x| {
                [
                    x * 8,
                    y * 16,
                    ((u16::from(x) * 13 + u16::from(y) * 17) % 256) as u8,
                    255,
                ]
            })
        })
        .collect()
}

fn pixel(image: &[u8], x: usize, y: usize) -> &[u8] {
    let index = (y * 32 + x) * 4;
    &image[index..index + 4]
}

fn close(actual: u8, expected: f32) {
    assert!(
        (f32::from(actual) - expected).abs() <= 1.1,
        "{actual} != {expected}"
    );
}

#[test]
#[ignore = "requires native GPU; run --test laser_gpu -- --include-ignored"]
fn laser_endpoints_and_four_half_reveals_preserve_the_actual_input() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let input = pattern();
    let mut alpha_input = input.clone();
    for (index, pixel) in alpha_input.chunks_exact_mut(4).enumerate() {
        pixel[3] = if index % 5 == 0 { 0 } else { 128 };
    }
    for direction in 0..4 {
        let draw = |params| render(&context, &pipeline, &alpha_input, 32, 16, &[pass(params)]);
        assert_eq!(
            draw(json!({"direction":direction,"progress":0})),
            vec![0; input.len()]
        );
        assert_eq!(
            draw(json!({"direction":direction,"progress":1,"glow":1})),
            alpha_input
        );
        let mut zero = pass(json!({"direction":direction,"progress":0.5,"glow":1}));
        zero.uniforms
            .insert("amount".into(), UniformValue::Number(0.0));
        assert_eq!(
            render(&context, &pipeline, &alpha_input, 32, 16, &[zero]),
            alpha_input
        );
        let half = render(
            &context,
            &pipeline,
            &input,
            32,
            16,
            &[pass(
                json!({"direction":direction,"progress":0.5,"width":0}),
            )],
        );
        for y in 0..16 {
            for x in 0..32 {
                let visible = match direction {
                    0 => x < 16,
                    1 => x >= 16,
                    2 => y < 8,
                    _ => y >= 8,
                };
                assert_eq!(
                    pixel(&half, x, y),
                    if visible {
                        pixel(&input, x, y)
                    } else {
                        &[0, 0, 0, 0]
                    },
                    "direction={direction} at {x},{y}"
                );
            }
        }
        let no_glow = render(
            &context,
            &pipeline,
            &input,
            32,
            16,
            &[pass(
                json!({"direction":direction,"progress":0.5,"width":0.125,"feather":0,"glow":0}),
            )],
        );
        assert_eq!(
            no_glow, half,
            "width alone must not paint or shift source pixels"
        );
    }
}

#[test]
#[ignore = "requires native GPU; run --test laser_gpu -- --include-ignored"]
fn laser_feather_and_amount_mix_premultiplied_without_hidden_rgb_or_hole_emission() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let mut input = [20, 40, 60, 128].repeat(32 * 16);
    let hole = (6 * 32 + 15) * 4;
    input[hole..hole + 4].copy_from_slice(&[0, 255, 200, 0]);
    let draw = |params| render(&context, &pipeline, &input, 32, 16, &[pass(params)]);
    let soft = draw(json!({"progress":0.5,"width":0.125,"feather":1,"glow":0}));
    // The 2px softness is entirely on the revealed side. Distances .5 and
    // 1.5 have smoothstep coverage 0.15625 and 0.84375, respectively.
    for (x, alpha) in [(15, 20.0), (14, 108.0), (13, 128.0)] {
        let p = pixel(&soft, x, 8);
        assert_eq!(&p[..3], &[20, 40, 60]);
        close(p[3], alpha);
    }
    assert_eq!(pixel(&soft, 16, 8), &[0, 0, 0, 0]);
    assert_eq!(pixel(&soft, 15, 6), &[0, 0, 0, 0]);
    let mixed = draw(
        json!({"amount":0.5,"progress":0.5,"width":0.125,"feather":1,"glow":1,"colorR":1,"colorG":0,"colorB":0}),
    );
    let edge = pixel(&mixed, 15, 8);
    // At this pixel the revealed red is 218.28125, but its alpha is only 20.
    // Premultiplied mixing weighs that emission by 20, not by the source's 128.
    close(edge[0], (20.0 * 128.0 + 218.28125 * 20.0) / (128.0 + 20.0));
    assert_eq!(&edge[1..3], &[40, 60]);
    close(edge[3], 74.0);
    assert_eq!(pixel(&mixed, 16, 8), &[20, 40, 60, 64]);
    assert_eq!(pixel(&mixed, 15, 6), &[0, 0, 0, 0]);
    let fully_lit = draw(json!({"progress":0.5,"width":0.25,"feather":0,"glow":1}));
    assert_eq!(pixel(&fully_lit, 15, 6), &[0, 0, 0, 0]);
    for x in 16..32 {
        assert_eq!(pixel(&fully_lit, x, 8), &[0, 0, 0, 0]);
    }
    let half_amount_start = draw(json!({"amount":0.5,"progress":0}));
    assert_eq!(pixel(&half_amount_start, 2, 8), &[20, 40, 60, 64]);
    // Coverage below half an RGBA8 alpha step must not leave hidden color.
    let almost_empty = draw(json!({"amount":0.999,"progress":0}));
    assert_eq!(pixel(&almost_empty, 2, 8), &[0, 0, 0, 0]);
}

#[test]
#[ignore = "requires native GPU; run --test laser_gpu -- --include-ignored"]
fn laser_color_and_width_produce_local_glow_only_on_revealed_source_coverage() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = [20, 40, 60, 255].repeat(32 * 16);
    let draw = |params| render(&context, &pipeline, &input, 32, 16, &[pass(params)]);
    let red = draw(
        json!({"progress":0.5,"width":0.125,"feather":0,"glow":1,"colorR":1,"colorG":0,"colorB":0}),
    );
    close(pixel(&red, 15, 8)[0], 218.28125);
    assert_eq!(&pixel(&red, 15, 8)[1..], &[40, 60, 255]);
    assert!(
        pixel(&red, 13, 8)[0] > 20,
        "halo must extend behind the 2px core"
    );
    assert_eq!(pixel(&red, 8, 8), &[20, 40, 60, 255]);
    for x in 16..32 {
        assert_eq!(pixel(&red, x, 8), &[0, 0, 0, 0]);
    }
    let green = draw(
        json!({"progress":0.5,"width":0.125,"feather":0,"glow":1,"colorR":0,"colorG":1,"colorB":0}),
    );
    assert_eq!(pixel(&green, 15, 8)[0], 20);
    close(pixel(&green, 15, 8)[1], 221.40625);
    assert_eq!(&pixel(&green, 15, 8)[2..], &[60, 255]);
    let wide = draw(
        json!({"progress":0.5,"width":0.25,"feather":0,"glow":1,"colorR":1,"colorG":0,"colorB":0}),
    );
    assert!(pixel(&wide, 7, 8)[0] > pixel(&red, 7, 8)[0]);
    let weaker = draw(
        json!({"progress":0.5,"width":0.125,"feather":0,"glow":0.5,"colorR":1,"colorG":0,"colorB":0}),
    );
    close(pixel(&weaker, 15, 8)[0], 119.140625);
    assert_eq!(pixel(&weaker, 16, 8), &[0, 0, 0, 0]);
}

#[test]
#[ignore = "requires native GPU; run --test laser_gpu -- --include-ignored"]
fn laser_reverse_progress_is_repeatable_and_pipeline_rejects_invalid_uniforms() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = pattern();
    let values = [0.2, 0.5, 0.8];
    let frames: Vec<_> = values
        .iter()
        .map(|p| {
            render(
                &context,
                &pipeline,
                &input,
                32,
                16,
                &[pass(json!({"progress":p,"direction":2,"width":0.125}))],
            )
        })
        .collect();
    assert_ne!(frames[0], frames[1]);
    assert_ne!(frames[1], frames[2]);
    for index in [2, 1, 0, 2, 0, 1] {
        let mut p = pass(json!({"progress":values[index],"direction":2,"width":0.125}));
        p.uniforms
            .insert("frame".into(), UniformValue::Number(16777215.0));
        assert_eq!(
            render(&context, &pipeline, &input, 32, 16, &[p]),
            frames[index]
        );
    }
    let source = context.create_render_texture(32, 16, "laser-invalid-uniforms");
    for (key, value) in [
        ("direction", 1.5),
        ("progress", f32::NAN),
        ("width", 0.251),
        ("glow", 1.1),
        ("frame", 0.5),
        ("seed", 1.0),
    ] {
        let mut p = pass(json!({}));
        p.uniforms.insert(key.into(), UniformValue::Number(value));
        assert!(
            pipeline
                .apply(
                    &context,
                    ApplyEffectsOptions {
                        source: &source,
                        width: 32,
                        height: 16,
                        passes: &[p]
                    }
                )
                .is_err(),
            "accepted {key}"
        );
    }
    let mut missing = pass(json!({}));
    missing.uniforms.remove("colorR");
    assert!(
        pipeline
            .apply(
                &context,
                ApplyEffectsOptions {
                    source: &source,
                    width: 32,
                    height: 16,
                    passes: &[missing]
                }
            )
            .is_err()
    );
}
