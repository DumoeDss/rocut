use std::collections::HashMap;
use std::num::NonZeroU64;

use crate::{EffectPass, LiquidPreparation, UniformValue};

fn pass() -> EffectPass {
    let mut uniforms: HashMap<_, _> = crate::liquid_catalog::fields()
        .into_iter()
        .filter(|field| field.key != "startTicks")
        .map(|field| (field.key.into(), UniformValue::Number(field.default as f32)))
        .collect();
    for (key, value) in [
        ("columns", 8.0),
        ("rows", 8.0),
        ("durationTicks", 8000.0),
        ("elapsedTicks", 8000.0),
        ("eventCount", 1.0),
    ] {
        uniforms.insert(key.into(), UniformValue::Number(value));
    }
    uniforms.insert(
        "events".into(),
        UniformValue::Vector(vec![0.0, 0.4, 0.6, 0.2, 0.8, -0.3, 0.7]),
    );
    EffectPass {
        shader: "liquid".into(),
        uniforms,
    }
}

#[test]
fn liquid_raster_is_bit_identical_across_chunk_sizes_and_sync() {
    let pass = pass();
    let sync = LiquidPreparation::new(pass.clone(), [320, 240])
        .unwrap()
        .complete()
        .unwrap();
    assert!(sync.cells.iter().any(|cell| cell[2] > 0.0));
    for quota in [1, 3, 64] {
        let mut preparation = LiquidPreparation::new(pass.clone(), [320, 240]).unwrap();
        while !preparation
            .advance(NonZeroU64::new(quota).unwrap())
            .unwrap()
            .0
        {}
        let result = preparation.finish().unwrap();
        assert_eq!(
            bytemuck::cast_slice::<_, u8>(&sync.cells),
            bytemuck::cast_slice::<_, u8>(&result.cells)
        );
        assert_eq!(sync.optics, result.optics);
        assert_eq!(sync.color, result.color);
    }
}

#[test]
fn prepared_identity_rejects_parameters_events_dimensions_and_age() {
    let original = pass();
    let prepared = LiquidPreparation::new(original.clone(), [320, 240])
        .unwrap()
        .complete()
        .unwrap();
    assert!(prepared.matches(&original, [320, 240]));
    assert!(!prepared.matches(&original, [240, 320]));
    for key in ["amount", "elapsedTicks", "columns"] {
        let mut changed = original.clone();
        changed
            .uniforms
            .insert(key.into(), UniformValue::Number(0.0));
        assert!(!prepared.matches(&changed, [320, 240]));
    }
    let mut changed = original.clone();
    changed
        .uniforms
        .insert("events".into(), UniformValue::Vector(vec![]));
    assert!(!prepared.matches(&changed, [320, 240]));
}

#[test]
fn incomplete_preparation_cannot_publish_raster() {
    let mut preparation = LiquidPreparation::new(pass(), [320, 240]).unwrap();
    assert_eq!(
        preparation.advance(NonZeroU64::new(1).unwrap()).unwrap(),
        (false, 1)
    );
    assert!(preparation.finish().is_err());
}
