use super::tests::pass_at;
use super::{definition, pack_uniforms};
use crate::{EffectsError, UniformValue};

#[test]
fn clouds_raw_uniforms_reject_unknown_missing_wrong_type_and_range() {
    let active = pass_at(&[], 0);
    for field in definition().fields {
        for bad in [
            field.min as f32 - 1.0,
            field.max as f32 + 1.0,
            f32::NAN,
            f32::INFINITY,
        ] {
            for neutral in ["amount", "density"] {
                let mut pass = active.clone();
                pass.uniforms
                    .insert(neutral.into(), UniformValue::Number(0.0));
                pass.uniforms
                    .insert(field.key.into(), UniformValue::Number(bad));
                assert!(pack_uniforms(&pass, 96, 64).is_err(), "{}={bad}", field.key);
            }
        }
    }
    for key in definition()
        .fields
        .into_iter()
        .map(|f| f.key)
        .chain(["phase"])
    {
        let mut pass = active.clone();
        pass.uniforms
            .insert("amount".into(), UniformValue::Number(0.0));
        pass.uniforms
            .insert(key.into(), UniformValue::Vector(vec![0.0]));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
        pass.uniforms.remove(key);
        assert!(matches!(
            pack_uniforms(&pass, 96, 64),
            Err(EffectsError::MissingUniform { .. })
        ));
    }
    for (key, value) in [
        ("seed", 0.5),
        ("phase", -0.1),
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("phase", f32::INFINITY),
        ("unknown", 1.0),
    ] {
        let mut pass = active.clone();
        pass.uniforms
            .insert(key.into(), UniformValue::Number(value));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
    }
    let mut wrong = active.clone();
    wrong.shader = "droplets".into();
    assert!(pack_uniforms(&wrong, 96, 64).is_err());
}

#[test]
fn clouds_resolution_budget_and_full_header_are_exact() {
    let pass = pass_at(
        &[
            ("windX", -16.0),
            ("windY", 16.0),
            ("colorR", 0.2),
            ("colorG", 0.4),
            ("colorB", 0.6),
        ],
        0,
    );
    let buffer = pack_uniforms(&pass, 96, 64).unwrap();
    assert_eq!(buffer.geometry, [96.0, 64.0, 0.3, 0.0]);
    assert_eq!(buffer.optics, [1.0, 0.5, 0.015, 0.45]);
    assert_eq!(buffer.wind_color, [-16.0, 16.0, 0.2, 0.4]);
    assert_eq!(buffer.color_reserved, [0.6, 0.0, 0.0, 0.0]);
    for (w, h) in [
        (0, 64),
        (96, 0),
        (8193, 1),
        (1, 8193),
        (4097, 4096),
        (8192, 8192),
        (u32::MAX, u32::MAX),
    ] {
        assert!(pack_uniforms(&pass, w, h).is_err());
    }
    for (w, h) in [(1, 1), (8192, 1), (1, 8192), (4096, 4096), (8192, 2048)] {
        assert!(pack_uniforms(&pass, w, h).is_ok());
    }
}
