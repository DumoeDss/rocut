//! Isolated CPU numerical tests. Does not compile/wire editor-api or claim pixels.
#[path = "../../rust/crates/editor-api/src/mv_recipe/tunnel_math.rs"]
mod math;
#[path = "../../rust/crates/editor-api/src/mv_recipe/converge_math.rs"]
mod seeded;
#[test]
fn original_closed_form_camera_and_travel() {
    let p = math::vp(1.0);
    assert!((p[0] - (960.0 + 34.0 * 1.25f64.sin() + 12.0 * 2.1f64.sin())).abs() < 1e-12);
    assert!((p[1] - (540.0 + 20.0 * 1.9f64.sin())).abs() < 1e-12);
    assert_eq!(math::travel(-1.0, 4.0, 3.1, 9.5), -3.1);
    assert!((math::travel(4.0, 4.0, 3.1, 9.5) - (12.4 + 6.4 * 4.0 / 3.0)).abs() < 1e-12);
    assert!(
        (math::travel(5.0, 4.0, 3.1, 9.5) - math::travel(4.0, 4.0, 3.1, 9.5) - 9.5).abs() < 1e-12
    );
}
#[test]
fn original_house_easing_and_byte_domain_color() {
    assert_eq!(math::soft(0.0), 0.0);
    assert_eq!(math::soft(1.0), 1.0);
    assert!((math::io(0.5) - 0.5).abs() < 1e-12);
    assert_eq!(
        math::css(
            math::mix(math::rgb(0x120c22), math::rgb(0x241634), 0.5),
            1.0
        ),
        [27.0 / 255.0, 17.0 / 255.0, 43.0 / 255.0, 1.0]
    );
}
