use super::*;
fn controls() -> LiquidObjectControls {
    LiquidObjectControls {
        amount: 0.35,
        frequency: 4.0,
        speed: 1.0,
        twist: 0.5,
    }
}
const REST: [f64; 12] = [
    -1.0, -1.0, 0.0, 1.0, -1.0, 0.0, 1.0, 1.0, 0.0, -1.0, 1.0, 0.0,
];
#[test]
fn seek_order_and_seed_are_explicit() {
    let first = deform_liquid_object(&REST, &controls(), 1.25, 19, true).unwrap();
    let _ = deform_liquid_object(&REST, &controls(), 20.0, 19, true).unwrap();
    assert_eq!(
        first,
        deform_liquid_object(&REST, &controls(), 1.25, 19, true).unwrap()
    );
    assert_ne!(
        first,
        deform_liquid_object(&REST, &controls(), 1.25, 400_000_000, true).unwrap()
    );
    assert_ne!(first.positions, REST);
    assert!(first.positions.iter().all(|v| v.is_finite()));
}
#[test]
fn restoration_and_static_time_are_exact() {
    let mut c = controls();
    assert_eq!(
        deform_liquid_object(&REST, &c, 3.0, 19, false)
            .unwrap()
            .positions,
        REST
    );
    c.amount = 0.0;
    assert!(
        deform_liquid_object(&REST, &c, 3.0, 19, true)
            .unwrap()
            .restore
    );
    c.amount = 0.35;
    c.speed = 0.0;
    assert_eq!(
        deform_liquid_object(&REST, &c, 0.0, 19, true),
        deform_liquid_object(&REST, &c, 86400.0, 19, true)
    );
}
#[test]
fn budgets_and_nonfinite_input_fail_closed() {
    for rest in [
        vec![],
        vec![0.0; 2],
        vec![f64::NAN; 3],
        vec![1_000_001.0; 3],
        vec![0.0; 300_003],
    ] {
        assert!(deform_liquid_object(&rest, &controls(), 0.0, 0, true).is_err());
    }
    for time in [f64::NAN, -1.0, 86400.1, f64::INFINITY] {
        assert!(deform_liquid_object(&REST, &controls(), time, 0, true).is_err());
    }
    let mut c = controls();
    c.amount = 1.1;
    assert!(deform_liquid_object(&REST, &c, 0.0, 0, true).is_err());
}
#[test]
fn degenerate_rest_is_preserved() {
    assert!(
        deform_liquid_object(&[2.0; 9], &controls(), 1.0, 5, true)
            .unwrap()
            .restore
    );
}
