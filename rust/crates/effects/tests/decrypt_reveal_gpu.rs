mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(params: Value) -> EffectPass {
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"decrypt-reveal","params":params,"localTime":0,
            "frameRate":{"numerator":30,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "decrypt-reveal".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .expect("decrypt reveal pass")
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}

fn gradient(width: u32, height: u32) -> Vec<u8> {
    (0..height)
        .flat_map(|y| {
            (0..width).flat_map(move |x| {
                [
                    (x * 2 + 20) as u8,
                    (y * 3 + 20) as u8,
                    ((x + y) % 128 + 70) as u8,
                    255,
                ]
            })
        })
        .collect()
}

fn pixel(image: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
    let index = (y * width + x) * 4;
    &image[index..index + 4]
}

fn close(actual: u8, expected: f32) {
    assert!(
        (f32::from(actual) - expected).abs() <= 1.1,
        "{actual} != {expected}"
    );
}

#[test]
#[ignore = "requires native GPU; run --test decrypt_reveal_gpu -- --include-ignored"]
fn characters_have_exact_glyphs_gutters_color_and_source_alpha() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let white = [255u8, 255, 255, 128].repeat(12 * 16);
    let draw = |params| render(&context, &pipeline, &white, 12, 16, &[pass(params)]);
    // Exact byte centers avoid making glyph geometry depend on an RGBA8
    // half-step tie (0.5 * 255 = 127.5) in the target's conversion.
    let params = json!({"progress":0,"cellSize":6,"colorR":64.0/255.0,"colorG":128.0/255.0,"colorB":1});
    let characters = draw(params.clone());
    let at_rows = [14u32, 17, 23, 21, 23, 16, 15];
    for y in 0..16 {
        for x in 0..12 {
            let lit = x % 6 < 5 && y % 8 < 7 && ((at_rows[y % 8] >> (4 - x % 6)) & 1) == 1;
            let expected = if lit {
                [64, 128, 255, 128]
            } else {
                [0, 0, 0, 128]
            };
            assert_eq!(
                pixel(&characters, 12, x, y),
                &expected,
                "glyph/gutter {x},{y}"
            );
        }
    }
    let mut inverted = params.clone();
    inverted["contrast"] = json!(-2);
    assert!(draw(inverted).chunks_exact(4).all(|p| p == [0, 0, 0, 128]));
    let mut changed_size = params.clone();
    changed_size["cellSize"] = json!(8.125);
    assert_ne!(draw(changed_size), characters);
    let mut zero = pass(params);
    zero.uniforms
        .insert("amount".into(), UniformValue::Number(0.0));
    assert_eq!(render(&context, &pipeline, &white, 12, 16, &[zero]), white);
}

#[test]
#[ignore = "requires native GPU; run --test decrypt_reveal_gpu -- --include-ignored"]
fn progress_endpoints_and_moving_circles_reveal_actual_nonuniform_input() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = gradient(96, 64);
    let draw = |params| render(&context, &pipeline, &input, 96, 64, &[pass(params)]);
    let characters = draw(json!({"progress":0}));
    assert_ne!(characters, input);
    assert_eq!(draw(json!({"progress":1,"radius":0})), characters);
    for center_x in [0.25, 0.75] {
        let params =
            json!({"progress":1,"centerX":center_x,"centerY":0.5,"radius":0.25,"feather":0});
        let hard = draw(params.clone());
        let mut softened = params;
        softened["feather"] = json!(0.5);
        let soft = draw(softened);
        let mut partial = 0;
        for y in 0..64 {
            for x in 0..96 {
                let distance = ((x as f32 + 0.5 - center_x as f32 * 96.0).powi(2)
                    + (y as f32 + 0.5 - 32.0).powi(2))
                .sqrt();
                let original = pixel(&input, 96, x, y);
                let coded = pixel(&characters, 96, x, y);
                assert_eq!(
                    pixel(&hard, 96, x, y),
                    if distance < 16.0 { original } else { coded }
                );
                let t = ((distance - 8.0) / 8.0).clamp(0.0, 1.0);
                let weight = 1.0 - t * t * (3.0 - 2.0 * t);
                for channel in 0..3 {
                    close(
                        pixel(&soft, 96, x, y)[channel],
                        f32::from(coded[channel]) * (1.0 - weight)
                            + f32::from(original[channel]) * weight,
                    );
                }
                partial += usize::from(
                    pixel(&soft, 96, x, y) != original && pixel(&soft, 96, x, y) != coded,
                );
            }
        }
        assert!(
            partial > 100,
            "soft circular boundary must blend the actual source"
        );
    }
    let wide = gradient(96, 54);
    assert_eq!(
        render(
            &context,
            &pipeline,
            &wide,
            96,
            54,
            &[pass(json!({
                "progress":1,"radius":2,"feather":0,"centerX":0.5,"centerY":0.5
            }))]
        ),
        wide,
        "radius two covers this 16:9 frame, not every aspect ratio"
    );
}

