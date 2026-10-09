use std::collections::BTreeMap;

use time::FrameRate;

use super::*;
use crate::{EffectPass, UniformValue};

pub(super) fn params(entries: &[(&str, f64)]) -> BTreeMap<String, f64> {
    entries
        .iter()
        .map(|(key, value)| ((*key).into(), *value))
        .collect()
}

pub(super) fn pass_at(entries: &[(&str, f64)], ticks: i64) -> EffectPass {
    let value = resolve(&params(entries), ticks, FrameRate::FPS_30).unwrap();
    EffectPass {
        shader: "clouds".into(),
        uniforms: value["passes"][0]["uniforms"]
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
fn clouds_catalog_has_twelve_fields_and_nine_animated_controls() {
    let catalog = definition();
    assert_eq!(catalog.id, "clouds");
    assert_eq!(catalog.version, 1);
    assert!(catalog.animated);
    assert_eq!(catalog.fields.len(), 12);
    assert_eq!(
        catalog
            .fields
            .iter()
            .filter(|f| f.keyframable)
            .map(|f| f.key)
            .collect::<Vec<_>>(),
        [
            "amount",
            "density",
            "windX",
            "windY",
            "refraction",
            "fogOpacity",
            "colorR",
            "colorG",
            "colorB"
        ]
    );
    let value = resolve(
        &params(&[("windX", 0.123456789), ("density", 0.123456789)]),
        0,
        FrameRate::FPS_30,
    )
    .unwrap();
    assert_eq!(value["passes"][0]["uniforms"]["windX"], 0.123456789);
    assert_eq!(value["passes"][0]["uniforms"]["density"], 0.123456789);
}

#[test]
fn clouds_validate_every_field_before_neutral_elision() {
    for neutral in [
        vec![("amount", 0.0)],
        vec![("density", 0.0)],
        vec![("refraction", 0.0), ("fogOpacity", 0.0)],
    ] {
        assert_eq!(
            resolve(&params(&neutral), 0, FrameRate::FPS_30).unwrap()["passes"],
            json!([])
        );
        for field in definition().fields {
            for bad in [field.min - 1.0, field.max + 1.0, f64::NAN, f64::INFINITY] {
                let mut values = params(&neutral);
                values.insert(field.key.into(), bad);
                assert!(
                    resolve(&values, 0, FrameRate::FPS_30).is_err(),
                    "{}={bad}",
                    field.key
                );
            }
        }
        for (key, value) in [
            ("seed", 0.5),
            ("unknown", 0.0),
            ("phase", 0.0),
            ("speed", -f64::MIN_POSITIVE),
        ] {
            let mut values = params(&neutral);
            values.insert(key.into(), value);
            assert!(resolve(&values, 0, FrameRate::FPS_30).is_err());
        }
    }
    for field in definition().fields {
        for value in [field.min, field.max] {
            assert!(resolve(&params(&[(field.key, value)]), 0, FrameRate::FPS_30).is_ok());
        }
    }
}

#[test]
fn clouds_frame_floor_is_signed_bounded_and_random_access() {
    let rate = FrameRate::FPS_29_97;
    let a = resolve(&BTreeMap::new(), -1, rate).unwrap();
    assert_eq!(a["frameIndex"], -1);
    assert_eq!(a, resolve(&BTreeMap::new(), -4004, rate).unwrap());
    let b = resolve(&BTreeMap::new(), 8008, rate).unwrap();
    assert_eq!(b["frameIndex"], 2);
    assert_eq!(b, resolve(&BTreeMap::new(), 12011, rate).unwrap());
    assert_ne!(a["passes"], b["passes"]);
    assert_eq!(a, resolve(&BTreeMap::new(), -1, rate).unwrap());
    for rate in [
        FrameRate::new(0, 1),
        FrameRate::new(30, 0),
        FrameRate::new(7, 3),
        FrameRate::new(240000, 2),
        FrameRate::new(120000, 1002),
    ] {
        assert!(resolve(&params(&[("amount", 0.0)]), 0, rate).is_err());
    }
    for ticks in [
        9_007_199_254_740_992,
        -9_007_199_254_740_992,
        i64::MIN,
        i64::MAX,
    ] {
        assert!(resolve(&params(&[("speed", 0.0)]), ticks, FrameRate::FPS_30).is_err());
    }
}

#[test]
fn clouds_static_clock_preserves_explicit_wind_offsets() {
    let a = pack_uniforms(&pass_at(&[("speed", 0.0)], 0), 96, 64).unwrap();
    let b = pack_uniforms(&pass_at(&[("speed", 0.0)], -9_007_199_254_740_991), 96, 64).unwrap();
    assert_eq!(bytemuck::bytes_of(&a), bytemuck::bytes_of(&b));
    let moved = pack_uniforms(&pass_at(&[("speed", 0.0), ("windX", 0.25)], 0), 96, 64).unwrap();
    assert_ne!(a.wind_color, moved.wind_color);
    assert_eq!(a.lattice, moved.lattice);
    assert_eq!(a.geometry, moved.geometry);
    for speed in [0.0, f64::from_bits(1), f64::MIN_POSITIVE] {
        for ticks in [0, 1, -1, 9_007_199_254_740_991, -9_007_199_254_740_991] {
            assert_eq!(clock::phase(ticks, speed), 0.0);
        }
    }
    assert_eq!(clock::phase(120000, 0.99999999), 0.0);
}

#[test]
fn clouds_lattice_matches_independent_bigint_golden_vectors() {
    for (seed, index, expected) in [
        (0, 0, 0.2290845513343811),
        (1, 0, 0.7968493103981018),
        (1, 255, 0.4601343274116516),
        (1, 256, 0.9609611630439758),
        (1, 1023, 0.6962854266166687),
        (31415, 17, 0.7422834038734436),
        (65535, 1023, 0.12250036001205444),
    ] {
        let field = field::lattice(seed);
        assert_eq!(field[index / 4][index % 4], expected as f32);
        assert!(
            field
                .iter()
                .flatten()
                .all(|value| (0.0..1.0).contains(value))
        );
    }
    assert_eq!(
        std::mem::size_of::<uniforms::CloudsUniformBuffer>(),
        4096 + 64
    );
    assert_eq!(
        std::mem::offset_of!(uniforms::CloudsUniformBuffer, lattice),
        64
    );
}

#[test]
fn clouds_shader_passes_cpu_wgsl_validation() {
    let module =
        wgpu::naga::front::wgsl::parse_str(include_str!("../shaders/clouds.wgsl")).unwrap();
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
}
