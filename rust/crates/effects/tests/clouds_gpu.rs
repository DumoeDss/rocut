mod support;

use effects::{
    ApplyEffectsOptions, EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json,
};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn gpu_context() -> GpuContext {
    let context = block_on(GpuContext::new()).unwrap();
    let info = context.adapter().get_info();
    eprintln!("Clouds GPU adapter: {info:?}");
    if std::env::var("WGPU_BACKEND").as_deref() == Ok("vulkan") {
        assert_eq!(info.backend, wgpu::Backend::Vulkan);
    }
    context
}

fn pass(params: Value, ticks: i64) -> EffectPass {
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"clouds","params":params,"localTime":ticks,
            "frameRate":{"numerator":30,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "clouds".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .unwrap_or_else(|| panic!("expected active Clouds pass: {resolved}"))
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

fn changed(pass: &EffectPass, entries: &[(&str, f32)]) -> EffectPass {
    let mut next = pass.clone();
    for (key, value) in entries {
        next.uniforms
            .insert((*key).into(), UniformValue::Number(*value));
    }
    next
}

fn pattern(width: u32, height: u32, hidden_rgb: bool) -> Vec<u8> {
    (0..height)
        .flat_map(|y| {
            (0..width).flat_map(move |x| {
                [
                    (x * 3 % 256) as u8,
                    (y * 3 % 256) as u8,
                    64,
                    if hidden_rgb {
                        [0, 64, 255][((x + y) % 3) as usize]
                    } else {
                        255
                    },
                ]
            })
        })
        .collect()
}

fn pixel(bytes: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
    &bytes[(y * width + x) * 4..][..4]
}

fn changed_pixels(left: &[u8], right: &[u8]) -> usize {
    left.chunks_exact(4)
        .zip(right.chunks_exact(4))
        .filter(|(a, b)| a != b)
        .count()
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_neutral_passes_preserve_raw_hidden_rgb_exactly() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let active = pass(json!({}), 0);
    for (width, height) in [(96, 64), (64, 96), (93, 62)] {
        let input = pattern(width, height, true);
        for effect in [
            changed(&active, &[("amount", 0.0)]),
            changed(&active, &[("density", 0.0)]),
            changed(&active, &[("refraction", 0.0), ("fogOpacity", 0.0)]),
        ] {
            assert_eq!(
                render(&context, &pipeline, &input, width, height, &[effect]),
                input
            );
        }
    }
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_non_neutral_zero_coverage_canonicalizes_raw_transparent_rgb() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    // A 1x1 surface samples q=0. Independent lattice golden N=.79684931 is
    // strictly below 1-density=.999999, so coverage is zero without a no-op.
    let effect = pass(json!({"density":0.000001,"speed":0}), 0);
    let input = [255, 0, 255, 0];
    assert_eq!(
        render(&context, &pipeline, &input, 1, 1, &[effect]),
        [0, 0, 0, 0]
    );
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_fog_only_obeys_independent_alpha_over_at_lattice_origin() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let effect = pass(
        json!({"amount":0.8,"density":0.3,"speed":0,
        "refraction":0,"fogOpacity":0.6,"colorR":0.25,"colorG":0.5,"colorB":0.75}),
        0,
    );
    // q=0 at center of 65x65: each octave is the independently frozen
    // seed1/plane0/index0 scalar; no shader/packed uniform is the oracle.
    let t = ((0.7968493103981018_f64 - 0.7) / 0.2).clamp(0.0, 1.0);
    let fog_alpha = 0.8 * (t * t * (3.0 - 2.0 * t)) * 0.6;
    for base in [[20_u8, 80, 150, 64], [255, 0, 255, 0]] {
        let input: Vec<u8> = (0..65 * 65).flat_map(|_| base).collect();
        let output = render(&context, &pipeline, &input, 65, 65, &[effect.clone()]);
        let actual = pixel(&output, 65, 32, 32);
        let source_alpha = f64::from(base[3]) / 255.0;
        let alpha = source_alpha * (1.0 - fog_alpha) + fog_alpha;
        for (channel, color) in [0.25, 0.5, 0.75].into_iter().enumerate() {
            let expected = (f64::from(base[channel]) / 255.0 * source_alpha * (1.0 - fog_alpha)
                + color * fog_alpha)
                / alpha
                * 255.0;
            assert!(
                (f64::from(actual[channel]) - expected).abs() <= 1.1,
                "fog channel {channel}: {actual:?} vs {expected}"
            );
        }
        assert!((f64::from(actual[3]) - alpha * 255.0).abs() <= 1.1);
        assert!(changed_pixels(&output, &input) > 100);
        assert!(output.chunks_exact(4).all(|p| p[3] >= base[3]));
    }
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_refraction_only_samples_real_texture_and_never_leaks_hidden_color() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let effect = pass(
        json!({"density":1,"speed":0,"refraction":0.08,"fogOpacity":0}),
        0,
    );
    let input = pattern(65, 65, false);
    let output = render(&context, &pipeline, &input, 65, 65, &[effect.clone()]);
    assert!(changed_pixels(&output, &input) > 100);
    assert_eq!(
        pixel(&output, 65, 32, 32),
        pixel(&input, 65, 32, 32),
        "q=0 has zero analytic gradient"
    );
    // Frozen independent scalar-field/gradient and affine-source sampling vectors.
    for (x, y, expected) in [
        (40, 31, [130_u8, 93, 64, 255]),
        (24, 35, [63, 107, 64, 255]),
    ] {
        for (actual, expected) in pixel(&output, 65, x, y).iter().zip(expected) {
            assert!((i16::from(*actual) - i16::from(expected)).abs() <= 1);
        }
    }
    let affine_holes: Vec<u8> = input
        .chunks_exact(4)
        .enumerate()
        .flat_map(|(index, p)| {
            if index % 65 < 32 {
                [p[0], p[1], p[2], p[3]]
            } else {
                [0, 255, 255, 0]
            }
        })
        .collect();
    let edges = render(
        &context,
        &pipeline,
        &affine_holes,
        65,
        65,
        &[effect.clone()],
    );
    for (y, expected) in [
        (2, [93_u8, 3, 64, 78]),
        (3, [93, 4, 64, 128]),
        (4, [93, 8, 64, 64]),
    ] {
        for (actual, expected) in pixel(&edges, 65, 33, y).iter().zip(expected) {
            assert!((i16::from(*actual) - i16::from(expected)).abs() <= 1);
        }
    }
    let alternate: Vec<u8> = input
        .chunks_exact(4)
        .flat_map(|p| [255 - p[0], 32, p[1], p[3]])
        .collect();
    let other = render(&context, &pipeline, &alternate, 65, 65, &[effect.clone()]);
    assert!(changed_pixels(&other, &alternate) > 100);
    assert!(changed_pixels(&other, &output) > 3000);
    let holes: Vec<u8> = (0..65)
        .flat_map(|_| {
            (0..65).flat_map(|x| {
                if x < 32 {
                    [0, 255, 0, 128]
                } else {
                    [255, 0, 255, 0]
                }
            })
        })
        .collect();
    let refracted = render(&context, &pipeline, &holes, 65, 65, &[effect.clone()]);
    assert!(
        refracted.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 128),
        "manual bilinear sampling must expose intermediate alpha"
    );
    for p in refracted.chunks_exact(4) {
        assert!(
            p[3] <= 128,
            "refraction-only cannot independently add opacity"
        );
        if p[3] > 0 {
            assert_eq!(&p[..3], &[0, 255, 0]);
        } else {
            // Tiny positive coverage may quantize its alpha to zero in UNORM.
            assert_eq!(p[0], 0);
            assert_eq!(p[2], 0);
        }
    }
    for y in 0..65 {
        for x in 40..65 {
            assert_eq!(pixel(&refracted, 65, x, y), &[0, 0, 0, 0]);
        }
    }
    let transparent = vec![0_u8; 65 * 65 * 4];
    assert_eq!(
        render(&context, &pipeline, &transparent, 65, 65, &[effect]),
        transparent
    );
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_seed_wind_phase_and_reverse_seek_are_stateless() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let input = pattern(65, 65, false);
    let draw = |effect| render(&context, &pipeline, &input, 65, 65, &[effect]);
    let settings = json!({"density":1,"speed":0.5});
    let initial = draw(pass(settings.clone(), 24000));
    let later = draw(pass(settings.clone(), 60000));
    assert!(changed_pixels(&initial, &later) > 100);
    let _ = draw(pass(settings.clone(), -4000));
    assert_eq!(initial, draw(pass(settings.clone(), 24000)));
    assert_eq!(later, draw(pass(settings.clone(), 63999)));
    let active = pass(settings, 24000);
    for entries in [
        vec![("seed", 2.0)],
        vec![("windX", 0.4)],
        vec![("windY", -0.4)],
        vec![("phase", 0.75)],
    ] {
        assert!(changed_pixels(&initial, &draw(changed(&active, &entries))) > 100);
    }
    let still = draw(pass(json!({"speed":0}), 0));
    assert_eq!(
        still,
        draw(pass(json!({"speed":0}), -9_007_199_254_740_991))
    );
    assert_ne!(still, draw(pass(json!({"speed":0,"windX":0.4}), 0)));
}

#[test]
#[ignore = "requires native GPU; run --test clouds_gpu -- --include-ignored"]
fn clouds_malformed_neutral_raw_passes_are_rejected_before_drawing() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let source = context.create_render_texture(8, 8, "clouds-invalid-source");
    let inactive = changed(&pass(json!({}), 0), &[("amount", 0.0), ("density", 0.0)]);
    let mut cases = Vec::new();
    for (key, value) in [
        ("seed", 1.5),
        ("scale", 0.0),
        ("windX", -16.1),
        ("windY", 16.1),
        ("refraction", 0.081),
        ("fogOpacity", 1.1),
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("speed", f32::INFINITY),
        ("unknown", 0.0),
    ] {
        cases.push(changed(&inactive, &[(key, value)]));
    }
    let mut missing = inactive.clone();
    missing.uniforms.remove("colorB");
    cases.push(missing);
    let mut vector = inactive;
    vector
        .uniforms
        .insert("phase".into(), UniformValue::Vector(vec![0.0]));
    cases.push(vector);
    for malformed in cases {
        assert!(
            pipeline
                .apply(
                    &context,
                    ApplyEffectsOptions {
                        source: &source,
                        width: 8,
                        height: 8,
                        passes: &[malformed.clone()]
                    }
                )
                .is_err(),
            "accepted {malformed:?}"
        );
    }
}
