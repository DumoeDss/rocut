mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(params: Value) -> EffectPass {
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"displacement", "params":params, "localTime":0,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "displacement".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .expect("displacement pass")
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}

fn gradient() -> Vec<u8> {
    (0..64)
        .flat_map(|y| (0..64).flat_map(move |x| [x * 4, y * 4, x * 4, 255]))
        .collect()
}

fn pixel(image: &[u8], x: usize, y: usize) -> &[u8] {
    let index = (y * 64 + x) * 4;
    &image[index..index + 4]
}

fn close(actual: u8, expected: f32) {
    assert!(
        (f32::from(actual) - expected).abs() <= 1.1,
        "{actual} != {expected}"
    );
}

#[test]
#[ignore = "requires native GPU; run --test displacement_gpu -- --include-ignored"]
fn displacement_resamples_the_input_grid_and_splits_color_rays() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let input = gradient();
    let draw = |params| render(&context, &pipeline, &input, 64, 64, &[pass(params)]);
    let positive = draw(json!({"cellSize":8.5,"displacement":0.125,"radius":2,"feather":0}));
    // At lattice (3,3), seed 1 specifies direction (-0.719974, 0.694001).
    // The image is a coordinate ruler: eight pixels of displacement should
    // move red/blue 23.0392 levels left and green 22.2080 levels down.
    let p = pixel(&positive, 25, 25);
    for (actual, expected) in p.iter().zip([76.9608, 122.2080, 76.9608, 255.0]) {
        close(*actual, expected);
    }
    let negative = draw(json!({"cellSize":8.5,"displacement":-0.125,"radius":2,"feather":0}));
    for (actual, expected) in pixel(&negative, 25, 25)
        .iter()
        .zip([123.0392, 77.7920, 123.0392, 255.0])
    {
        close(*actual, expected);
    }
    let dispersed =
        draw(json!({"cellSize":8.5,"displacement":0.125,"dispersion":0.1,"radius":2,"feather":0}));
    for (actual, expected) in pixel(&dispersed, 25, 25)
        .iter()
        .zip([74.6569, 122.2080, 79.2648, 255.0])
    {
        close(*actual, expected);
    }
    let half =
        draw(json!({"cellSize":8.5,"displacement":0.125,"amount":0.5,"radius":2,"feather":0}));
    for y in 12..52 {
        for x in 12..52 {
            for channel in 0..4 {
                close(
                    pixel(&half, x, y)[channel],
                    (f32::from(pixel(&positive, x, y)[channel])
                        + f32::from(pixel(&input, x, y)[channel]))
                        / 2.0,
                );
            }
        }
    }
    assert_ne!(
        draw(json!({"cellSize":16.5,"displacement":0.125,"radius":2,"feather":0})),
        positive,
        "grid spacing must change source coordinates"
    );
}

#[test]
#[ignore = "requires native GPU; run --test displacement_gpu -- --include-ignored"]
fn displacement_preserves_neutral_pixels_and_circular_bounds_with_soft_edges() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = gradient();
    let draw = |params| render(&context, &pipeline, &input, 64, 64, &[pass(params)]);
    assert_eq!(draw(json!({"displacement":0,"dispersion":0.1})), input);
    assert_eq!(draw(json!({"radius":0})), input);
    let mut zero = pass(json!({"dispersion":0.1}));
    zero.uniforms
        .insert("amount".into(), UniformValue::Number(0.0));
    assert_eq!(render(&context, &pipeline, &input, 64, 64, &[zero]), input);
    let region = json!({"centerX":0.35,"centerY":0.6,"radius":0.2,"feather":0,"cellSize":8.5,"displacement":0.125});
    let hard = draw(region.clone());
    let mut soft_region = region.clone();
    soft_region["feather"] = json!(0.6);
    let soft = draw(soft_region);
    let mut affected = 0;
    let mut feathered = 0;
    for y in 0..64 {
        for x in 0..64 {
            let distance =
                ((x as f32 + 0.5 - 22.4).powi(2) + (y as f32 + 0.5 - 38.4).powi(2)).sqrt();
            let original = pixel(&input, x, y);
            let result = pixel(&hard, x, y);
            if distance >= 12.8 {
                assert_eq!(result, original, "outside circle: {x},{y}");
                assert_eq!(pixel(&soft, x, y), original);
            } else {
                affected += usize::from(result != original);
                if distance > 5.12 {
                    let w = ((distance - 5.12) / 7.68).clamp(0.0, 1.0);
                    let weight = 1.0 - w * w * (3.0 - 2.0 * w);
                    for channel in 0..3 {
                        close(
                            pixel(&soft, x, y)[channel],
                            f32::from(original[channel]) * (1.0 - weight)
                                + f32::from(result[channel]) * weight,
                        );
                    }
                    feathered +=
                        usize::from(pixel(&soft, x, y) != result && pixel(&soft, x, y) != original);
                }
            }
        }
    }
    assert!(affected > 300, "input inside the circle must be displaced");
    assert!(
        feathered > 100,
        "soft edge must blend actual displaced input"
    );
    assert_ne!(
        draw(
            json!({"centerX":0.6,"centerY":0.35,"radius":0.2,"feather":0,"cellSize":8.5,"displacement":0.125})
        ),
        hard
    );
}

