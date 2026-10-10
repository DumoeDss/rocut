#[path = "../src/animation_numeric/mod.rs"]
mod animation_numeric;

use animation_numeric::*;

fn key(time: u64, value: f64, segment: Segment) -> ScalarKey {
    ScalarKey {
        time,
        value,
        segment,
        left: None,
        right: None,
    }
}

fn channel(keys: &[ScalarKey]) -> ValidatedChannel<'_> {
    ValidatedChannel::new(keys, Extrapolation::Hold, Extrapolation::Hold, 0.5).unwrap()
}

fn bounds() -> NumericBounds {
    NumericBounds {
        min: Some(0.0),
        max: Some(1.0),
        display_multiplier: 1.0,
    }
}

fn check(keys: &[ScalarKey], end: f64) -> DomainCheck {
    channel(keys).check_closed_domain(
        ClosedDomain { start: 0.0, end },
        bounds(),
        CheckBudget::default(),
    )
}

fn safe(result: DomainCheck) {
    assert!(matches!(result, DomainCheck::Safe { .. }), "{result:?}");
}

fn outside(result: DomainCheck) {
    assert!(
        matches!(
            result,
            DomainCheck::Violation {
                issue: NumericIssue {
                    kind: IssueKind::OutsideBounds,
                    ..
                },
                ..
            }
        ),
        "{result:?}"
    );
}

fn curved(dv: f64) -> [ScalarKey; 2] {
    let mut keys = [
        key(0, 0.5, Segment::Bezier),
        key(120000, 0.5, Segment::Linear),
    ];
    keys[0].right = Some(Handle { dt: 40000, dv });
    keys[1].left = Some(Handle { dt: -40000, dv });
    keys
}

#[test]
fn constant_control_values_are_exact_at_every_integer_tick() {
    for value in [0.0, 1.0, -1.0, f64::MAX] {
        let keys = [
            key(0, value, Segment::Bezier),
            key(120000, value, Segment::Linear),
        ];
        let curve = channel(&keys);
        for time in 0..=120000 {
            assert_eq!(
                curve.sample(time as f64).unwrap().to_bits(),
                value.to_bits()
            );
        }
    }
    let keys = [
        key(0, 1.0, Segment::Bezier),
        key(120000, 1.0, Segment::Linear),
    ];
    safe(check(&keys, 120000.0));
    safe(channel(&keys).check_closed_domain(
        ClosedDomain {
            start: 0.0,
            end: 120000.0,
        },
        bounds(),
        CheckBudget::new(0).unwrap(),
    ));
}

#[test]
fn equal_endpoints_are_not_mistaken_for_constant_controls() {
    let keys = curved(2.0);
    assert_eq!(
        channel(&keys).sample(60000.0).unwrap().to_bits(),
        1.9999999999986358_f64.to_bits()
    );
    outside(check(&keys, 120000.0));
}

#[test]
fn controls_outside_bounds_can_form_a_safe_curve() {
    let keys = curved(0.6);
    assert_eq!(
        channel(&keys).sample(60000.0).unwrap().to_bits(),
        0.9499999999995907_f64.to_bits()
    );
    safe(check(&keys, 120000.0));
}

#[test]
fn unreachable_tail_is_not_part_of_shortened_domain() {
    let keys = curved(2.0);
    assert_eq!(
        channel(&keys).sample(1000.0).unwrap().to_bits(),
        0.5495853964480375_f64.to_bits()
    );
    safe(check(&keys, 1000.0));
    outside(check(&keys, 60000.0));
}

#[test]
fn linear_hold_and_extrapolation_retain_existing_values() {
    let keys = [
        key(0, 0.2, Segment::Linear),
        key(120000, 0.4, Segment::Linear),
    ];
    let curve =
        ValidatedChannel::new(&keys, Extrapolation::Linear, Extrapolation::Linear, 0.5).unwrap();
    assert_eq!(
        curve.sample(240000.0).unwrap().to_bits(),
        0.6000000000000001_f64.to_bits()
    );
    assert_eq!(
        curve.sample(600000.0).unwrap().to_bits(),
        1.2000000000000002_f64.to_bits()
    );
    assert_eq!(
        channel(&keys).sample(600000.0).unwrap().to_bits(),
        0.4_f64.to_bits()
    );
    safe(curve.check_closed_domain(
        ClosedDomain {
            start: 0.0,
            end: 240000.0,
        },
        bounds(),
        CheckBudget::default(),
    ));
    outside(curve.check_closed_domain(
        ClosedDomain {
            start: 0.0,
            end: 600000.0,
        },
        bounds(),
        CheckBudget::default(),
    ));
}

#[test]
fn step_segment_does_not_change_linear_edge_semantics() {
    let keys = [
        key(0, 0.2, Segment::Step),
        key(120000, 0.4, Segment::Linear),
    ];
    let curve =
        ValidatedChannel::new(&keys, Extrapolation::Hold, Extrapolation::Linear, 0.5).unwrap();
    assert_eq!(curve.sample(60000.0).unwrap(), 0.2);
    assert_eq!(curve.sample(120000.0).unwrap(), 0.4);
    assert_eq!(
        curve.sample(240000.0).unwrap().to_bits(),
        0.6000000000000001_f64.to_bits()
    );
}

