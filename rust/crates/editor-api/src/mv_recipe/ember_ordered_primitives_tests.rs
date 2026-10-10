use super::super::plan::{BlitRaster, Command, Operation, Paint, PaintKind, Plan, Step, Style};

fn paint() -> Paint {
    Paint {
        style: Style::Solid { color: [1.0; 4] },
        composite: "source-over",
        opacity: 1.0,
        kind: PaintKind::Fill,
    }
}

fn path(step: Step, operations: Vec<Operation>) -> Plan {
    Plan {
        commands: vec![Command::Path {
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            operations,
            clip: None,
            path: vec![step],
            paints: vec![paint()],
        }],
    }
}

fn ellipse(radius: f64) -> Step {
    Step::Ellipse {
        center: [960.0, 992.0],
        radii: [radius, 60.0],
        rotation: 0.15,
        start: 0.0,
        end: std::f64::consts::TAU,
        anticlockwise: false,
    }
}

#[test]
fn exact_ellipse_and_scaled_matrix_boundary_serialize_without_geometry_approximation() {
    let p = path(
        ellipse(90.0),
        vec![Operation::CopyScaledTransform {
            scale: 0.25,
            offset: [60.0, 60.0],
        }],
    );
    assert!(p.validate_surfaces(0).is_ok());
    let value = serde_json::to_value(&p).unwrap();
    assert_eq!(value["commands"][0]["path"][0]["kind"], "ellipse");
    assert_eq!(
        value["commands"][0]["path"][0]["radii"],
        serde_json::json!([90.0, 60.0])
    );
    assert_eq!(
        value["commands"][0]["operations"][0]["kind"],
        "copyScaledTransform"
    );
    for radius in [-1.0, 8193.0, f64::NAN] {
        assert!(
            path(ellipse(radius), vec![])
                .validate_surfaces(u64::MAX)
                .is_err()
        );
    }
    for scale in [0.0, 9.0, f64::INFINITY] {
        assert!(
            path(
                ellipse(90.0),
                vec![Operation::CopyScaledTransform {
                    scale,
                    offset: [60.0, 60.0],
                }]
            )
            .validate_surfaces(u64::MAX)
            .is_err()
        );
    }
}

#[test]
fn ordered_filter_scratch_is_charged_in_addition_to_legacy_blur() {
    let mut settings = BlitRaster {
        blur_px: 4.0,
        contrast: None,
        smoothing: true,
        smoothing_quality: "low",
    };
    let rect = [0.0, 0.0, 10.0, 20.0];
    assert_eq!(super::filter_pixels(&settings, &rect).unwrap(), 2 * 34 * 44);
    settings.contrast = Some(14.0);
    assert_eq!(super::filter_pixels(&settings, &rect).unwrap(), 4 * 34 * 44);
    settings.blur_px = 0.0;
    assert_eq!(super::filter_pixels(&settings, &rect).unwrap(), 2 * 10 * 20);
    for contrast in [-1.0, 33.0, f64::NAN] {
        settings.contrast = Some(contrast);
        assert!(super::filter_pixels(&settings, &rect).is_err());
    }
}

#[test]
fn brush_ctm_is_explicit_and_stroke_rectangles_cannot_enter_fill_protocol() {
    let mut p = Plan {
        commands: vec![Command::GradientRect {
            transform: [1.0, 0.0, 0.0, 0.15, 0.0, 843.2],
            operations: vec![],
            clip: None,
            rect: [0.0, 0.0, 1920.0, 1080.0],
            paint: paint(),
            style_transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            style_operations: vec![],
        }],
    };
    assert!(p.validate_surfaces(0).is_ok());
    let value = serde_json::to_value(&p).unwrap();
    assert_eq!(value["commands"][0]["kind"], "gradientRect");
    assert_eq!(
        value["commands"][0]["styleTransform"],
        serde_json::json!([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    );
    let Command::GradientRect { paint, .. } = &mut p.commands[0] else {
        panic!()
    };
    paint.kind = PaintKind::Stroke {
        width: 1.0,
        cap: "butt",
        join: "miter",
    };
    assert!(p.validate_surfaces(u64::MAX).is_err());
}
