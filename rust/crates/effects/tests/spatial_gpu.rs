mod support;
use effects::{
    ApplyEffectsOptions, EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json,
};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(kind: &str, params: Value) -> EffectPass {
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":kind,"params":params,"localTime":0,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: kind.into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .expect("resolved spatial pass")
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}
fn gradient() -> Vec<u8> {
    (0..16)
        .flat_map(|y| (0..32).flat_map(move |x| [x * 8, y * 16, 80, 255]))
        .collect()
}
fn close(actual: u8, expected: f32) {
    assert!(
        (f32::from(actual) - expected).abs() <= 1.1,
        "{actual} != {expected}"
    );
}

#[test]
#[ignore = "requires native GPU; run --test spatial_gpu -- --include-ignored"]
fn lens_samples_real_input_with_circular_bounds_zoom_feather_and_dispersion() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let input = gradient();
    let draw = |params| render(&context, &pipeline, &input, 32, 16, &[pass("lens", params)]);
    let neutral = draw(json!({"zoom":1}));
    assert_eq!(neutral, input);
    assert_eq!(draw(json!({"radius":0})), input);
    let enlarged = draw(json!({"radius":0.375,"feather":0}));
    for y in 0..16usize {
        for x in 0..32usize {
            let i = (y * 32 + x) * 4;
            let dx = x as f32 + 0.5 - 16.0;
            let dy = y as f32 + 0.5 - 8.0;
            if dx * dx + dy * dy >= 36.0 {
                assert_eq!(
                    &enlarged[i..i + 4],
                    &input[i..i + 4],
                    "outside circle {x},{y}"
                );
            } else {
                // A linear color ramp is an independent coordinate ruler.
                close(enlarged[i], (15.5 + dx / 2.0) * 8.0);
                close(enlarged[i + 1], (7.5 + dy / 2.0) * 16.0);
                assert_eq!(&enlarged[i + 2..i + 4], &[80, 255]);
            }
        }
    }
    let soft = draw(json!({"radius":0.375,"feather":0.5}));
    let edge = (8 * 32 + 20) * 4;
    assert!(enlarged[edge] < soft[edge] && soft[edge] < input[edge]);
    let half = draw(json!({"radius":0.375,"feather":0,"amount":0.5}));
    for i in 0..input.len() {
        close(
            half[i],
            (f32::from(input[i]) + f32::from(enlarged[i])) / 2.0,
        );
    }
    let refracted = draw(json!({"zoom":1,"refraction":1,"radius":0.5,"feather":0}));
    assert_ne!(refracted, neutral);
    assert!(refracted[edge] < input[edge] && refracted[edge] > input[(8 * 32 + 15) * 4]);
    let dispersed =
        draw(json!({"zoom":1,"refraction":1,"dispersion":0.1,"radius":0.5,"feather":0}));
    assert!(
        dispersed[edge] > refracted[edge],
        "red ray must sample farther from center"
    );
    assert_eq!(dispersed[edge + 1], refracted[edge + 1]);
    assert_eq!(
        draw(json!({"radius":0.375,"feather":0})),
        enlarged,
        "history independence"
    );
    assert_ne!(
        draw(json!({"centerX":0.3,"centerY":0.25,"radius":0.375,"feather":0})),
        enlarged
    );
}

#[test]
#[ignore = "requires native GPU; run --test spatial_gpu -- --include-ignored"]
fn lens_premultiplies_interpolation_and_treats_outside_input_as_transparent() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..16)
        .flat_map(|_| {
            (0..32).flat_map(|x| {
                if x < 16 {
                    [255, 0, 0, 255]
                } else {
                    [0, 255, 0, 0]
                }
            })
        })
        .collect();
    let draw = |params| render(&context, &pipeline, &input, 32, 16, &[pass("lens", params)]);
    let output = draw(json!({"radius":2,"feather":0}));
    for (x, alpha) in [(14, 255), (15, 191), (16, 64), (17, 0)] {
        let p = &output[(8 * 32 + x) * 4..(8 * 32 + x) * 4 + 4];
        close(p[3], alpha as f32);
        assert_eq!(&p[..3], if alpha == 0 { &[0, 0, 0] } else { &[255, 0, 0] });
    }
    let outside = draw(json!({"centerX":-0.125,"radius":2,"feather":0}));
    for (x, alpha) in [(0, 0), (2, 0), (3, 64), (4, 191), (5, 255)] {
        let p = &outside[(8 * 32 + x) * 4..(8 * 32 + x) * 4 + 4];
        close(p[3], alpha as f32);
        assert_eq!(&p[..3], if alpha == 0 { &[0, 0, 0] } else { &[255, 0, 0] });
    }
    assert_eq!(
        draw(json!({"zoom":1})),
        input,
        "neutral preserves hidden RGB too"
    );
    let source = context.create_render_texture(32, 16, "spatial-invalid");
    for (key, value) in [
        ("centerX", f32::NAN),
        ("radius", -1.0),
        ("dispersion", 0.2),
        ("frame", 0.5),
    ] {
        let mut p = pass("lens", json!({}));
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
                .is_err()
        );
    }
}

#[test]
#[ignore = "requires native GPU; run --test spatial_gpu -- --include-ignored"]
fn local_ascii_and_dither_preserve_outside_pixels_and_legacy_passes() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = gradient();
    for kind in ["ascii", "retro-dither"] {
        let draw = |p| render(&context, &pipeline, &input, 32, 16, &[p]);
        let full = draw(pass(kind, json!({})));
        let mut legacy = pass(kind, json!({}));
        for key in ["local", "centerX", "centerY", "radius", "feather"] {
            legacy.uniforms.remove(key);
        }
        assert_eq!(draw(legacy), full, "old raw pass defaults to full-frame");
        let local = draw(pass(kind, json!({"local":1,"radius":0.375,"feather":0})));
        let mut changed = 0;
        for y in 0..16usize {
            for x in 0..32usize {
                let i = (y * 32 + x) * 4;
                let inside =
                    (x as f32 + 0.5 - 16.0).powi(2) + (y as f32 + 0.5 - 8.0).powi(2) < 36.0;
                let expected = if inside {
                    &full[i..i + 4]
                } else {
                    &input[i..i + 4]
                };
                assert_eq!(&local[i..i + 4], expected, "{kind} region {x},{y}");
                if inside && expected != &input[i..i + 4] {
                    changed += 1;
                }
            }
        }
        assert!(changed > 40, "{kind} must change the inside pixels");
        assert_eq!(draw(pass(kind, json!({"local":1,"radius":0}))), input);
        let mut invalid = pass(kind, json!({"local":1}));
        invalid
            .uniforms
            .insert("local".into(), UniformValue::Number(0.5));
        let source = context.create_render_texture(32, 16, "invalid-region");
        assert!(
            pipeline
                .apply(
                    &context,
                    ApplyEffectsOptions {
                        source: &source,
                        width: 32,
                        height: 16,
                        passes: &[invalid]
                    }
                )
                .is_err()
        );
    }
}
