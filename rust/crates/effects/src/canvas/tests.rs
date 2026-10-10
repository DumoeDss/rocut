use super::*;

#[test]
fn shading_rejects_source_and_static_configuration_substitution() {
    let c = config();
    let p = source(&c);
    let state = rebuild(&c, &[stroke()], &p, 60000, 30, 1).unwrap();
    let mut changed = p.clone();
    changed[1][0] = f64::from_bits(changed[1][0].to_bits() + 1);
    assert!(
        shade(&c, &state, &changed).is_err(),
        "one-bit source replacement accepted"
    );
    let mut changed = c;
    changed.light[0] = 0.3;
    assert!(
        shade(&changed, &state, &p).is_err(),
        "static lighting replacement accepted"
    );
}

#[test]
fn source_snapshot_is_owned_and_compared_by_bits_not_float_equality() {
    let c = config();
    let mut p = source(&c);
    let state = rebuild(&c, &[stroke()], &p, 60000, 30, 1).unwrap();
    let original = p.clone();
    let expected = shade(&c, &state, &p).unwrap();
    p[0][1] = 0.3;
    assert!(shade(&c, &state, &p).is_err());
    assert_eq!(shade(&c, &state, &original).unwrap(), expected);
    let mut signed_zero = original.clone();
    signed_zero[0][0] = -0.0;
    assert_eq!(signed_zero[0][0], original[0][0]);
    assert!(shade(&c, &state, &signed_zero).is_err());
    let zero_state = rebuild(&c, &[], &signed_zero, -4000, 30, 1).unwrap();
    assert!(shade(&c, &zero_state, &signed_zero).is_ok());
    assert!(shade(&c, &zero_state, &original).is_err());
}

#[test]
fn every_static_config_field_is_bound_including_lighting_signed_zero() {
    let mut c = config();
    c.drying = 0.0;
    c.light[1] = 0.0;
    let p = source(&c);
    let state = rebuild(&c, &[stroke()], &p, 60000, 30, 1).unwrap();
    let variants = [
        CanvasConfig { columns: 16, ..c },
        CanvasConfig { rows: 16, ..c },
        CanvasConfig {
            duration_ticks: 120001,
            ..c
        },
        CanvasConfig { seed: 18, ..c },
        CanvasConfig { drying: -0.0, ..c },
        CanvasConfig {
            diffusion: 2.1,
            ..c
        },
        CanvasConfig {
            weave_frequency: 10.0,
            ..c
        },
        CanvasConfig {
            weave_height: 0.02,
            ..c
        },
        CanvasConfig {
            light: [0.3, 0.2, 1.0],
            ..c
        },
        CanvasConfig {
            light: [0.4, 0.3, 1.0],
            ..c
        },
        CanvasConfig {
            light: [0.4, 0.2, 0.9],
            ..c
        },
        CanvasConfig { relief: 2.1, ..c },
    ];
    for changed in variants {
        assert!(shade(&changed, &state, &p).is_err());
    }
    let one_bit = CanvasConfig {
        relief: f64::from_bits(c.relief.to_bits() + 1),
        ..c
    };
    assert!(shade(&one_bit, &state, &p).is_err());
    let signed_light = CanvasConfig {
        light: [c.light[0], -0.0, c.light[2]],
        ..c
    };
    assert!(shade(&signed_light, &state, &p).is_err());
    assert!(shade(&c, &state, &p).is_ok());
}

#[test]
fn source_identity_all_channels_and_peak_estimate() {
    let c = config();
    let p = source(&c);
    let state = rebuild(&c, &[], &p, -4000, 30, 1).unwrap();
    for channel in 0..4 {
        let mut changed = p.clone();
        changed[10][channel] *= 0.99;
        assert!(shade(&c, &state, &changed).is_err(), "channel {channel}");
    }
    let estimate = validate(&c, &[]).unwrap();
    assert_eq!(estimate.source_snapshot_bytes, 32 * 32 * 32);
    assert_eq!(
        estimate.replay_peak_bytes,
        32 * 32 * 128
            + std::mem::size_of::<CanvasState>() as u64
            + std::mem::size_of::<Vec<CanvasCell>>() as u64
    );
}
fn config() -> CanvasConfig {
    CanvasConfig {
        columns: 32,
        rows: 32,
        duration_ticks: 120_000,
        seed: 17,
        drying: 2.0,
        diffusion: 2.0,
        weave_frequency: 9.0,
        weave_height: 0.01,
        light: [0.4, 0.2, 1.0],
        relief: 2.0,
    }
}
fn stroke() -> CanvasStroke {
    CanvasStroke {
        start_ticks: 12001,
        end_ticks: 60000,
        from: [0.2, 0.5],
        to: [0.8, 0.5],
        radius: 0.15,
        bristles: 5,
        opacity: 0.8,
        wetness: 1.0,
        thickness: 0.08,
    }
}
fn source(c: &CanvasConfig) -> Vec<[f64; 4]> {
    (0..c.columns * c.rows)
        .map(|i| {
            [
                f64::from(i % c.columns) / f64::from(c.columns),
                0.2,
                0.1,
                1.0,
            ]
        })
        .collect()
}
fn mass(s: &CanvasState) -> f64 {
    s.cells().iter().map(|p| p.coverage).sum()
}

