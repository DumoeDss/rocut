use super::{
    pack_uniforms,
    tests::value_at,
    uniforms::{FrostUniformBuffer, work_budget},
};
use crate::{EffectPass, EffectsError, UniformValue, validate_effects_input};
use std::collections::HashMap;

fn pass() -> EffectPass {
    let result = value_at(&[], 24000);
    EffectPass {
        shader: "frost".into(),
        uniforms: result["passes"][0]["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), UniformValue::Number(v.as_f64().unwrap() as f32)))
            .collect::<HashMap<_, _>>(),
    }
}
#[test]
fn frost_uniform_layout_and_rectangular_short_side_geometry_are_actual_packed_values() {
    let packed = pack_uniforms(&pass(), 192, 128).unwrap();
    assert_eq!(std::mem::size_of::<FrostUniformBuffer>(), 576);
    assert_eq!(std::mem::offset_of!(FrostUniformBuffer, optics), 16);
    assert_eq!(std::mem::offset_of!(FrostUniformBuffer, tint), 32);
    assert_eq!(std::mem::offset_of!(FrostUniformBuffer, metadata), 48);
    assert_eq!(std::mem::offset_of!(FrostUniformBuffer, endpoints), 64);
    assert_eq!(std::mem::offset_of!(FrostUniformBuffer, states), 320);
    assert_eq!(packed.geometry, [192.0, 128.0, 128.0, 1.0]);
    assert_eq!(packed.endpoints[0], [0.375, 0.5, 1.125, 0.5]);
    assert_eq!(packed.states[0], [0.1, 0.6, 0.0, 0.0]);
    assert_eq!(packed.metadata, [17, 1, 0, 0]);
    assert_eq!(packed.endpoints[1..], [[0.0; 4]; 15]);
    let bytes = crate::pipeline::pack_effect_uniforms(&pass(), 192, 128).unwrap();
    assert_eq!(bytes.len(), 576);
    assert_eq!(bytes, bytemuck::bytes_of(&packed));
}
#[test]
fn frost_raw_passpack_and_input_preflight_reject_caller_bypasses_before_import() {
    let original = pass();
    assert!(validate_effects_input(192, 128, 8192, &[original.clone()]).is_ok());
    for key in original.uniforms.keys() {
        for v in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut p = original.clone();
            p.uniforms.insert(key.clone(), UniformValue::Number(v));
            assert!(pack_uniforms(&p, 192, 128).is_err());
        }
        let mut missing = original.clone();
        missing.uniforms.remove(key);
        assert!(pack_uniforms(&missing, 192, 128).is_err());
        let mut vector = original.clone();
        vector
            .uniforms
            .insert(key.clone(), UniformValue::Vector(vec![0.0]));
        assert!(pack_uniforms(&vector, 192, 128).is_err());
    }
    for (key, v) in [
        ("strokeCount", 17.0),
        ("strokeCount", 1.5),
        ("seed", 1.5),
        ("seed", 16777216.0),
        ("stroke0Radius", 0.001),
        ("stroke0Strength", 1.1),
        ("stroke0FromX", 2.01),
        ("stroke1Radius", 0.1),
        ("stroke0TimeTicks", 0.0),
        ("holdTicks", 1.0),
        ("amount", -0.01),
    ] {
        let mut p = original.clone();
        p.uniforms.insert(key.into(), UniformValue::Number(v));
        assert!(pack_uniforms(&p, 192, 128).is_err(), "{key}");
        assert!(validate_effects_input(192, 128, 8192, &[p]).is_err());
    }
    assert!(validate_effects_input(192, 128, 127, &[original]).is_err());
}
#[test]
fn frost_work_budget_counts_actual_nine_taps_one_base_and_each_capsule() {
    let budget = work_budget(192, 128, 2, true, true).unwrap();
    assert_eq!(budget.pixels, 24576);
    assert_eq!(budget.stroke_terms, 49152);
    assert_eq!(budget.crystal_terms, 663552);
    assert_eq!(budget.bilinear_samples, 221184);
    assert_eq!(budget.texel_loads, 909312);
    assert_eq!(budget.target_bytes, 98304);
    assert_eq!(
        work_budget(192, 128, 0, false, true).unwrap().texel_loads,
        122880
    );
    assert_eq!(
        work_budget(192, 128, 0, false, false).unwrap().texel_loads,
        24576
    );
    assert!(work_budget(1920, 1080, 16, true, true).is_ok());
    assert!(work_budget(3840, 2160, 7, true, true).is_ok());
    assert!(matches!(
        work_budget(3840, 2160, 8, true, true),
        Err(EffectsError::FrostWorkBudget { .. })
    ));
    assert!(work_budget(4096, 2048, 7, true, true).is_ok());
    for (w, h) in [
        (0, 1),
        (1, 0),
        (8193, 1),
        (4096, 2049),
        (u32::MAX, u32::MAX),
    ] {
        assert!(work_budget(w, h, 0, true, true).is_err());
    }
}
#[test]
fn frost_shader_naga_validation_matches_actual_uniform_layout_and_sampling_contract() {
    let source = include_str!("../shaders/frost.wgsl");
    let module = wgpu::naga::front::wgsl::parse_str(source).unwrap();
    assert!(module.entry_points.iter().any(|entry| {
        entry.name == crate::pipeline::EFFECT_FRAGMENT_ENTRY_POINT
            && entry.stage == wgpu::naga::ShaderStage::Fragment
    }));
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
    let (members, span) = module
        .types
        .iter()
        .find_map(|(_, t)| {
            if t.name.as_deref() == Some("FrostUniforms") {
                if let wgpu::naga::TypeInner::Struct { members, span } = &t.inner {
                    Some((members, *span))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(span, 576);
    assert_eq!(
        members.iter().map(|m| m.offset).collect::<Vec<_>>(),
        [0, 16, 32, 48, 64, 320]
    );
    for member in &members[4..] {
        match module.types[member.ty].inner {
            wgpu::naga::TypeInner::Array {
                size: wgpu::naga::ArraySize::Constant(n),
                stride,
                ..
            } => {
                assert_eq!(n.get(), 16);
                assert_eq!(stride, 16);
            }
            _ => panic!("Expected fixed sixteen vec4 slots"),
        }
    }
    assert!(!source.contains("textureSample("));
    assert!(!source.contains("uniforms.frame"));
    assert!(source.contains("vec4f(value.rgb*value.a,value.a)"));
    assert!(source.contains("melt=max(melt,weight*state.y)"));
    assert!(source.contains("return vec4f(color,original.a)"));
    assert!(!source.contains("pow("));
}
