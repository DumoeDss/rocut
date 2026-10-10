use super::{clock, model::PreparedSource, model::preflight, resolve};
use std::collections::BTreeMap;
use time::{FrameRate, TICKS_PER_SECOND};

#[test]
fn alpha_topology_has_holes_and_opaque_canvas_policy() {
    let mut pixels = vec![[0.3, 0.4, 0.5, 1.0]; 49];
    pixels[24] = [1.0, 0.0, 0.0, 0.0];
    let source = PreparedSource::prepare(7, 7, &pixels, 2.0, 4.0).unwrap();
    assert_eq!(source.mask([3, 3]), 0.0);
    for p in [[2, 3], [4, 3], [3, 2], [3, 4], [2, 2]] {
        assert_eq!(source.mask(p), 1.0);
    }
    assert_eq!(source.mask([0, 0]), 1.0);
    let opaque = PreparedSource::prepare(7, 7, &vec![[0.0, 0.0, 0.0, 1.0]; 49], 2.0, 4.0).unwrap();
    assert_eq!(opaque.mask([3, 3]), 0.0);
    assert_eq!(opaque.mask([0, 3]), 1.0);
    let blank = PreparedSource::prepare(
        7,
        7,
        &vec![[f32::NAN, f32::INFINITY, -9.0, 0.0]; 49],
        2.0,
        4.0,
    )
    .unwrap();
    assert!(blank.boundary.iter().all(|v| *v == 0));
    assert!(blank.premultiplied.iter().all(|p| *p == [0.0; 4]));
}

#[test]
fn bounded_support_tracks_moving_source_and_interior_hole() {
    let mut pixels = vec![[0.0; 4]; 81];
    pixels[6 * 9 + 4] = [1.0; 4];
    let source = PreparedSource::prepare(9, 9, &pixels, 2.0, 4.0).unwrap();
    let (ring, plume) = source.support([4, 4], 2.0, 4.0, 0.0);
    assert!(ring > 0.0 && plume > 0.0);
    assert_eq!(source.support([0, 0], 2.0, 4.0, 0.0), (0.0, 0.0));
    assert!(source.support([3, 6], 1.0, 1.0, 0.0).0 < source.support([3, 6], 2.0, 1.0, 0.0).0);
}

#[test]
fn premultiplied_sampling_cannot_reveal_transparent_rgb_poison() {
    let clean = [[0.0; 4], [0.2, 0.4, 0.6, 0.5]];
    let poisoned = [[f32::NAN, f32::INFINITY, -99.0, 0.0], clean[1]];
    let a = PreparedSource::prepare(2, 1, &clean, 1.0, 1.0).unwrap();
    let b = PreparedSource::prepare(2, 1, &poisoned, 1.0, 1.0).unwrap();
    assert_eq!(a.sample([1.0, 0.5]), b.sample([1.0, 0.5]));
    let interpolated = a.sample([1.0, 0.5]);
    for (actual, expected) in interpolated
        .into_iter()
        .zip([0.00827619, 0.03321708, 0.07963671, 0.25])
    {
        assert!((actual - expected).abs() < 0.000001);
    }
    assert_eq!(a.sample([-0.25, 0.5]), [0.0; 4]);
    assert!(PreparedSource::prepare(1, 1, &[[f32::NAN, 0.0, 0.0, 1.0]], 1.0, 1.0).is_err());
}

#[test]
fn neutral_exact_source_and_linear_optics_have_independent_numeric_controls() {
    use super::model::composite;
    let source = [0.2, 0.4, 0.6, 0.5];
    assert_eq!(composite(source, [f32::NAN; 4], 0.0, [1.0; 3], 1.0), source);
    assert_eq!(
        composite(
            [f32::NAN, 9.0, -2.0, 0.0],
            [f32::NAN; 4],
            0.0,
            [1.0; 3],
            1.0
        ),
        [0.0; 4]
    );
    // Half-white over opaque black is 0.5 in linear light, ~0.735 sRGB.
    let result = composite(
        [0.0, 0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0, 1.0],
        1.0,
        [1.0; 3],
        0.5,
    );
    for actual in &result[..3] {
        assert!((*actual - 0.73535698).abs() < 0.000001);
        assert!((*actual - 0.5).abs() > 0.2);
    }
    assert_eq!(result[3], 1.0);
    let transparent = composite([0.0; 4], [0.0; 4], 1.0, [1.0; 3], 0.5);
    assert!((transparent[0] - 1.0).abs() < 0.000001);
    assert_eq!(transparent[3], 0.5);
}

#[test]
fn exact_memory_boundary_alpha_threshold_and_off_canvas_are_rejected_or_zero() {
    // 29 bytes/pixel dominates here. 13,884,596 pixels is the last admitted
    // whole-pixel memory size, independent of the implementation calculation.
    assert!(preflight(8192, 1694, 1.0, 1.0).is_ok());
    assert!(preflight(8192, 1695, 1.0, 1.0).is_err());
    // At maximum supports, this adjacent-row pair crosses 4 billion loads.
    assert!(preflight(8192, 1196, 32.0, 128.0).is_ok());
    assert!(preflight(8192, 1197, 32.0, 128.0).is_err());
    let pixels = [[1.0, 0.0, 0.0, 0.499], [0.0, 1.0, 0.0, 0.5]];
    let source = PreparedSource::prepare(2, 1, &pixels, 1.0, 1.0).unwrap();
    assert_eq!(source.mask([0, 0]), 0.0);
    assert_eq!(source.mask([1, 0]), 1.0);
    for p in [[-1, 0], [0, -1], [2, 0], [0, 1]] {
        assert_eq!(source.mask(p), 0.0);
    }
    assert_eq!(source.sample([3.5, 0.5]), [0.0; 4]);
}

