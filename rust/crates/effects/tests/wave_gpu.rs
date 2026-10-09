mod support;

use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(kind: &str, changes: Value) -> EffectPass {
    let mut params = json!({"speed":0.25,"wavelength":0.25,"width":0.25,"refraction":0.1,"decay":0,"lifetime":2,
        "eventCount":1,"event0Time":0,"event0X":0.5078125,"event0Y":0.4921875,"event0Amplitude":1});
    for (key, value) in changes.as_object().unwrap() {
        params[key] = value.clone();
    }
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(json!({
        "effectType":kind,"params":params,"localTime":60000,"frameRate":{"numerator":30,"denominator":1}
    }).to_string())).unwrap();
    EffectPass {
        shader: kind.into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .expect("active wave pass")
            .iter()
            .map(|(key, value)| {
                let value = if let Some(items) = value.as_array() {
                    UniformValue::Vector(
                        items
                            .iter()
                            .map(|item| item.as_f64().unwrap() as f32)
                            .collect(),
                    )
                } else {
                    UniformValue::Number(value.as_f64().unwrap() as f32)
                };
                (key.clone(), value)
            })
            .collect(),
    }
}

fn ramp() -> Vec<u8> {
    (0..64u8)
        .flat_map(|y| (0..64u8).flat_map(move |x| [x * 4, y * 4, 80, 255]))
        .collect()
}

fn pixel(bytes: &[u8], x: usize, y: usize) -> &[u8] {
    &bytes[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4]
}

#[test]
#[ignore = "requires native GPU; run --test wave_gpu -- --include-ignored"]
fn radial_refraction_has_independent_coordinate_and_compact_support_oracles() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = ramp();
    let base_pass = pass("ripple", json!({}));
    let output = render(&context, &pipeline, &input, 64, 64, &[base_pass.clone()]);
    // Front radius is 8 px; these samples are 12 px from the impact center.
    // Quarter wavelength gives sin = 1, spatial bump = (15/16)^2,
    // age/lifetime = 1/4 gives temporal amplitude = 9/16.
    let offset = 64.0 * 0.1 * (15.0f32 / 16.0).powi(2) * 9.0 / 16.0;
    for (x, y, red, green) in [
        (44, 31, (44.0 + offset) * 4.0, 124.0),
        (20, 31, (20.0 - offset) * 4.0, 124.0),
        (32, 43, 128.0, (43.0 + offset) * 4.0),
    ] {
        let p = pixel(&output, x, y);
        assert!(
            (f32::from(p[0]) - red).abs() <= 1.1 && (f32::from(p[1]) - green).abs() <= 1.1,
            "{x},{y}: {p:?} expected {red},{green}"
        );
        assert_eq!(p[3], 255);
    }
    for y in 0..64 {
        for x in 0..64 {
            if (x as f32 - 32.0).powi(2) + (y as f32 - 31.0).powi(2) >= 24.0f32.powi(2) {
                assert_eq!(
                    pixel(&output, x, y),
                    pixel(&input, x, y),
                    "escaped compact support"
                );
            }
        }
    }
    assert_ne!(output, input, "must refract real input");
    for age in [-1.0, 0.0, 2.0] {
        let mut idle = base_pass.clone();
        if let UniformValue::Vector(events) = idle.uniforms.get_mut("events").unwrap() {
            events[2] = age;
        }
        assert_eq!(render(&context, &pipeline, &input, 64, 64, &[idle]), input);
    }
    let mut zero = base_pass.clone();
    zero.uniforms
        .insert("amount".into(), UniformValue::Number(0.0));
    assert_eq!(render(&context, &pipeline, &input, 64, 64, &[zero]), input);
    assert_eq!(
        render(&context, &pipeline, &input, 64, 64, &[base_pass]),
        output
    );
}

