use super::{
    math::TAU,
    plan::{Action as A, Draw, Style, color},
};
fn shape(d: &mut Draw, r: f64) {
    d.a(A::BeginPath);
    d.a(A::MoveTo {
        point: [0.0, -r * 2.05],
    });
    d.a(A::BezierCurveTo {
        control1: [r * 0.3, -r * 1.35],
        control2: [r * 1.02, -r * 0.62],
        point: [r, 0.0],
    });
    d.a(A::Arc {
        center: [0.0, 0.0],
        radius: r,
        start: 0.0,
        end: std::f64::consts::PI,
    });
    d.a(A::BezierCurveTo {
        control1: [-r * 1.02, -r * 0.62],
        control2: [-r * 0.3, -r * 1.35],
        point: [0.0, -r * 2.05],
    });
    d.a(A::ClosePath);
}
pub fn drop(d: &mut Draw, x: f64, y: f64, r: f64, t: f64, refr: bool, mirror: bool) {
    let wob = (t * 10.5).sin() * 0.055;
    d.a(A::Save);
    d.a(A::Translate { offset: [x, y] });
    d.a(A::Scale {
        factors: [1.0 + wob, (1.0 - wob) * if mirror { -1.0 } else { 1.0 }],
    });
    if refr {
        d.a(A::Save);
        shape(d, r);
        d.a(A::Clip);
        d.a(A::Scale {
            factors: [1.0, -1.0],
        });
        d.a(A::Alpha { value: 0.9 });
        d.image(
            "road-refraction",
            None,
            [-r * 1.25, -r * 1.6, r * 2.5, r * 2.9],
            false,
        );
        d.a(A::Restore);
    }
    shape(d, r);
    d.radial(
        [-r * 0.1, -r * 0.2, r * 0.2],
        [0.0, -r * 0.3, r * 1.9],
        &[
            (0.0, [180.0, 215.0, 255.0], 0.05),
            (0.62, [40.0, 50.0, 80.0], 0.18),
            (1.0, [6.0, 8.0, 16.0], 0.75),
        ],
    );
    d.a(A::Fill);
    d.a(A::Save);
    d.a(A::Clip);
    d.a(A::Composite { value: "lighter" });
    d.radial(
        [r * 0.05, r * 0.62, 0.0],
        [r * 0.05, r * 0.62, r * 0.75],
        &[
            (0.0, [255.0, 214.0, 170.0], 0.95),
            (0.4, [246.0, 168.0, 150.0], 0.35),
            (1.0, [246.0, 168.0, 150.0], 0.0),
        ],
    );
    d.rect([-r, -r, r * 2.0, r * 2.0]);
    d.a(A::Restore);
    d.a(A::StrokeStyle {
        style: Style::Linear {
            from: [0.0, -r * 2.0],
            to: [0.0, r],
            stops: vec![
                (0.0, color([210.0, 235.0, 255.0], 0.55)),
                (0.55, color([210.0, 235.0, 255.0], 0.25)),
                (1.0, color([255.0, 215.0, 185.0], 0.95)),
            ],
        },
    });
    d.a(A::Composite { value: "lighter" });
    d.a(A::LineWidth { value: 1.6 });
    d.a(A::Stroke);
    d.fill([255.0, 255.0, 255.0], 0.95);
    d.a(A::Save);
    d.a(A::Translate {
        offset: [-r * 0.4, -r * 0.42],
    });
    d.a(A::Rotate { radians: -0.55 });
    d.a(A::BeginPath);
    d.a(A::Ellipse {
        center: [0.0, 0.0],
        radii: [r * 0.13, r * 0.38],
        rotation: 0.0,
        start: 0.0,
        end: TAU,
    });
    d.a(A::Fill);
    d.a(A::Restore);
    d.a(A::BeginPath);
    d.a(A::Arc {
        center: [r * 0.36, r * 0.3],
        radius: r * 0.07,
        start: 0.0,
        end: TAU,
    });
    d.a(A::Fill);
    d.a(A::Restore);
}