#[test]
fn off_grid_causality_and_rational_floor() {
    let c = config();
    let p = source(&c);
    let s = [stroke()];
    assert_eq!(
        rebuild(&c, &s, &p, 16000, 30, 1).unwrap().sampled_ticks(),
        16000
    );
    for time in [11999, 12000] {
        assert_eq!(mass(&rebuild(&c, &s, &p, time, 30, 1).unwrap()), 0.0);
    }
    assert!(mass(&rebuild(&c, &s, &p, 16000, 30, 1).unwrap()) > 0.0);
    assert_eq!(frame_floor(16015, 30000, 1001).unwrap(), 12012);
    assert_eq!(frame_floor(-1, 30000, 1001).unwrap(), -4004);
    assert!(frame_floor(12000, 29, 1).is_err());
}
#[test]
fn arbitrary_seek_and_duplicate_strokes_rebuild_exactly() {
    let c = config();
    let p = source(&c);
    let mut other = stroke();
    other.from = [0.5, 0.2];
    other.to = [0.5, 0.8];
    let s = [other, stroke()];
    let expected = rebuild(&c, &s, &p, 80000, 30, 1).unwrap();
    for time in [100000, 0, 16000, 80000, -4000, 80000] {
        let actual = rebuild(&c, &s, &p, time, 30, 1).unwrap();
        if time == 80000 {
            assert_eq!(actual, expected);
        }
    }
    assert!(mass(&expected) > mass(&rebuild(&c, &[stroke()], &p, 80000, 30, 1).unwrap()));
}
#[test]
fn seed_bristles_and_ridges_are_real_material_state() {
    let c = config();
    let p = source(&c);
    let s = [stroke()];
    let a = rebuild(&c, &s, &p, 60000, 30, 1).unwrap();
    assert!(
        a.cells()
            .iter()
            .any(|p| p.height > 0.0 && p.wetness > 0.0 && p.coverage > 0.0)
    );
    let mut d = c;
    d.seed += 1;
    assert_ne!(
        rebuild(&d, &s, &p, 60000, 30, 1).unwrap().cells(),
        a.cells()
    );
    let mut brush = stroke();
    brush.bristles = 2;
    assert_ne!(
        rebuild(&c, &[brush], &p, 60000, 30, 1).unwrap().cells(),
        a.cells()
    );
    let mut no_height = stroke();
    no_height.thickness = 0.0;
    let flat = rebuild(&c, &[no_height], &p, 60000, 30, 1).unwrap();
    assert_ne!(shade(&c, &a, &p).unwrap(), shade(&c, &flat, &p).unwrap());
}
#[test]
fn drying_reduces_wetness_not_deposited_mass() {
    let mut c = config();
    c.diffusion = 0.0;
    let p = source(&c);
    let s = [stroke()];
    let a = rebuild(&c, &s, &p, 60000, 30, 1).unwrap();
    let b = rebuild(&c, &s, &p, 120000, 30, 1).unwrap();
    assert_eq!(mass(&a), mass(&b));
    assert!(
        b.cells().iter().map(|p| p.wetness).sum::<f64>()
            < a.cells().iter().map(|p| p.wetness).sum::<f64>()
    );
    assert_eq!(
        a.cells().iter().map(|p| p.height).sum::<f64>(),
        b.cells().iter().map(|p| p.height).sum::<f64>()
    );
}
#[test]
fn diffusion_conserves_mass_and_spreads_with_no_through_edges() {
    let mut c = config();
    c.drying = 0.0;
    let p = source(&c);
    let mut old = vec![CanvasCell::default(); p.len()];
    old[0] = CanvasCell {
        pigment: [0.8, 0.2, 0.1],
        coverage: 1.0,
        wetness: 1.0,
        height: 0.1,
    };
    let mut next = old.clone();
    simulation::advance(&c, &p, &old, &mut next, 0.05);
    assert!(next[1].coverage > 0.0);
    assert!(next[c.columns as usize].coverage > 0.0);
    assert!((next.iter().map(|p| p.coverage).sum::<f64>() - 1.0).abs() < 1e-12);
    assert!((next.iter().map(|p| p.height).sum::<f64>() - 0.1).abs() < 1e-12);
    assert!(
        next.iter()
            .all(|p| p.coverage >= 0.0 && p.pigment[0] <= p.coverage)
    );
}
#[test]
fn transparent_holes_and_premultiplied_edges() {
    let c = config();
    let mut p = source(&c);
    p[16 * 32 + 16] = [0.0; 4];
    p[16 * 32 + 17] = [0.1, 0.05, 0.0, 0.2];
    let state = rebuild(&c, &[stroke()], &p, 100000, 30, 1).unwrap();
    assert_eq!(state.cells()[16 * 32 + 16], CanvasCell::default());
    let out = shade(&c, &state, &p).unwrap();
    for (a, b) in out.iter().zip(&p) {
        assert_eq!(a[3], b[3]);
        assert!(a[..3].iter().all(|v| *v >= 0.0 && *v <= a[3]));
    }
    assert_eq!(out[16 * 32 + 16], [0.0; 4]);
    p[0] = [1.0, 0.0, 0.0, 0.0];
    assert!(rebuild(&c, &[], &p, -4000, 30, 1).is_err());
}
#[test]
fn full_admission_before_negative_or_zero_opacity_return() {
    let c = config();
    let p = source(&c);
    let mut s = stroke();
    s.opacity = 0.0;
    s.end_ticks = u64::MAX;
    assert!(rebuild(&c, &[s], &p, -4000, 30, 1).is_err());
    s = stroke();
    s.wetness = f64::NAN;
    assert!(validate(&c, &[s]).is_err());
    s = stroke();
    s.end_ticks = s.start_ticks;
    assert!(validate(&c, &[s]).is_err());
    assert!(rebuild(&c, &[], &p, -4000, 0, 1).is_err());
    assert!(rebuild(&c, &[], &p, -4000, 29, 1).is_err());
    assert!(rebuild(&c, &[], &p, i64::MAX, 30, 1).is_err());
    assert!(rebuild(&c, &[], &p[..3], -4000, 30, 1).is_err());
    let mut huge = c;
    huge.columns = 128;
    huge.rows = 128;
    huge.duration_ticks = MAX_DURATION_TICKS;
    assert!(validate(&huge, &[stroke(); 16]).is_err());
    huge.duration_ticks = u64::MAX;
    assert!(validate(&huge, &[]).is_err());
    assert!(validate(&c, &[stroke(); 17]).is_err());
}
#[test]
fn final_state_is_held_and_input_not_mutated() {
    let c = config();
    let p = source(&c);
    let original = p.clone();
    let a = rebuild(&c, &[stroke()], &p, 120000, 30, 1).unwrap();
    let b = rebuild(&c, &[stroke()], &p, 240000, 30, 1).unwrap();
    assert_eq!(a.cells(), b.cells());
    assert_eq!(p, original);
    let e: ReplayEstimate = validate(&c, &[stroke()]).unwrap();
    assert_eq!(e.state_and_scratch_bytes, 32 * 32 * 96);
    assert!(e.max_steps >= 20);
}

