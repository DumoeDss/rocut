use super::*;
use crate::{EffectPass, UniformValue};
use std::collections::BTreeMap;
use std::num::NonZeroU64;
use time::FrameRate;

fn fixture() -> (EffectPass, [u32; 2], Vec<u8>) {
    let mut p: BTreeMap<String, f64> = definition()
        .fields
        .into_iter()
        .filter(|f| f.required == Some(true))
        .map(|f| (f.key.into(), f.default))
        .collect();
    p.insert("columns".into(), 8.0);
    p.insert("rows".into(), 8.0);
    p.insert("strokeCount".into(), 1.0);
    for f in definition()
        .fields
        .into_iter()
        .filter(|f| f.key.starts_with("stroke0"))
    {
        p.insert(f.key.into(), f.default);
    }
    p.insert("stroke0StartTicks".into(), 12001.0);
    p.insert("stroke0EndTicks".into(), 60000.0);
    p.insert("stroke0Opacity".into(), 0.500125);
    p.insert("lightX".into(), -0.0);
    let value = resolve(&p, 16015, FrameRate::FPS_29_97).unwrap();
    let v = &value["passes"][0];
    let pass = EffectPass {
        shader: "canvas".into(),
        uniforms: v["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    UniformValue::Vector(
                        value
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|v| v.as_f64().unwrap() as f32)
                            .collect(),
                    ),
                )
            })
            .collect(),
    };
    let bytes = (0..32 * 24)
        .flat_map(|i| [(i % 256) as u8, 64, 128, if i % 13 == 0 { 0 } else { 160 }])
        .collect();
    (pass, [32, 24], bytes)
}
fn complete(pass: EffectPass, dims: [u32; 2], bytes: Vec<u8>, batch: u64) -> PreparedCanvasPass {
    let mut preparation = CanvasPreparation::new(pass, dims, bytes).unwrap();
    let quota = NonZeroU64::new(preparation.minimum_step_work().get() * batch).unwrap();
    while !preparation.progress().is_complete() {
        preparation.advance(quota).unwrap();
    }
    preparation.finish().unwrap()
}
#[test]
fn preparation_batches_and_complete_frozen_source_match_direct_payload() {
    let (pass, dims, bytes) = fixture();
    let decoded = decode_pass(&pass).unwrap();
    let source = sample_rgba8_grid(decoded.config(), &bytes, dims[0], dims[1]).unwrap();
    let state = rebuild(
        decoded.config(),
        decoded.strokes(),
        &source,
        decoded.sampled_ticks(),
        120000,
        1,
    )
    .unwrap();
    assert_eq!(state.sampled_ticks(), 12012);
    let expected = raster_payload(decoded.config(), &state, &bytes, dims[0], dims[1]).unwrap();
    for batch in [1, 3, 20] {
        let prepared = complete(pass.clone(), dims, bytes.clone(), batch);
        assert_eq!(prepared.payload(), &expected);
        assert_eq!(prepared.source_rgba(), bytes.as_slice());
        assert!(prepared.matches(&pass, dims));
        assert_eq!(prepared.dimensions(), dims);
        assert!(prepared.memory_bytes().unwrap() <= prepared.budget().peak_bytes);
    }
}
#[test]
fn prepared_exact_pass_bits_dimensions_and_private_owned_source() {
    let (pass, dims, bytes) = fixture();
    let original = bytes.clone();
    let prepared = complete(pass.clone(), dims, bytes, 1);
    assert_eq!(prepared.source_rgba(), original);
    assert!(prepared.matches(&pass, dims));
    assert!(!prepared.matches(&pass, [24, 32]));
    let mut changed = pass.clone();
    changed.shader = "frost".into();
    assert!(!prepared.matches(&changed, dims));
    let mut changed = pass.clone();
    changed.uniforms.remove("version");
    assert!(!prepared.matches(&changed, dims));
    let mut changed = pass.clone();
    changed
        .uniforms
        .insert("sourceFlags".into(), UniformValue::Number(1.0));
    assert!(!prepared.matches(&changed, dims));
    let mut changed = pass.clone();
    if let UniformValue::Vector(words) = changed.uniforms.get_mut("version").unwrap() {
        assert_eq!(words[0], 0.0);
        words[0] = -0.0;
    }
    assert!(!prepared.matches(&changed, dims));
    let mut changed = pass.clone();
    if let UniformValue::Vector(words) = changed.uniforms.get_mut("lightX").unwrap() {
        words[0] = f32::from_bits(words[0].to_bits() + 1);
    }
    assert!(!prepared.matches(&changed, dims));
    assert!(prepared.matches(prepared.pass(), dims));
}
#[test]
fn unsampled_source_pixels_are_owned_even_when_material_grid_is_equal() {
    let (pass, _, _) = fixture();
    let dims = [32, 32];
    let bytes = vec![128u8; 32 * 32 * 4];
    let mut changed = bytes.clone();
    changed[0] = 129; // Pixel (0,0) is outside the 8x8 grid's bilinear sample taps.
    let a = complete(pass.clone(), dims, bytes, 2);
    let b = complete(pass, dims, changed, 2);
    assert_eq!(a.payload(), b.payload());
    assert_ne!(a.source_rgba(), b.source_rgba());
    // Equal numerical grids are explicitly not full-source byte identity.
}
#[test]
fn preparation_incomplete_bad_quota_and_exact_admission_negatives() {
    let (pass, dims, bytes) = fixture();
    let mut preparation = CanvasPreparation::new(pass.clone(), dims, bytes.clone()).unwrap();
    let prior = preparation.progress();
    let small = NonZeroU64::new(preparation.minimum_step_work().get() - 1).unwrap();
    assert!(preparation.advance(small).is_err());
    assert_eq!(preparation.progress(), prior);
    assert!(preparation.finish().is_err());
    assert!(NonZeroU64::new(0).is_none());
    for dim in [[0, 24], [32, 0], [16385, 24], [32, 25]] {
        assert!(CanvasPreparation::new(pass.clone(), dim, bytes.clone()).is_err());
    }
    assert!(CanvasPreparation::new(pass.clone(), dims, bytes[..bytes.len() - 1].to_vec()).is_err());
    let mut bad = pass.clone();
    bad.uniforms.remove("stroke0Wetness");
    assert!(CanvasPreparation::new(bad, dims, bytes.clone()).is_err());
    let mut bad = pass;
    bad.uniforms
        .insert("version".into(), UniformValue::Number(1.0));
    assert!(CanvasPreparation::new(bad, dims, bytes).is_err());
}
#[test]
fn whole_preparation_budget_checks_capacity_and_retained_charges() {
    let (pass, dims, bytes) = fixture();
    let decoded = decode_pass(&pass).unwrap();
    let budget =
        super::prepared_budget::admit(&pass, &decoded, dims, bytes.len(), bytes.capacity())
            .unwrap();
    assert_eq!(
        CanvasPreparation::estimate(&pass, dims, bytes.capacity()).unwrap(),
        budget
    );
    assert!(CanvasPreparation::estimate(&pass, dims, bytes.len() - 1).is_err());
    assert!(CanvasPreparation::estimate(&pass, [0, 24], 0).is_err());
    assert_eq!(budget.captured_capacity_bytes, bytes.capacity() as u64);
    assert_eq!(
        budget.retained_pass_bytes,
        super::prepared_budget::pass_charge(&pass).unwrap()
    );
    assert_eq!(
        budget.replay_peak_bytes,
        CanvasReplayJob::estimate(decoded.config(), decoded.strokes())
            .unwrap()
            .peak_bytes
    );
    assert!(
        budget.work
            >= CanvasReplayJob::estimate(decoded.config(), decoded.strokes())
                .unwrap()
                .full_duration_work
    );
    assert!(
        super::prepared_budget::admit(
            &pass,
            &decoded,
            dims,
            bytes.len(),
            MAX_PREPARATION_BYTES as usize
        )
        .is_err()
    );
    // Synthetic capacity-only budget probe: no huge capture allocation is made.
    let preparation = CanvasPreparation::new(pass, dims, bytes).unwrap();
    assert!(preparation.memory_bytes().unwrap() <= preparation.budget().peak_bytes);
}
#[test]
fn allocation_free_validation_keeps_original_shade_rejections() {
    let (pass, dims, bytes) = fixture();
    let d = decode_pass(&pass).unwrap();
    let source = sample_rgba8_grid(d.config(), &bytes, dims[0], dims[1]).unwrap();
    let state = rebuild(
        d.config(),
        d.strokes(),
        &source,
        d.sampled_ticks(),
        120000,
        1,
    )
    .unwrap();
    assert!(super::simulation::validate_state_source(d.config(), &state, &source).is_ok());
    let mut config = *d.config();
    config.light[1] = 0.3;
    assert_eq!(
        super::simulation::validate_state_source(&config, &state, &source).err(),
        shade(&config, &state, &source).err()
    );
    let mut changed = source;
    changed[0][3] = f64::from_bits(changed[0][3].to_bits() + 1);
    assert_eq!(
        super::simulation::validate_state_source(d.config(), &state, &changed).err(),
        shade(d.config(), &state, &changed).err()
    );
}
