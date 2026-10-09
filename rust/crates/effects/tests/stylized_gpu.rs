mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(kind: &str, frame: i64, params: Value) -> EffectPass {
    let response: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType": kind, "params": params, "localTime": frame * 4000,
            "frameRate": {"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: kind.into(),
        uniforms: response["passes"][0]["uniforms"]
            .as_object()
            .expect("resolved pass")
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

#[test]
#[ignore = "requires a native GPU; run --test stylized_gpu -- --ignored"]
fn native_filters_have_deterministic_pixels_alpha_palette_and_order() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let mut input = Vec::new();
    for y in 0..32 {
        for x in 0..64 {
            input.extend_from_slice(&if x < 8 {
                [0, 0, 0, 0]
            } else {
                [x * 4, y * 8, (x ^ y) * 3, if y < 16 { 128 } else { 255 }]
            });
        }
    }
    let draw = |passes: &[EffectPass]| render(&context, &pipeline, &input, 64, 32, passes);
    for kind in ["vhs", "glitch", "retro-dither"] {
        let active = pass(kind, 15, json!({"seed":7}));
        let mut off = active.clone();
        off.uniforms
            .insert("amount".into(), UniformValue::Number(0.0));
        assert_eq!(draw(&[off]), input, "{kind} identity");
        let a = draw(&[active.clone()]);
        assert_ne!(a, input, "{kind} no-op");
        let other = draw(&[pass(kind, 2, json!({"seed":7}))]);
        assert_eq!(a, draw(&[active.clone()]), "{kind} seek order");
        if kind == "retro-dither" {
            assert_eq!(a, other);
        } else {
            assert_ne!(a, other);
        }
        assert_ne!(
            a,
            draw(&[pass(kind, 15, json!({"seed":13}))]),
            "{kind} seed ignored"
        );
        if kind != "glitch" {
            for (source, output) in input.chunks_exact(4).zip(a.chunks_exact(4)) {
                assert_eq!(source[3], output[3]);
            }
        }
    }
    let dither = pass("retro-dither", 0, json!({"levels":4,"amount":1}));
    for pixel in draw(&[dither.clone()]).chunks_exact(4).filter(|p| p[3] > 0) {
        assert!(
            pixel[..3].iter().all(|v| [0, 85, 170, 255].contains(v)),
            "palette {pixel:?}"
        );
    }
    let tape = pass("vhs", 0, json!({"amount":1,"noise":0.4}));
    assert_ne!(
        draw(&[tape.clone(), dither.clone()]),
        draw(&[dither, tape]),
        "pass order ignored"
    );
    let saturated: Vec<u8> = (0..64 * 32)
        .flat_map(|i| {
            if i % 64 > 16 && i % 64 < 48 {
                [255, 0, 0, 128]
            } else {
                [0, 0, 0, 0]
            }
        })
        .collect();
    let moved = render(
        &context,
        &pipeline,
        &saturated,
        64,
        32,
        &[pass(
            "glitch",
            0,
            json!({"frequency":1,"displacement":0.2,"amount":0.5}),
        )],
    );
    assert_ne!(moved, saturated);
    for pixel in moved.chunks_exact(4).filter(|p| p[3] > 0) {
        assert_eq!(&pixel[..3], &[255, 0, 0], "black fringe: {pixel:?}");
        assert!(pixel[3] <= 128);
    }
}