#[test]
fn exact_duration_endpoint_is_checked() {
    let keys = [key(0, 0.5, Segment::Step), key(100, 2.0, Segment::Linear)];
    safe(check(&keys, 100.0_f64.next_down()));
    outside(check(&keys, 100.0));
}

#[test]
fn display_multiplier_is_applied_without_dividing_bounds() {
    let keys = [key(0, 0.2, Segment::Linear), key(100, 0.4, Segment::Linear)];
    let check = |multiplier, min, max| {
        channel(&keys).check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 100.0,
            },
            NumericBounds {
                min: Some(min),
                max: Some(max),
                display_multiplier: multiplier,
            },
            CheckBudget::default(),
        )
    };
    safe(check(100.0, 20.0, 40.0));
    safe(check(-100.0, -40.0, -20.0));
    safe(check(0.0, 0.0, 0.0));
    outside(check(100.0, 20.0, 39.0));
}

#[test]
fn numerical_uncertainty_is_not_success_and_budget_is_bounded() {
    // Each nonconstant segment needs at least one certificate node, including
    // when a tighter enclosure proves that segment immediately.
    let keys: Vec<_> = (0..=4)
        .map(|index| {
            key(
                index * 30000,
                if index % 2 == 0 { 0.25 } else { 0.75 },
                Segment::Bezier,
            )
        })
        .collect();
    for budget in [0, 1, 2, 3] {
        let result = channel(&keys).check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 120000.0,
            },
            bounds(),
            CheckBudget::new(budget).unwrap(),
        );
        assert!(
            matches!(result, DomainCheck::Unresolved { issue: NumericIssue { kind: IssueKind::BudgetExhausted, .. }, visited_nodes, .. } if visited_nodes == budget),
            "{result:?}"
        );
    }
    assert!(matches!(
        check(&keys, 120000.0),
        DomainCheck::Safe {
            visited_nodes: 4,
            ..
        }
    ));
    assert!(CheckBudget::new(MAX_CHECK_NODES + 1).is_err());
}

#[test]
fn empty_and_single_key_channels_use_finite_constant_values() {
    let empty =
        ValidatedChannel::new(&[], Extrapolation::Linear, Extrapolation::Linear, 0.25).unwrap();
    assert_eq!(empty.sample(-100.0).unwrap(), 0.25);
    safe(empty.check_closed_domain(
        ClosedDomain {
            start: -100.0,
            end: 100.0,
        },
        bounds(),
        CheckBudget::default(),
    ));
    let keys = [key(10, 0.75, Segment::Bezier)];
    let single =
        ValidatedChannel::new(&keys, Extrapolation::Linear, Extrapolation::Linear, 0.5).unwrap();
    assert_eq!(single.sample(-100.0).unwrap(), 0.75);
    assert_eq!(single.sample(1000000.0).unwrap(), 0.75);
}

#[test]
fn invalid_inputs_and_nonfinite_intermediate_values_are_diagnostic() {
    assert!(
        ValidatedChannel::new(
            &[key(MAX_SAFE_TICKS + 1, 0.5, Segment::Linear)],
            Extrapolation::Hold,
            Extrapolation::Hold,
            0.5
        )
        .is_err()
    );
    assert!(
        ValidatedChannel::new(
            &[key(0, 0.5, Segment::Linear), key(0, 0.7, Segment::Linear)],
            Extrapolation::Hold,
            Extrapolation::Hold,
            0.5
        )
        .is_err()
    );
    let keys = [
        key(0, -f64::MAX, Segment::Linear),
        key(100, f64::MAX, Segment::Linear),
    ];
    assert_eq!(
        channel(&keys).sample(50.0).unwrap_err().kind,
        IssueKind::NonFiniteArithmetic
    );
    assert!(matches!(
        channel(&keys).check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 100.0
            },
            NumericBounds {
                min: None,
                max: None,
                display_multiplier: 1.0
            },
            CheckBudget::default()
        ),
        DomainCheck::Violation {
            issue: NumericIssue {
                kind: IssueKind::NonFiniteArithmetic,
                ..
            },
            ..
        }
    ));
    assert_eq!(
        channel(&keys).sample(f64::NAN).unwrap_err().kind,
        IssueKind::NonFiniteTime
    );
    assert!(matches!(
        check(&keys, -1.0),
        DomainCheck::Unresolved {
            issue: NumericIssue {
                kind: IssueKind::InvalidDomain,
                ..
            },
            ..
        }
    ));
}