#[test]
#[ignore = "requires native GPU; run --test displacement_gpu -- --include-ignored"]
fn displacement_uses_premultiplied_taps_and_transparent_outside_bounds() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..64)
        .flat_map(|_| {
            (0..64).flat_map(|x| {
                if x < 20 {
                    [255, 0, 0, 255]
                } else {
                    [0, 255, 0, 0]
                }
            })
        })
        .collect();
    let params = json!({"cellSize":8.5,"displacement":0.125,"radius":2,"feather":0});
    let output = render(&context, &pipeline, &input, 64, 64, &[pass(params.clone())]);
    let p = pixel(&output, 25, 25);
    assert_eq!(
        &p[..3],
        &[255, 0, 0],
        "hidden green must not bleed into a red alpha edge"
    );
    close(p[3], 193.7467);
    let mut half = params.clone();
    half["amount"] = json!(0.5);
    let half = render(&context, &pipeline, &input, 64, 64, &[pass(half)]);
    assert_eq!(&pixel(&half, 25, 25)[..3], &[255, 0, 0]);
    close(pixel(&half, 25, 25)[3], 96.87335);
    let white: Vec<u8> = (0..64)
        .flat_map(|_| {
            (0..64).flat_map(|x| {
                if x < 20 {
                    [255, 255, 255, 255]
                } else {
                    [255, 0, 255, 0]
                }
            })
        })
        .collect();
    let mut chromatic = params;
    chromatic["dispersion"] = json!(0.1);
    let chromatic = render(&context, &pipeline, &white, 64, 64, &[pass(chromatic)]);
    // Spectral samples straddle the alpha edge; one shared coverage carries
    // premultiplied R/G/B instead of letting a hidden color become visible.
    for (actual, expected) in pixel(&chromatic, 25, 25)
        .iter()
        .zip([255.0, 193.7467, 46.8721, 255.0])
    {
        close(*actual, expected);
    }
    for p in output.chunks_exact(4) {
        assert_eq!(p[1], 0);
        assert_eq!(p[2], 0);
    }
    assert_eq!(pixel(&output, 63, 32), &[0, 0, 0, 0]);
    let solid = [255, 0, 0, 255].repeat(64 * 64);
    let outside = render(
        &context,
        &pipeline,
        &solid,
        64,
        64,
        &[pass(
            json!({"cellSize":8.5,"displacement":0.125,"radius":2,"feather":0}),
        )],
    );
    assert_eq!(
        pixel(&outside, 0, 0),
        &[0, 0, 0, 0],
        "out-of-input rays must not clamp or wrap"
    );
    assert!(outside.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255));
    let neutral = render(
        &context,
        &pipeline,
        &input,
        64,
        64,
        &[pass(json!({"displacement":0,"dispersion":0.1}))],
    );
    assert_eq!(neutral, input, "neutral preserves hidden RGB exactly");
}

#[test]
#[ignore = "requires native GPU; run --test displacement_gpu -- --include-ignored"]
fn seed_and_authored_spatial_values_repeat_under_reverse_parameter_order() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = gradient();
    let states = [
        json!({"seed":9,"centerX":0.2,"centerY":0.3,"radius":0.3,"cellSize":8.5}),
        json!({"seed":9,"centerX":0.5,"centerY":0.5,"radius":0.4,"cellSize":12.75}),
        json!({"seed":9,"centerX":0.8,"centerY":0.7,"radius":0.5,"cellSize":17.5}),
    ];
    let frames: Vec<_> = states
        .iter()
        .map(|params| render(&context, &pipeline, &input, 64, 64, &[pass(params.clone())]))
        .collect();
    for index in [2, 1, 0, 2, 0, 1] {
        let mut p = pass(states[index].clone());
        p.uniforms
            .insert("frame".into(), UniformValue::Number(1234.0));
        assert_eq!(
            render(&context, &pipeline, &input, 64, 64, &[p]),
            frames[index],
            "explicit values, not sample history or raw clock, control the field"
        );
    }
    let mut different = states[1].clone();
    different["seed"] = json!(10);
    assert_ne!(
        render(&context, &pipeline, &input, 64, 64, &[pass(different)]),
        frames[1]
    );
}
