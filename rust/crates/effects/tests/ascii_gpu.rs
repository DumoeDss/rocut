mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

// Avoid concurrent adapter acquisition in this GPU fixture binary. Every pixel
// assertion still runs; do not turn an unavailable adapter into a skipped pass.
static GPU_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn pass(params: Value, time: i64) -> EffectPass {
    let response: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"ascii","params":params,"localTime":time,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "ascii".into(),
        uniforms: response["passes"][0]["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}

#[test]
#[ignore = "requires a native GPU; run --test ascii_gpu -- --ignored"]
fn ascii_draws_recognizable_bitmap_glyphs_with_correct_alpha_and_identity() {
    let _guard = GPU_TEST_LOCK.lock().unwrap();
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let white = vec![255; 24 * 16 * 4];
    let active = pass(json!({"cellSize":6}), 0);
    let actual = render(&context, &pipeline, &white, 24, 16, &[active.clone()]);
    // Hand-specified @ strokes, including transparent letter counters and cell
    // gutters: stronger than a screenshot/no-op test or reusing shader output.
    let rows = [14u32, 17, 23, 21, 23, 16, 15];
    for y in 0..16 {
        for x in 0..24 {
            let bit = x % 6 < 5 && y % 8 < 7 && (rows[y % 8] >> (4 - x % 6)) & 1 != 0;
            let expected = if bit {
                [255, 255, 255, 255]
            } else {
                [0, 0, 0, 0]
            };
            assert_eq!(
                &actual[(y * 24 + x) * 4..(y * 24 + x + 1) * 4],
                &expected,
                "glyph pixel {x},{y}"
            );
        }
    }
    let mut half = white.clone();
    for p in half.chunks_exact_mut(4) {
        p[3] = 128;
    }
    let output = render(&context, &pipeline, &half, 24, 16, &[active.clone()]);
    for (a, b) in actual.chunks_exact(4).zip(output.chunks_exact(4)) {
        assert_eq!(
            b,
            if a[3] == 0 {
                &[0, 0, 0, 0]
            } else {
                &[255, 255, 255, 128]
            },
            "premultiplied fringe"
        );
    }
    let empty = vec![0; 24 * 16 * 4];
    assert_eq!(
        render(&context, &pipeline, &empty, 24, 16, &[active.clone()]),
        empty
    );
    let mut disabled = active.clone();
    disabled
        .uniforms
        .insert("amount".into(), UniformValue::Number(0.0));
    assert_eq!(
        render(&context, &pipeline, &half, 24, 16, &[disabled]),
        half
    );
    assert_eq!(
        render(
            &context,
            &pipeline,
            &white,
            24,
            16,
            &[pass(json!({"cellSize":6,"contrast":-1}), 0)]
        ),
        empty
    );
}

#[test]
#[ignore = "requires a native GPU; run --test ascii_gpu -- --ignored"]
fn ascii_parameters_and_seed_change_pixels_but_time_and_seek_order_do_not() {
    let _guard = GPU_TEST_LOCK.lock().unwrap();
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..96 * 64)
        .flat_map(|i| [(i % 96 * 2) as u8, (i / 96 * 3) as u8, 96, 160])
        .collect();
    let draw = |p: EffectPass| render(&context, &pipeline, &input, 96, 64, &[p]);
    let first = draw(pass(json!({"cellSize":6,"seed":19}), 0));
    for params in [
        json!({"cellSize":12,"seed":19}),
        json!({"cellSize":6,"seed":31}),
        json!({"cellSize":6,"seed":19,"contrast":2}),
        json!({"cellSize":6,"seed":19,"color":0}),
        json!({"cellSize":6,"seed":19,"amount":0.5}),
    ] {
        assert_ne!(first, draw(pass(params, 0)));
    }
    assert_eq!(first, draw(pass(json!({"cellSize":6,"seed":19}), 999999)));
    assert_eq!(first, draw(pass(json!({"cellSize":6,"seed":19}), 0)));
    let mono = draw(pass(json!({"cellSize":6,"color":0}), 0));
    for p in mono.chunks_exact(4).filter(|p| p[3] > 0) {
        assert_eq!(&p[..3], &[255, 255, 255]);
        assert!(p[3] <= 160);
    }
}
