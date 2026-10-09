mod support;
use effects::{EffectPass, EffectPipeline, UniformValue, resolve_stylized_effect_json};
use gpu::GpuContext;
use serde_json::{Value, json};
use support::{block_on, render};

fn pass(kind: &str, params: Value) -> EffectPass {
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":kind,"params":params,"localTime":0,
            "frameRate":{"numerator":30,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: kind.into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .expect("resolved magnify pass")
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect(),
    }
}

#[test]
#[ignore = "requires native GPU; run --test magnify_gpu -- --include-ignored"]
fn magnify_reuses_lens_sampling_and_pulse_has_a_coordinate_oracle() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input: Vec<u8> = (0..16)
        .flat_map(|y| (0..32).flat_map(move |x| [x * 8, y * 16, 80, 255]))
        .collect();
    let draw = |kind, params| render(&context, &pipeline, &input, 32, 16, &[pass(kind, params)]);
    let optics = json!({"zoom":2,"refraction":0.4,"dispersion":0.05,"radius":0.4,"feather":0.2});
    let mut magnify = optics.clone();
    magnify["hud"] = json!(0);
    magnify["pulse"] = json!(0);
    assert_eq!(draw("magnify", magnify), draw("lens", optics));
    assert_eq!(draw("magnify", json!({"zoom":1,"hud":0})), input);
    assert_eq!(draw("magnify", json!({"radius":0,"pulse":1})), input);
    let pulsed = draw(
        "magnify",
        json!({"zoom":2,"hud":0,"pulse":1,"radius":0.375,"feather":0}),
    );
    for y in 0..16usize {
        for x in 0..32usize {
            let i = (y * 32 + x) * 4;
            let dx = x as f32 + 0.5 - 16.0;
            let dy = y as f32 + 0.5 - 8.0;
            if dx * dx + dy * dy >= 36.0 {
                assert_eq!(&pulsed[i..i + 4], &input[i..i + 4]);
            } else {
                assert!((f32::from(pulsed[i]) - (15.5 + dx / 2.7) * 8.0).abs() <= 1.1);
                assert!((f32::from(pulsed[i + 1]) - (7.5 + dy / 2.7) * 16.0).abs() <= 1.1);
            }
        }
    }
    assert_ne!(
        pulsed,
        draw(
            "magnify",
            json!({"zoom":2,"hud":0,"pulse":0,"radius":0.375,"feather":0})
        )
    );
}

#[test]
#[ignore = "requires native GPU; run --test magnify_gpu -- --include-ignored"]
fn hud_is_local_antialiased_alpha_composited_and_independently_editable() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = vec![0u8; 128 * 64 * 4];
    let draw = |params| {
        render(
            &context,
            &pipeline,
            &input,
            128,
            64,
            &[pass("magnify", params)],
        )
    };
    let params = json!({"zoom":1,"radius":0.4,"feather":0,"hud":1,"lineWidth":1.5});
    let hud = draw(params.clone());
    let mut visible = 0;
    let mut partial = 0;
    for y in 0..64usize {
        for x in 0..128usize {
            let p = &hud[(y * 128 + x) * 4..(y * 128 + x) * 4 + 4];
            if (x as f32 + 0.5 - 64.0).powi(2) + (y as f32 + 0.5 - 32.0).powi(2) >= 25.6f32.powi(2)
            {
                assert_eq!(p, &[0, 0, 0, 0], "HUD escaped region {x},{y}");
            }
            if p[3] > 0 {
                visible += 1;
                if p[3] < 255 {
                    partial += 1;
                }
                assert!(
                    p[0].abs_diff(38) <= 1 && p[1].abs_diff(217) <= 1 && p[2] == 255,
                    "straight alpha {p:?}"
                );
            }
        }
    }
    assert!(visible > 300 && partial > 50, "{visible}/{partial}");
    assert!(hud[(31 * 128 + 86) * 4 + 3] > 180, "visible circumference");
    assert!(hud[(31 * 128 + 66) * 4 + 3] > 180, "visible crosshair");
    let mut half_params = params.clone();
    half_params["hud"] = json!(0.5);
    let half = draw(half_params);
    for (full, half) in hud.chunks_exact(4).zip(half.chunks_exact(4)) {
        assert!((f32::from(full[3]) * 0.5 - f32::from(half[3])).abs() <= 1.0);
    }
    let mut wide = params.clone();
    wide["lineWidth"] = json!(4);
    assert!(draw(wide).chunks_exact(4).filter(|p| p[3] > 0).count() > visible);
    let mut impulse = params.clone();
    impulse["pulse"] = json!(1);
    assert_ne!(draw(impulse), hud);
    assert_eq!(draw(params), hud, "seek/order independence");
}
