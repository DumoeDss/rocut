mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn resolve(params: Value, ticks: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"mono-dither", "params":params, "localTime":ticks,
            "frameRate":{"numerator":24000,"denominator":1001}})
        .to_string(),
    ))
    .unwrap()
}

fn pass(params: Value, ticks: i64) -> EffectPass {
    let response = resolve(params, ticks);
    EffectPass {
        shader: "mono-dither".into(),
        uniforms: response["passes"][0]["uniforms"]
            .as_object()
            .expect("mono-dither pass")
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}

#[test]
fn mono_parameters_have_explicit_static_clock_and_preserve_existing_color_dither() {
    let response = resolve(json!({}), 75075);
    assert_eq!(response["frameIndex"], 15);
    assert_eq!(
        response["passes"][0]["uniforms"],
        json!({
            "amount":1.0,"threshold":0.5,"cellSize":2.0,"spread":1.0,"seed":1.0,"frame":0.0
        })
    );
    assert_eq!(resolve(json!({}), -1)["passes"], response["passes"]);
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
    assert_eq!(
        resolve(json!({"cellSize":3.7,"threshold":2,"spread":-1}), 0)["passes"][0]["uniforms"]["cellSize"],
        4.0
    );
    assert_eq!(
        resolve(json!({"threshold":2}), 0)["passes"][0]["uniforms"]["threshold"],
        1.0
    );
    for params in [
        json!({"levels":2}),
        json!({"threshold":"0.5"}),
        json!({"seed":null}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
    let old: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"retro-dither","params":{},"localTime":0,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(old["passes"][0]["uniforms"]["levels"], 4.0);
    assert!(old["passes"][0]["uniforms"].get("threshold").is_none());
}

#[test]
#[ignore = "requires a native GPU; run --test mono_dither_gpu -- --include-ignored"]
fn mono_is_one_bit_luma_not_per_channel_color_with_exact_alpha_and_spatial_oracle() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let gray = [128, 128, 128, 255].repeat(8 * 8);
    let draw =
        |input: &[u8], params: Value| render(&context, &pipeline, input, 8, 8, &[pass(params, 0)]);
    let first = draw(&gray, json!({"cellSize":1,"seed":0}));
    // An independently specified conventional Bayer rank table, not shader code.
    let ranks = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for cell in [1usize, 2, 3] {
        let output = draw(&gray, json!({"cellSize":cell,"seed":0}));
        for (i, p) in output.chunks_exact(4).enumerate() {
            let value = if ranks[(i / 8 / cell) % 4][(i % 8 / cell) % 4] < 8 {
                255
            } else {
                0
            };
            assert_eq!(
                p,
                &[value, value, value, 255],
                "rank table at {i}, cell {cell}"
            );
        }
    }
    for (rgb, expected_white) in [
        ([255, 0, 0], 12),
        ([0, 255, 0], 44),
        ([0, 0, 255], 4),
        ([128, 128, 128], 32),
    ] {
        for alpha in [1u8, 128, 255] {
            let input = [rgb[0], rgb[1], rgb[2], alpha].repeat(64);
            let output = draw(&input, json!({"cellSize":1,"seed":0}));
            assert_eq!(
                output.chunks_exact(4).filter(|p| p[0] == 255).count(),
                expected_white
            );
            for p in output.chunks_exact(4) {
                assert!([0, 255].contains(&p[0]));
                assert_eq!(p, &[p[0], p[0], p[0], alpha]);
            }
        }
    }
    for threshold in [0.0, 0.25, 0.75, 1.0] {
        for color in [0u8, 255] {
            let input = [color, color, color, 255].repeat(64);
            assert_eq!(
                draw(&input, json!({"threshold":threshold})),
                input,
                "black/white endpoints"
            );
        }
    }
    for (threshold, count) in [(0.25, 48), (0.75, 16)] {
        assert_eq!(
            draw(&gray, json!({"cellSize":1,"seed":0,"threshold":threshold}))
                .chunks_exact(4)
                .filter(|p| p[0] == 255)
                .count(),
            count
        );
    }
    assert_eq!(
        draw(&gray, json!({"spread":0})),
        [255, 255, 255, 255].repeat(64)
    );
    assert_eq!(draw(&[255, 0, 0, 0].repeat(64), json!({})), vec![0; 256]);
    assert_ne!(first, draw(&gray, json!({"cellSize":1,"seed":1})));
    assert_eq!(
        first,
        render(
            &context,
            &pipeline,
            &gray,
            8,
            8,
            &[pass(json!({"cellSize":1,"seed":0}), 75075)]
        )
    );
    assert_eq!(first, draw(&gray, json!({"cellSize":1,"seed":0})));
    let original = [40, 120, 210, 128].repeat(64);
    let mut zero = pass(json!({}), 0);
    zero.uniforms
        .insert("amount".into(), UniformValue::Number(0.0));
    assert_eq!(
        render(&context, &pipeline, &original, 8, 8, &[zero]),
        original
    );
    let full = draw(&original, json!({"cellSize":1,"seed":0}));
    let half = draw(&original, json!({"amount":0.5,"cellSize":1,"seed":0}));
    for ((src, one), mixed) in original
        .chunks_exact(4)
        .zip(full.chunks_exact(4))
        .zip(half.chunks_exact(4))
    {
        for c in 0..3 {
            assert!((i16::from(mixed[c]) * 2 - i16::from(src[c]) - i16::from(one[c])).abs() <= 1);
        }
        assert_eq!(mixed[3], 128);
    }
    let mut invalid = pass(json!({}), 0);
    invalid
        .uniforms
        .insert("threshold".into(), UniformValue::Number(1.1));
    let texture = context.create_render_texture(8, 8, "invalid-mono-uniform");
    assert!(
        pipeline
            .apply(
                &context,
                effects::ApplyEffectsOptions {
                    source: &texture,
                    width: 8,
                    height: 8,
                    passes: &[invalid]
                }
            )
            .is_err()
    );
}
