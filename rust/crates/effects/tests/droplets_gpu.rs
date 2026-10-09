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
    eprintln!("Droplets GPU adapter: {info:?}");
    if std::env::var("WGPU_BACKEND").as_deref() == Ok("vulkan") {
        assert_eq!(info.backend, wgpu::Backend::Vulkan);
    }
    context
}

fn pass(changes: Value, ticks: i64) -> EffectPass {
    let mut params = json!({"count":1,"radius":0.1,"elongation":1.5,
        "speed":0.5,"refraction":0.1,"highlight":0,"seed":1});
    for (key, value) in changes.as_object().unwrap() {
        params[key] = value.clone();
    }
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"droplets","params":params,"localTime":ticks,
            "frameRate":{"numerator":30,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "droplets".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .unwrap_or_else(|| panic!("expected active Droplets pass: {resolved}"))
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

fn centered_pass() -> EffectPass {
    // Frozen independent u32 mixer vector: seed 1, index 0 initial phase.
    // This representable raw phase places the complete ellipse at mid-height.
    changed(&pass(json!({}), 0), &[("phase", 0.6506048440933228)])
}

fn source(width: u32, height: u32, hidden_rgb: bool) -> Vec<u8> {
    (0..height)
        .flat_map(|y| {
            (0..width).flat_map(move |x| {
                [
                    (x * 4 % 256) as u8,
                    (y * 4 % 256) as u8,
                    if (x / 5 + y / 7) % 2 == 0 { 32 } else { 224 },
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

fn pixel(bytes: &[u8], x: usize, y: usize) -> &[u8] {
    &bytes[(y * 64 + x) * 4..][..4]
}

fn changed_pixels(left: &[u8], right: &[u8]) -> usize {
    left.chunks_exact(4)
        .zip(right.chunks_exact(4))
        .filter(|(a, b)| a != b)
        .count()
}

#[test]
#[ignore = "requires native GPU; run --test droplets_gpu -- --include-ignored"]
fn droplets_noop_uniforms_are_exact_identity_including_hidden_rgb() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let active = centered_pass();
    for (width, height) in [(96, 64), (64, 96), (93, 62)] {
        let input = source(width, height, true);
        for (label, inactive) in [
            ("amount", changed(&active, &[("amount", 0.0)])),
            ("count", changed(&active, &[("count", 0.0)])),
            (
                "optics",
                changed(&active, &[("refraction", 0.0), ("highlight", 0.0)]),
            ),
        ] {
            assert_eq!(
                render(&context, &pipeline, &input, width, height, &[inactive]),
                input,
                "{label} no-op must preserve all bytes at {width}x{height}"
            );
        }
    }
}

#[test]
#[ignore = "requires native GPU; run --test droplets_gpu -- --include-ignored"]
fn droplets_refract_real_texture_with_independent_coordinate_and_footprint_checks() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let input = source(64, 64, false);
    let active = centered_pass();
    let output = render(&context, &pipeline, &input, 64, 64, &[active.clone()]);
    assert!(
        changed_pixels(&output, &input) > 80,
        "lens must change a nonconstant input"
    );
    // Independent seed/index hash constants, not values read from packed uniforms.
    let cx = 0.3577302098274231 * 64.0;
    let rx = f64::from(0.1_f32) * 1.114522099494934 * 64.0;
    let ry = rx * 1.5;
    let (qx, qy) = ((26.5 - cx) / rx, 0.5 / ry);
    let envelope = (1.0 - qx * qx - qy * qy).powi(2);
    let offset = [-qx * envelope * 6.4, -qy * envelope * 6.4];
    let actual = pixel(&output, 26, 32);
    for (channel, expected) in [(0, (26.0 + offset[0]) * 4.0), (1, (32.0 + offset[1]) * 4.0)] {
        assert!(
            (f64::from(actual[channel]) - expected).abs() <= 1.1,
            "affine texture sample channel {channel}: {actual:?}, expected {expected}"
        );
    }
    assert_eq!(actual[3], 255);
    for y in 0..64 {
        for x in 0..64 {
            if !(15..=30).contains(&x) || !(20..=43).contains(&y) {
                assert_eq!(
                    pixel(&output, x, y),
                    pixel(&input, x, y),
                    "escaped footprint at {x},{y}"
                );
            }
        }
    }
    let alternate: Vec<u8> = input
        .chunks_exact(4)
        .flat_map(|p| [255 - p[2], 255 - p[0], p[1], p[3]])
        .collect();
    let other = render(&context, &pipeline, &alternate, 64, 64, &[active]);
    assert!(
        changed_pixels(&other, &alternate) > 80,
        "second input must also be sampled"
    );
    assert!(
        changed_pixels(&other, &output) > 3000,
        "output cannot be a detached overlay"
    );
}

#[test]
#[ignore = "requires native GPU; run --test droplets_gpu -- --include-ignored"]
fn droplets_alpha_sampling_has_no_hidden_color_and_highlight_adds_no_opacity() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let active = centered_pass();
    let transparent = vec![0_u8; 64 * 64 * 4];
    assert_eq!(
        render(
            &context,
            &pipeline,
            &transparent,
            64,
            64,
            &[changed(&active, &[("count", 64.0), ("highlight", 1.0)])]
        ),
        transparent
    );
    let input: Vec<u8> = (0..64)
        .flat_map(|_| {
            (0..64).flat_map(|x| {
                if x < 25 {
                    [0, 255, 0, 128]
                } else {
                    [255, 0, 255, 0]
                }
            })
        })
        .collect();
    let output = render(&context, &pipeline, &input, 64, 64, &[active.clone()]);
    let edge = pixel(&output, 26, 32);
    assert!(
        edge[3] > 0 && edge[3] < 128,
        "must sample partially across the alpha edge: {edge:?}"
    );
    for (actual, original) in output.chunks_exact(4).zip(input.chunks_exact(4)) {
        if actual[3] > 0 {
            assert_eq!(
                &actual[..3],
                &[0, 255, 0],
                "hidden magenta leaked: {actual:?}"
            );
        } else if actual != original {
            assert_eq!(actual, &[0, 0, 0, 0]);
        }
    }
    let translucent: Vec<u8> = (0..64 * 64).flat_map(|_| [15, 25, 35, 64]).collect();
    let highlighted = render(
        &context,
        &pipeline,
        &translucent,
        64,
        64,
        &[changed(&active, &[("refraction", 0.0), ("highlight", 1.0)])],
    );
    assert!(
        changed_pixels(&highlighted, &translucent) > 3,
        "highlight must be visible"
    );
    assert!(
        highlighted.chunks_exact(4).all(|p| p[3] == 64),
        "highlight cannot create alpha"
    );
}

#[test]
#[ignore = "requires native GPU; run --test droplets_gpu -- --include-ignored"]
fn droplets_frame_seed_and_seek_order_control_the_same_stateless_image() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let input = source(64, 64, false);
    let draw = |effect| render(&context, &pipeline, &input, 64, 64, &[effect]);
    let initial = draw(pass(json!({"count":8}), 24000));
    let later = draw(pass(json!({"count":8}), 60000));
    assert!(
        changed_pixels(&initial, &later) > 80,
        "clock must move footprints"
    );
    let _ = draw(pass(json!({"count":8}), -4000));
    assert_eq!(
        initial,
        draw(pass(json!({"count":8}), 24000)),
        "reverse seek must reproduce the same frame"
    );
    assert_eq!(
        later,
        draw(pass(json!({"count":8}), 63999)),
        "subframe time floors on rational grid"
    );
    assert!(
        changed_pixels(&initial, &draw(pass(json!({"count":8,"seed":2}), 24000))) > 80,
        "seed must change the placement"
    );
    let static_initial = draw(pass(json!({"speed":0}), 0));
    assert_eq!(
        static_initial,
        draw(pass(json!({"speed":0}), -9007199254740991)),
        "zero speed is static"
    );
    let centered = centered_pass();
    assert_ne!(
        draw(centered.clone()),
        draw(changed(&centered, &[("phase", 0.25)])),
        "raw phase is used"
    );
}

#[test]
#[ignore = "requires native GPU; run --test droplets_gpu -- --include-ignored"]
fn droplets_pipeline_rejects_invalid_raw_passes_before_noop_drawing() {
    let context = gpu_context();
    let pipeline = EffectPipeline::new(&context);
    let source = context.create_render_texture(8, 8, "droplets-invalid-source");
    let inactive = changed(&centered_pass(), &[("amount", 0.0), ("count", 0.0)]);
    let mut cases = Vec::new();
    for (key, value) in [
        ("count", -1.0),
        ("count", 0.5),
        ("count", 65.0),
        ("seed", 1.5),
        ("radius", 0.0),
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("speed", f32::INFINITY),
        ("typo", 0.0),
    ] {
        cases.push(changed(&inactive, &[(key, value)]));
    }
    let mut missing = inactive.clone();
    missing.uniforms.remove("highlight");
    cases.push(missing);
    let mut vector = inactive;
    vector
        .uniforms
        .insert("phase".into(), UniformValue::Vector(vec![0.0]));
    cases.push(vector);
    for malformed in cases {
        let result = pipeline.apply(
            &context,
            ApplyEffectsOptions {
                source: &source,
                width: 8,
                height: 8,
                passes: &[malformed.clone()],
            },
        );
        assert!(
            result.is_err(),
            "accepted malformed inactive pass: {malformed:?}"
        );
    }
}
