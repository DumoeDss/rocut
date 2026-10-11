#[path = "../src/animation_numeric/mod.rs"]
mod animation_numeric;

use animation_numeric::*;

fn boundary_keys(a: f64, b: f64) -> [ScalarKey; 2] {
    [
        ScalarKey {
            time: 0,
            value: a,
            segment: Segment::Bezier,
            left: None,
            right: Some(Handle { dt: 40000, dv: 0.0 }),
        },
        ScalarKey {
            time: 120000,
            value: b,
            segment: Segment::Linear,
            left: Some(Handle {
                dt: -40000,
                dv: 0.0,
            }),
            right: None,
        },
    ]
}

#[test]
fn finite_bezier_roundoff_stays_inside_authored_blaze_boundaries() {
    for (a, b, min, max, tick) in [
        (1.0, 1.0_f64.next_down(), 0.0, 1.0, 205.0),
        (0.08, 0.08_f64.next_down(), 0.0, 0.08, 2.0),
        (0.1, 0.1_f64.next_up(), 0.1, 1.5, 2.0),
        (-1.0, (-1.0_f64).next_up(), -1.0, 1.0, 205.0),
    ] {
        let keys = boundary_keys(a, b);
        let channel =
            ValidatedChannel::new(&keys, Extrapolation::Hold, Extrapolation::Hold, a).unwrap();
        let value = channel.sample(tick).unwrap();
        assert!(
            value >= a.min(b) && value <= a.max(b),
            "{a:?} {b:?}: {value:?}"
        );
        for tick in 0..=120000 {
            let value = channel.sample(tick as f64).unwrap();
            assert!(value >= a.min(b) && value <= a.max(b));
        }
        let result = channel.check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 120000.0,
            },
            NumericBounds {
                min: Some(min),
                max: Some(max),
                display_multiplier: 1.0,
            },
            CheckBudget::default(),
        );
        assert!(matches!(result, DomainCheck::Safe { .. }), "{result:?}");
    }
}

#[test]
fn real_control_overshoot_and_linear_extrapolation_still_reject() {
    let mut keys = boundary_keys(0.5, 0.5);
    keys[0].right.as_mut().unwrap().dv = 1.0;
    keys[1].left.as_mut().unwrap().dv = 1.0;
    let channel =
        ValidatedChannel::new(&keys, Extrapolation::Hold, Extrapolation::Hold, 0.5).unwrap();
    let bounds = NumericBounds {
        min: Some(0.0),
        max: Some(1.0),
        display_multiplier: 1.0,
    };
    assert!(channel.sample(60000.0).unwrap() > 1.0);
    assert!(matches!(
        channel.check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 120000.0
            },
            bounds,
            CheckBudget::default()
        ),
        DomainCheck::Violation { .. }
    ));
    let mut keys = boundary_keys(0.0, 1.0);
    keys[0].segment = Segment::Linear;
    let channel =
        ValidatedChannel::new(&keys, Extrapolation::Linear, Extrapolation::Linear, 0.0).unwrap();
    assert!(matches!(
        channel.check_closed_domain(
            ClosedDomain {
                start: 0.0,
                end: 240000.0
            },
            bounds,
            CheckBudget::default()
        ),
        DomainCheck::Violation { .. }
    ));
}