#[test]
fn admission_precedes_allocation_and_counts_prepass_and_final_reads() {
    let a = preflight(1920, 1080, 8.0, 32.0).unwrap();
    assert_eq!(a.steps, 248_832_000);
    assert!(preflight(3840, 2160, 32.0, 128.0).is_ok());
    for (w, h) in [(0, 1), (1, 0), (8193, 1), (8192, 8192)] {
        assert!(preflight(w, h, 8.0, 32.0).is_err());
    }
    assert!(preflight(1, 1, f32::NAN, 32.0).is_err());
    assert!(PreparedSource::prepare(8192, 8192, &[], 8.0, 32.0).is_err());
    assert!(PreparedSource::prepare(2, 1, &[], 1.0, 1.0).is_err());
}

#[test]
fn clock_and_authoring_share_floor_frame_and_exact_period() {
    let rate = FrameRate {
        numerator: 30000,
        denominator: 1001,
    };
    let a = resolve(&BTreeMap::new(), -1, rate).unwrap();
    assert_eq!(a, resolve(&BTreeMap::new(), -4004, rate).unwrap());
    assert_eq!(a["frameIndex"], -1);
    assert_eq!(clock::phase(-TICKS_PER_SECOND / 4, 1.0), 0.75);
    assert_eq!(clock::phase(TICKS_PER_SECOND, 1.0), 0.0);
    assert_eq!(clock::phase(9_007_199_254_740_991, 0.0), 0.0);
    for (key, value) in [
        ("seed", 0.5),
        ("boundaryWidth", 33.0),
        ("phase", 0.5),
        ("amount", f64::NAN),
    ] {
        assert!(resolve(&BTreeMap::from([(key.into(), value)]), 0, rate).is_err());
    }
    assert_eq!(
        resolve(&BTreeMap::from([("amount".into(), 0.0)]), 0, rate).unwrap()["passes"],
        serde_json::json!([])
    );
}

#[test]
fn uniform_packing_rejects_forged_transport_before_gpu_allocation() {
    use crate::{EffectPass, UniformValue};
    let plan = resolve(
        &BTreeMap::new(),
        0,
        FrameRate {
            numerator: 30,
            denominator: 1,
        },
    )
    .unwrap();
    let values = plan["passes"][0]["uniforms"].as_object().unwrap();
    let pass = EffectPass {
        shader: "flame_wrap".into(),
        uniforms: values
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    UniformValue::Number(value.as_f64().unwrap() as f32),
                )
            })
            .collect(),
    };
    let packed = super::pack_uniforms(&pass, 1920, 1080).unwrap();
    assert_eq!(std::mem::size_of_val(&packed), 48);
    assert_eq!(packed.geometry, [1920.0, 1080.0, 8.0, 32.0]);
    assert_eq!(packed.controls, [1.0, 0.85, 0.6, 2.0]);
    assert_eq!(packed.motion, [0.0; 4]);
    for (key, value) in [
        ("phase", 1.0),
        ("phase", f32::NAN),
        ("seed", 0.5),
        ("boundaryWidth", 0.0),
        ("flameHeight", 129.0),
        ("unknown", 0.0),
    ] {
        let mut invalid = pass.clone();
        invalid
            .uniforms
            .insert(key.into(), UniformValue::Number(value));
        assert!(super::pack_uniforms(&invalid, 1, 1).is_err());
    }
    assert!(super::pack_uniforms(&pass, 8192, 8192).is_err());
}

#[test]
fn shader_naga_matches_actual_entries_and_uniform_binding_layout() {
    use super::gpu_pipeline::{BOUNDARY_ENTRY_POINT, FINAL_ENTRY_POINT};
    let source = include_str!("../shaders/flame_wrap.wgsl");
    let module = wgpu::naga::front::wgsl::parse_str(source).unwrap();
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
    for name in [BOUNDARY_ENTRY_POINT, FINAL_ENTRY_POINT] {
        assert!(module.entry_points.iter().any(|entry| entry.name == name && entry.stage == wgpu::naga::ShaderStage::Fragment));
    }
    let (members, span) = module
        .types
        .iter()
        .find_map(|(_, ty)| {
            if ty.name.as_deref() != Some("FlameWrapUniforms") {
                return None;
            }
            match &ty.inner {
                wgpu::naga::TypeInner::Struct { members, span } => Some((members, span)),
                _ => None,
            }
        })
        .unwrap();
    assert_eq!(*span, 48);
    assert_eq!(
        members
            .iter()
            .map(|member| member.offset)
            .collect::<Vec<_>>(),
        [0, 16, 32]
    );
    let mask = module
        .global_variables
        .iter()
        .find_map(|(_, variable)| {
            (variable.name.as_deref() == Some("boundary_mask")).then_some(variable)
        })
        .unwrap();
    let binding = mask.binding.as_ref().unwrap();
    assert_eq!((binding.group, binding.binding), (1, 1));
}
