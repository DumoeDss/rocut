use super::{
    catalog, pack_uniforms,
    tests::pass_at,
    uniforms::{self, BubbleUniformBuffer},
    validate_device_dimensions,
};
use crate::{EffectsError, UniformValue};

#[test]
fn bubble_uniform_layout_is_512_bytes_and_rectangular_centers_use_short_side_coordinates() {
    let buffer = pack_uniforms(&pass_at(&[], 0), 192, 128).unwrap();
    assert_eq!(std::mem::size_of::<BubbleUniformBuffer>(), 512);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, field), 16);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, optics), 32);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, decoration), 48);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, tint), 64);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, color_a), 80);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, color_b), 96);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, bounds), 112);
    assert_eq!(std::mem::offset_of!(BubbleUniformBuffer, centers), 128);
    assert_eq!(buffer.geometry, [192.0, 128.0, 128.0, 1.0]);
    assert_eq!(buffer.centers, [[0.75, 0.5, 0.0, 0.0]; 24]);
    let radius = (30.0 / 1080.0) as f32;
    assert_eq!(buffer.field[0], radius);
    assert_eq!(buffer.field[1], 1.0 + 7.0 * 13.0 / 23.0);
    assert_eq!(buffer.field[2], (0.02 * radius) * (0.02 * radius));
    assert_eq!(buffer.field[3], radius * radius + buffer.field[2]);
    assert_eq!(buffer.color_b[3], 24.0);
    assert_eq!(
        buffer.bounds,
        [
            0.75 - radius - 2.0 / 128.0,
            0.5 - radius - 2.0 / 128.0,
            0.75 + radius + 2.0 / 128.0,
            0.5 + radius + 2.0 / 128.0
        ]
    );
    let one = pack_uniforms(&pass_at(&[("trail", 1.0)], 0), 96, 256).unwrap();
    assert_eq!(one.centers[0], [0.5, 0.5 * 256.0 / 96.0, 0.0, 0.0]);
    assert_eq!(&one.centers[1..], &[[0.0; 4]; 23]);
}

#[test]
fn bubble_raw_optics_are_required_finite_in_range_even_when_amount_is_zero() {
    for field in catalog::optical_fields() {
        for value in [
            field.min as f32 - 1.0,
            field.max as f32 + 1.0,
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
        ] {
            let mut pass = pass_at(&[], 0);
            pass.uniforms
                .insert("amount".into(), UniformValue::Number(0.0));
            pass.uniforms
                .insert(field.key.into(), UniformValue::Number(value));
            assert!(
                pack_uniforms(&pass, 96, 64).is_err(),
                "{}={value}",
                field.key
            );
        }
    }
    let original = pass_at(&[], 0);
    for key in original.uniforms.keys() {
        let mut pass = original.clone();
        pass.uniforms.remove(key);
        assert!(matches!(
            pack_uniforms(&pass, 96, 64),
            Err(EffectsError::MissingUniform { .. })
        ));
        pass.uniforms
            .insert(key.clone(), UniformValue::Vector(vec![0.0]));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
    }
    for (key, value) in [
        ("phase", -0.1),
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("ballCount", 0.0),
        ("ballCount", 24.1),
        ("ballCount", 1.5),
        ("center0X", 2.01),
        ("center0Y", -1.01),
        ("center23X", f32::INFINITY),
    ] {
        let mut pass = original.clone();
        pass.uniforms
            .insert(key.into(), UniformValue::Number(value));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
    }
}

#[test]
fn bubble_raw_inactive_centers_and_schedule_fields_are_rejected_not_ignored() {
    for key in [
        "center1X",
        "center23Y",
        "center24X",
        "point0Time",
        "phaseSeconds",
        "speed",
        "follow",
        "startTicks",
        "frame",
        "seed",
    ] {
        let mut pass = pass_at(&[("trail", 1.0)], 0);
        pass.uniforms.insert(key.into(), UniformValue::Number(0.0));
        assert!(
            matches!(
                pack_uniforms(&pass, 96, 64),
                Err(EffectsError::UnsupportedUniform { .. })
            ),
            "{key}"
        );
    }
    let mut pass = pass_at(&[], 0);
    pass.shader = "blaze".into();
    assert!(matches!(
        pack_uniforms(&pass, 96, 64),
        Err(EffectsError::UnknownEffectShader { .. })
    ));
}

#[test]
fn bubble_work_budgets_cover_field_texture_and_target_bytes_before_gpu_allocation() {
    let full = uniforms::work_budget(3840, 2160, 24, true, true).unwrap();
    assert_eq!(full.pixels, 8_294_400);
    assert_eq!(full.field_terms, 199_065_600);
    assert_eq!(full.bilinear_samples, 223_948_800);
    assert_eq!(full.texel_loads, 895_795_200);
    assert_eq!(full.target_bytes, 33_177_600);
    for (dispersion, frost, samples) in [
        (false, false, 1),
        (true, false, 3),
        (false, true, 9),
        (true, true, 27),
    ] {
        assert_eq!(
            uniforms::work_budget(1, 1, 24, dispersion, frost)
                .unwrap()
                .bilinear_samples,
            samples
        );
    }
    let pass = pass_at(&[("frost", 1.0)], 0);
    for (width, height) in [
        (0, 64),
        (64, 0),
        (8193, 1),
        (1, 8193),
        (4096, 2049),
        (8192, 8192),
        (u32::MAX, u32::MAX),
    ] {
        assert!(matches!(
            crate::pipeline::pack_effect_uniforms(&pass, width, height),
            Err(EffectsError::BubbleWorkBudget { .. })
        ));
    }
    for (width, height) in [(1, 1), (8192, 1), (1, 8192), (4096, 2048), (8192, 1024)] {
        assert!(pack_uniforms(&pass, width, height).is_ok());
    }
    assert!(validate_device_dimensions(4096, 2048, 4096).is_ok());
    assert!(matches!(
        validate_device_dimensions(4097, 1, 4096),
        Err(EffectsError::BubbleWorkBudget { .. })
    ));
}

#[test]
fn bubble_pipeline_source_orders_preflight_before_target_and_uniform_allocation() {
    let source = include_str!("../pipeline.rs");
    let preparation = source
        .find("let packed_uniforms = pack_effect_uniforms(pass, width, height)?;")
        .unwrap();
    let target = source
        .find("context.create_render_texture(width, height, \"effects-pass-output\")")
        .unwrap();
    let buffer = source.find(".create_buffer_init(").unwrap();
    let lookup = source[preparation..]
        .find("self.pipelines.get(&pass.shader)")
        .unwrap()
        + preparation;
    let adapter = source[preparation..]
        .find("crate::bubble::validate_device_dimensions")
        .unwrap()
        + preparation;
    assert!(preparation < target && lookup < target && adapter < target && target < buffer);
}