#[test]
#[ignore = "requires native GPU; run --test decrypt_reveal_gpu -- --include-ignored"]
fn seeded_cells_reveal_independently_and_repeat_under_reverse_seek() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = gradient(96, 64);
    let draw = |params| render(&context, &pipeline, &input, 96, 64, &[pass(params)]);
    let characters = draw(json!({"progress":0,"cellSize":6}));
    let middle = draw(json!({"progress":0.5,"cellSize":6,"radius":2,"feather":0}));
    let mut counts = [0usize; 3];
    for ((result, original), coded) in middle
        .chunks_exact(4)
        .zip(input.chunks_exact(4))
        .zip(characters.chunks_exact(4))
    {
        if original == coded {
            continue;
        }
        let category = if result == original {
            0
        } else if result == coded {
            1
        } else {
            2
        };
        counts[category] += 1;
    }
    assert!(
        counts.iter().all(|count| *count > 100),
        "source/characters/mixed {counts:?}; not a whole-frame fade"
    );
    assert_ne!(
        draw(json!({"progress":0.5,"cellSize":6,"radius":2,"feather":0,"seed":2})),
        middle
    );
    let states = [
        json!({"progress":0.2,"centerX":0.2,"cellSize":8.125}),
        json!({"progress":0.7,"centerX":0.7,"cellSize":11.25}),
        json!({"progress":1,"centerX":0.4,"cellSize":18.5}),
    ];
    let frames: Vec<_> = states.iter().map(|params| draw(params.clone())).collect();
    for index in [2, 0, 1, 2, 1, 0] {
        let mut p = pass(states[index].clone());
        p.uniforms
            .insert("frame".into(), UniformValue::Number(1234.0));
        assert_eq!(
            render(&context, &pipeline, &input, 96, 64, &[p]),
            frames[index]
        );
    }
}

#[test]
#[ignore = "requires native GPU; run --test decrypt_reveal_gpu -- --include-ignored"]
fn hidden_transparent_rgb_does_not_change_density_and_amount_blends_premultiplied() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..32)
        .flat_map(|y| {
            (0..48).flat_map(move |x| {
                if x % 7 < 2 {
                    [0, 255, 0, 0]
                } else {
                    [240, 40, 20, if y < 16 { 96 } else { 192 }]
                }
            })
        })
        .collect();
    let clean: Vec<u8> = input
        .chunks_exact(4)
        .flat_map(|p| {
            if p[3] == 0 {
                [0, 0, 0, 0]
            } else {
                [p[0], p[1], p[2], p[3]]
            }
        })
        .collect();
    let params = json!({"progress":0,"cellSize":8.125});
    let full = render(&context, &pipeline, &input, 48, 32, &[pass(params.clone())]);
    let clean_full = render(&context, &pipeline, &clean, 48, 32, &[pass(params.clone())]);
    assert_eq!(
        full, clean_full,
        "hidden green cannot influence character density"
    );
    let mut half_params = params;
    half_params["amount"] = json!(0.5);
    let half = render(&context, &pipeline, &input, 48, 32, &[pass(half_params)]);
    for ((result, half), original) in full
        .chunks_exact(4)
        .zip(half.chunks_exact(4))
        .zip(input.chunks_exact(4))
    {
        assert_eq!(result[3], original[3]);
        assert_eq!(half[3], original[3]);
        if original[3] == 0 {
            assert_eq!(result, &[0, 0, 0, 0]);
            assert_eq!(half, &[0, 0, 0, 0]);
        } else {
            for channel in 0..3 {
                close(
                    half[channel],
                    (f32::from(result[channel]) + f32::from(original[channel])) / 2.0,
                );
            }
        }
    }
}
