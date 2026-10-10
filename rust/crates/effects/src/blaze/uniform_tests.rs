use super::tests::pass_at;
use super::{definition, pack_uniforms, uniforms::BlazeUniformBuffer};
use crate::{EffectsError, UniformValue};

#[test]
fn blaze_raw_uniforms_are_strict_even_for_neutral_strength() {
    let active = pass_at(&[], 0);
    for field in definition().fields {
        for bad in [
            field.min as f32 - 1.0,
            field.max as f32 + 1.0,
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
        ] {
            let mut pass = active.clone();
            pass.uniforms
                .insert("amount".into(), UniformValue::Number(0.0));
            pass.uniforms
                .insert(field.key.into(), UniformValue::Number(bad));
            assert!(pack_uniforms(&pass, 96, 64).is_err(), "{}={bad}", field.key);
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
        ("frame", 0.0),
        ("count", 24.0),
    ] {
        let mut pass = active.clone();
        pass.uniforms
            .insert(key.into(), UniformValue::Number(value));
        assert!(pack_uniforms(&pass, 96, 64).is_err());
    }
    let mut wrong = active;
    wrong.shader = "clouds".into();
    assert!(matches!(
        pack_uniforms(&wrong, 96, 64),
        Err(EffectsError::UnknownEffectShader { .. })
    ));
}

#[test]
fn blaze_uniform_buffer_layout_defaults_and_resolution_budget_are_exact() {
    let pass = pass_at(&[], 0);
    let buffer = pack_uniforms(&pass, 96, 64).unwrap();
    assert_eq!(buffer.geometry, [96.0, 64.0, 0.65, 0.15]);
    assert_eq!(buffer.controls, [1.0, 0.8, 0.6, 0.25]);
    assert_eq!(buffer.motion, [0.0, 0.0, 0.015, 0.0]);
    assert_eq!(std::mem::size_of::<BlazeUniformBuffer>(), 1456);
    assert_eq!(std::mem::offset_of!(BlazeUniformBuffer, lattice), 48);
    assert_eq!(std::mem::offset_of!(BlazeUniformBuffer, sparks), 1072);
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

#[test]
fn blaze_component_opacity_does_not_modify_other_optics_or_seed_geometry() {
    let original = pack_uniforms(&pass_at(&[], 48000), 96, 64).unwrap();
    for (key, index) in [
        ("flameOpacity", 1),
        ("sparkOpacity", 2),
        ("smokeOpacity", 3),
    ] {
        let changed = pack_uniforms(&pass_at(&[(key, 0.0)], 48000), 96, 64).unwrap();
        let mut controls = original.controls;
        controls[index] = 0.0;
        assert_eq!(changed.controls, controls);
        assert_eq!(changed.geometry, original.geometry);
        assert_eq!(changed.motion, original.motion);
        assert_eq!(changed.lattice, original.lattice);
        assert_eq!(changed.sparks, original.sparks);
    }
    let no_heat = pack_uniforms(&pass_at(&[("refraction", 0.0)], 48000), 96, 64).unwrap();
    assert_eq!(no_heat.controls, original.controls);
    assert_eq!(no_heat.geometry, original.geometry);
    assert_eq!(no_heat.lattice, original.lattice);
    assert_eq!(no_heat.sparks, original.sparks);
    assert_eq!(
        no_heat.motion,
        [original.motion[0], original.motion[1], 0.0, 0.0]
    );
}

#[test]
fn blaze_static_time_is_invariant_and_seed_changes_only_seeded_data() {
    let a = pack_uniforms(&pass_at(&[("speed", 0.0)], 0), 96, 64).unwrap();
    let b = pack_uniforms(&pass_at(&[("speed", 0.0)], -9_007_199_254_740_991), 96, 64).unwrap();
    assert_eq!(bytemuck::bytes_of(&a), bytemuck::bytes_of(&b));
    let changed = pack_uniforms(&pass_at(&[("speed", 0.0), ("seed", 65535.0)], 0), 96, 64).unwrap();
    assert_eq!(a.geometry, changed.geometry);
    assert_eq!(a.controls, changed.controls);
    assert_eq!(a.motion, changed.motion);
    assert_ne!(a.lattice, changed.lattice);
    assert_ne!(a.sparks, changed.sparks);
}