#[test]
fn strict_numeric_dto_rejects_missing_unknown_inactive_fractional_fields() {
    use std::collections::BTreeMap;
    let mut p: BTreeMap<String, f64> = [
        ("version", 1.0),
        ("columns", 32.0),
        ("rows", 32.0),
        ("durationTicks", 120000.0),
        ("seed", 17.0),
        ("drying", 2.0),
        ("diffusion", 2.0),
        ("weaveFrequency", 9.0),
        ("weaveHeight", 0.01),
        ("lightX", 0.4),
        ("lightY", 0.2),
        ("lightZ", 1.0),
        ("relief", 2.0),
        ("strokeCount", 1.0),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v))
    .collect();
    for (k, v) in [
        ("StartTicks", 12001.0),
        ("EndTicks", 60000.0),
        ("FromX", 0.2),
        ("FromY", 0.5),
        ("ToX", 0.8),
        ("ToY", 0.5),
        ("Radius", 0.15),
        ("Bristles", 5.0),
        ("Opacity", 0.8),
        ("Wetness", 1.0),
        ("Thickness", 0.08),
    ] {
        p.insert(format!("stroke0{k}"), v);
    }
    assert_eq!(parse(&p).unwrap(), (config(), vec![stroke()]));
    for key in p.keys() {
        let mut q = p.clone();
        q.remove(key);
        assert!(parse(&q).is_err(), "{key}");
    }
    for key in ["stroke1Radius", "stroke0Unknown", "unknown"] {
        let mut q = p.clone();
        q.insert(key.into(), 0.1);
        assert!(parse(&q).is_err());
    }
    for key in [
        "seed",
        "strokeCount",
        "stroke0StartTicks",
        "stroke0Bristles",
    ] {
        let mut q = p.clone();
        *q.get_mut(key).unwrap() += 0.5;
        assert!(parse(&q).is_err());
    }
    p.insert("stroke0Opacity".into(), 0.0);
    p.remove("stroke0Wetness");
    assert!(parse(&p).is_err());
}
