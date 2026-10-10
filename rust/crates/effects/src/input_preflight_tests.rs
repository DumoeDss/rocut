use std::collections::BTreeMap;

use crate::{EffectPass, EffectsError, UniformValue, validate_effects_input};

fn generic_pass(shader: &str) -> EffectPass {
    EffectPass {
        shader: shader.into(),
        uniforms: Default::default(),
    }
}

fn bubble_pass() -> EffectPass {
    let params = BTreeMap::from([
        ("point0Time".into(), 0.0),
        ("point0X".into(), 0.5),
        ("point0Y".into(), 0.5),
    ]);
    let resolved = crate::bubble::resolve(&params, 0, time::FrameRate::FPS_30).unwrap();
    EffectPass {
        shader: "bubble".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .unwrap()
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
fn input_preflight_rejects_zero_and_device_limit_dimensions_for_every_shader() {
    for shader in [
        "gaussian-blur",
        "color-adjustment",
        "liquid",
        "bubble",
        "unknown",
    ] {
        for (width, height, maximum) in [
            (0, 1, 8192),
            (1, 0, 8192),
            (8193, 1, 8192),
            (1, 8193, 8192),
            (1, 1, 0),
            (u32::MAX, u32::MAX, 8192),
        ] {
            let error = validate_effects_input(width, height, maximum, &[generic_pass(shader)])
                .unwrap_err();
            assert!(
                matches!(error, EffectsError::InvalidInputDimensions { .. }),
                "{shader}: {error}"
            );
            assert_eq!(
                error.to_string(),
                format!(
                    "Invalid output dimensions: {width}x{height}; each dimension must be in 1..={maximum} (device max_texture_dimension_2d)"
                )
            );
        }
    }
}

#[test]
fn input_preflight_uses_actual_device_limit_not_a_global_bubble_cap() {
    let passes = [generic_pass("gaussian-blur")];
    assert!(validate_effects_input(8193, 1, 16384, &passes).is_ok());
    assert!(validate_effects_input(4096, 4096, 4096, &passes).is_ok());
    assert!(validate_effects_input(4097, 1, 4096, &passes).is_err());
    assert!(validate_effects_input(1, 4097, 4096, &passes).is_err());
}

#[test]
fn input_preflight_preserves_empty_pass_semantic_error() {
    let error = validate_effects_input(1, 1, 8192, &[]).unwrap_err();
    assert!(matches!(error, EffectsError::MissingEffectPasses));
    assert_eq!(error.to_string(), "At least one effect pass is required");
}

#[test]
fn input_preflight_checks_bubble_anywhere_in_the_stack_before_import() {
    for passes in [
        vec![bubble_pass()],
        vec![generic_pass("gaussian-blur"), bubble_pass()],
        vec![bubble_pass(), generic_pass("liquid")],
    ] {
        let error = validate_effects_input(8193, 1, 16384, &passes).unwrap_err();
        assert!(matches!(error, EffectsError::BubbleWorkBudget { .. }));
        assert!(error.to_string().contains("1..8192"));
    }
}

#[test]
fn input_preflight_reuses_bubble_pixel_and_work_admission_without_gpu() {
    let passes = [bubble_pass()];
    assert!(validate_effects_input(3840, 2160, 8192, &passes).is_ok());
    assert!(validate_effects_input(8192, 1024, 8192, &passes).is_ok());
    for (width, height) in [(4096, 4096), (8192, 1025)] {
        let error = validate_effects_input(width, height, 8192, &passes).unwrap_err();
        assert!(matches!(error, EffectsError::BubbleWorkBudget { .. }));
        assert!(error.to_string().contains("8388608-pixel"));
    }
}

#[test]
fn input_preflight_reuses_bubble_raw_uniform_validation() {
    let mut pass = bubble_pass();
    pass.uniforms
        .insert("ballCount".into(), UniformValue::Number(25.0));
    assert!(matches!(validate_effects_input(96, 64, 8192, &[pass]),
        Err(EffectsError::InvalidNumberUniform { uniform, .. }) if uniform == "ballCount"));
    let mut pass = bubble_pass();
    pass.uniforms.remove("center23X");
    assert!(matches!(validate_effects_input(96, 64, 8192, &[pass]),
        Err(EffectsError::MissingUniform { uniform, .. }) if uniform == "center23X"));
}

#[test]
fn input_preflight_does_not_claim_full_other_shader_validation() {
    assert!(validate_effects_input(96, 64, 8192, &[generic_pass("unknown")]).is_ok());
    assert!(validate_effects_input(96, 64, 8192, &[generic_pass("gaussian-blur")]).is_ok());
}

#[test]
fn input_preflight_rejections_do_not_mutate_later_valid_requests() {
    let passes = [bubble_pass()];
    assert!(validate_effects_input(8193, 1, 8192, &passes).is_err());
    assert!(validate_effects_input(96, 64, 8192, &passes).is_ok());
    assert!(validate_effects_input(4096, 4096, 8192, &passes).is_err());
    assert!(validate_effects_input(96, 64, 8192, &passes).is_ok());
    assert!(validate_effects_input(1, 1, 8192, &[]).is_err());
    assert!(validate_effects_input(96, 64, 8192, &passes).is_ok());
}