#[test]
#[ignore = "requires native GPU; run --test wave_gpu -- --include-ignored"]
fn multiple_impacts_superpose_and_can_cancel_before_sampling() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = ramp();
    let draw = |p| render(&context, &pipeline, &input, 64, 64, &[p]);
    let single = draw(pass("ripple", json!({})));
    let double = json!({"eventCount":2,"event0Amplitude":0.5,"event1Time":0,"event1X":0.5078125,"event1Y":0.4921875,"event1Amplitude":0.5});
    assert_eq!(
        draw(pass("ripple", double.clone())),
        single,
        "two halves must equal one full impact"
    );
    let mut cancel = double;
    cancel["event1Amplitude"] = json!(-0.5);
    assert_eq!(
        draw(pass("ripple", cancel)),
        input,
        "opposite impacts cancel, not two sequential refractions"
    );
    let separated = pass(
        "ripple",
        json!({"eventCount":2,"event1Time":24000,"event1X":0.75,"event1Y":0.2,"event1Amplitude":-0.75}),
    );
    let mixed = draw(separated.clone());
    assert_ne!(mixed, single);
    let _ = draw(pass("ripple", json!({"event0Time":24000})));
    assert_eq!(
        draw(separated),
        mixed,
        "out-of-order evaluation is stateless"
    );
}

#[test]
#[ignore = "requires native GPU; run --test wave_gpu -- --include-ignored"]
fn refraction_preserves_straight_alpha_without_hidden_rgb_fringe() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..64)
        .flat_map(|_| {
            (0..64).flat_map(|x| {
                if x < 47 {
                    [0, 255, 0, 128]
                } else {
                    [255, 0, 255, 0]
                }
            })
        })
        .collect();
    let output = render(
        &context,
        &pipeline,
        &input,
        64,
        64,
        &[pass("ripple", json!({}))],
    );
    let edge = pixel(&output, 43, 31);
    assert!(
        edge[3] > 0 && edge[3] < 128,
        "expected partially refracted alpha at boundary: {edge:?}"
    );
    for (p, original) in output.chunks_exact(4).zip(input.chunks_exact(4)) {
        if p[3] > 0 {
            assert_eq!(&p[..3], &[0, 255, 0], "transparent magenta leaked: {p:?}");
        }
        if p[3] == 0 && p != original {
            assert_eq!(p, &[0, 0, 0, 0]);
        }
    }
    let transparent = vec![0u8; 64 * 64 * 4];
    assert_eq!(
        render(
            &context,
            &pipeline,
            &transparent,
            64,
            64,
            &[pass("ripple", json!({}))]
        ),
        transparent
    );
}

#[test]
#[ignore = "requires native GPU; run --test wave_gpu -- --include-ignored"]
fn force_field_combines_input_refraction_with_optional_colored_ring_and_glow() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = ramp();
    let draw = |bytes: &[u8], p| render(&context, &pipeline, bytes, 64, 64, &[p]);
    assert_eq!(
        draw(
            &input,
            pass("force-field", json!({"ringOpacity":0,"glow":0}))
        ),
        draw(&input, pass("ripple", json!({})))
    );
    let blank = vec![0u8; 64 * 64 * 4];
    let optical = draw(
        &blank,
        pass(
            "force-field",
            json!({"refraction":0,"ringOpacity":1,"glow":0,"colorR":1,"colorG":0.25,"colorB":0}),
        ),
    );
    let front = pixel(&optical, 40, 31);
    assert!(
        front[3].abs_diff(110) <= 1,
        "ring center has 1-exp(-9/16) opacity: {front:?}"
    );
    assert_eq!(front[0], 255);
    assert!(front[1].abs_diff(64) <= 1);
    assert_eq!(front[2], 0);
    let glowing = draw(
        &blank,
        pass(
            "force-field",
            json!({"refraction":0,"ringOpacity":1,"glow":1,"colorR":1,"colorG":0.25,"colorB":0}),
        ),
    );
    assert!(pixel(&glowing, 44, 31)[3] > pixel(&optical, 44, 31)[3]);
    assert_eq!(pixel(&glowing, 63, 63), &[0, 0, 0, 0]);
    let with_input = draw(&input, pass("force-field", json!({})));
    assert_ne!(with_input, input);
    assert_ne!(
        with_input,
        draw(&blank, pass("force-field", json!({}))),
        "not a detached overlay"
    );
}
