use super::*;

fn controls() -> LiquidObjectControls {
    LiquidObjectControls {
        amount: 0.8,
        frequency: 4.0,
        speed: 1.0,
        twist: 0.5,
    }
}

fn domain() -> LiquidObjectDomain {
    LiquidObjectDomain {
        min: [-2.0, -1.0, 0.0],
        max: [2.0, 1.0, 0.0],
    }
}

const LEFT: [f64; 12] = [
    -2.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, -2.0, 1.0, 0.0,
];
const RIGHT: [f64; 12] = [0.0, -1.0, 0.0, 2.0, -1.0, 0.0, 2.0, 1.0, 0.0, 0.0, 1.0, 0.0];

#[test]
fn split_material_primitives_match_whole_root_exactly() {
    let whole: Vec<_> = LEFT.into_iter().chain(RIGHT).collect();
    for time in [0.0, 1.25, 20.0, 1.25] {
        let expected = deform_liquid_object(&whole, &controls(), time, 19, true).unwrap();
        let left =
            deform_liquid_object_with_domain(&LEFT, &controls(), time, 19, true, Some(&domain()))
                .unwrap();
        let right =
            deform_liquid_object_with_domain(&RIGHT, &controls(), time, 19, true, Some(&domain()))
                .unwrap();
        assert_eq!(left.positions[3..6], right.positions[0..3]);
        assert_eq!(left.positions[6..9], right.positions[9..12]);
        assert_eq!(
            left.positions
                .into_iter()
                .chain(right.positions)
                .collect::<Vec<_>>(),
            expected.positions,
        );
    }
    let independent = deform_liquid_object(&LEFT, &controls(), 1.25, 19, true).unwrap();
    let shared =
        deform_liquid_object_with_domain(&LEFT, &controls(), 1.25, 19, true, Some(&domain()))
            .unwrap();
    assert_ne!(independent.positions, shared.positions);
}

#[test]
fn explicit_local_domain_preserves_legacy_output_and_restore() {
    let local = LiquidObjectDomain {
        min: [-2.0, -1.0, 0.0],
        max: [0.0, 1.0, 0.0],
    };
    for enabled in [true, false] {
        assert_eq!(
            deform_liquid_object(&LEFT, &controls(), 1.25, 19, enabled).unwrap(),
            deform_liquid_object_with_domain(&LEFT, &controls(), 1.25, 19, enabled, Some(&local),)
                .unwrap(),
        );
    }
    let mut zero = controls();
    zero.amount = 0.0;
    let frame =
        deform_liquid_object_with_domain(&LEFT, &zero, 1.25, 19, true, Some(&domain())).unwrap();
    assert!(frame.restore);
    assert_eq!(frame.positions, LEFT);
}

#[test]
fn domain_is_validated_even_for_disabled_or_zero_amount() {
    for invalid in [
        LiquidObjectDomain {
            min: [f64::NAN, -1.0, 0.0],
            ..domain()
        },
        LiquidObjectDomain {
            max: [f64::INFINITY, 1.0, 0.0],
            ..domain()
        },
        LiquidObjectDomain {
            max: [1_000_001.0, 1.0, 0.0],
            ..domain()
        },
        LiquidObjectDomain {
            min: [1.0, -1.0, 0.0],
            max: [-1.0, 1.0, 0.0],
        },
        LiquidObjectDomain {
            min: [-1.0, -1.0, 0.0],
            ..domain()
        },
    ] {
        for enabled in [true, false] {
            for amount in [0.0, 0.8] {
                let mut c = controls();
                c.amount = amount;
                assert!(
                    deform_liquid_object_with_domain(&LEFT, &c, 1.25, 19, enabled, Some(&invalid),)
                        .is_err()
                );
            }
        }
    }
}

#[test]
fn shared_domain_does_not_expand_per_request_budget() {
    let rest: Vec<_> = (0..100_000).flat_map(|_| [0.0, 0.0, 0.0]).collect();
    assert!(
        deform_liquid_object_with_domain(&rest, &controls(), 1.25, 19, true, Some(&domain()),)
            .is_ok()
    );
    let too_large: Vec<_> = (0..100_001).flat_map(|_| [0.0, 0.0, 0.0]).collect();
    assert!(
        deform_liquid_object_with_domain(&too_large, &controls(), 1.25, 19, true, Some(&domain()),)
            .is_err()
    );
}