#[test]
fn bezier_matches_existing_typescript_twenty_step_inversion_bits() {
    let base = [
        key(0, 0.2, Segment::Bezier),
        key(120000, 0.8, Segment::Linear),
    ];
    let mut crossed = base;
    crossed[0].right = Some(Handle {
        dt: 999999,
        dv: 0.3,
    });
    crossed[1].left = Some(Handle {
        dt: -999999,
        dv: -0.2,
    });
    let large = [
        key(9_007_199_254_620_991, 0.2, Segment::Bezier),
        key(MAX_SAFE_TICKS, 0.8, Segment::Linear),
    ];
    // Captured from the existing TS sampler, including its absolute-x rounding.
    let fixtures: [([ScalarKey; 2], [u64; 4], [u64; 4]); 3] = [
        (
            base,
            [1, 205, 60000, 119999],
            [
                0x3fc999c266666666,
                0x3fc9bb30cccccccd,
                0x3fdffffecccccccc,
                0x3fe9998f66666667,
            ],
        ),
        (
            crossed,
            [1, 205, 60000, 119999],
            [
                0x3fc999ab9997b99a,
                0x3fc9aa65f75a3d4b,
                0x3fe1333093331533,
                0x3fe999969999d59a,
            ],
        ),
        (
            large,
            [
                9_007_199_254_620_992,
                9_007_199_254_621_196,
                9_007_199_254_680_991,
                9_007_199_254_740_990,
            ],
            [
                0x3fc999af33333333,
                0x3fc9bb2733333334,
                0x3fdffffecccccccc,
                0x3fe9998bcccccccd,
            ],
        ),
    ];
    for (keys, times, expected_bits) in fixtures {
        for (time, bits) in times.into_iter().zip(expected_bits) {
            assert_eq!(channel(&keys).sample(time as f64).unwrap().to_bits(), bits);
        }
        safe(channel(&keys).check_closed_domain(
            ClosedDomain {
                start: keys[0].time as f64,
                end: keys[1].time as f64,
            },
            bounds(),
            CheckBudget::default(),
        ));
    }
}

#[test]
fn certificates_enclose_independent_fractional_and_integer_samples() {
    for dv in [-0.6, 0.1, 0.4, 0.6] {
        let keys = curved(dv);
        let curve = channel(&keys);
        let result = check(&keys, 120000.0);
        let DomainCheck::Safe {
            values,
            displayed,
            visited_nodes,
        } = result
        else {
            panic!("{result:?}")
        };
        assert!(visited_nodes <= 4096);
        for index in 0..=2000 {
            let time = index as f64 * 59.99975;
            let value = curve.sample(time).unwrap();
            assert!(values.min <= value && value <= values.max);
            assert!(displayed.min <= value && value <= displayed.max);
        }
    }
}

#[test]
fn violation_witnesses_are_actual_samples_not_control_points() {
    for dv in [-2.0, 2.0] {
        let keys = curved(dv);
        let result = check(&keys, 120000.0);
        let DomainCheck::Violation {
            time,
            value: Some(value),
            ..
        } = result
        else {
            panic!("{result:?}")
        };
        assert!((0.0..=120000.0).contains(&time));
        assert_eq!(
            channel(&keys).sample(time).unwrap().to_bits(),
            value.to_bits()
        );
        assert!(!(0.0..=1.0).contains(&value));
    }
}

#[test]
fn a_nonconstant_boundary_curve_without_a_certificate_remains_unresolved() {
    let keys = curved(2.0 / 3.0);
    let result = channel(&keys).check_closed_domain(
        ClosedDomain {
            start: 0.0,
            end: 120000.0,
        },
        bounds(),
        CheckBudget::new(0).unwrap(),
    );
    assert!(
        matches!(
            result,
            DomainCheck::Unresolved {
                issue: NumericIssue {
                    kind: IssueKind::BudgetExhausted,
                    ..
                },
                ..
            }
        ),
        "{result:?}"
    );
}

#[test]
fn bezier_control_overflow_and_invalid_bounds_are_not_certified() {
    let mut keys = [
        key(0, f64::MAX, Segment::Bezier),
        key(100, f64::MAX, Segment::Linear),
    ];
    keys[0].right = Some(Handle {
        dt: 20,
        dv: f64::MAX,
    });
    assert_eq!(
        channel(&keys).sample(50.0).unwrap_err().kind,
        IssueKind::NonFiniteArithmetic
    );
    let result = channel(&keys).check_closed_domain(
        ClosedDomain {
            start: 50.0,
            end: 50.0,
        },
        NumericBounds {
            min: None,
            max: None,
            display_multiplier: 1.0,
        },
        CheckBudget::default(),
    );
    assert!(matches!(
        result,
        DomainCheck::Violation {
            issue: NumericIssue {
                kind: IssueKind::NonFiniteArithmetic,
                ..
            },
            ..
        }
    ));
    let result = channel(&keys).check_closed_domain(
        ClosedDomain {
            start: 0.0,
            end: 100.0,
        },
        NumericBounds {
            min: Some(1.0),
            max: Some(0.0),
            display_multiplier: 1.0,
        },
        CheckBudget::default(),
    );
    assert!(matches!(
        result,
        DomainCheck::Unresolved {
            issue: NumericIssue {
                kind: IssueKind::InvalidBounds,
                ..
            },
            ..
        }
    ));
}
