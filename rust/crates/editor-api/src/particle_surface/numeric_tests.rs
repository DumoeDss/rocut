use super::*;
use crate::particle_surface::{
    SurfaceErrorCode, SurfaceSampleRequest, SurfaceTriangle, sample_surface,
};

fn triangle(position: [[f64; 3]; 3]) -> SurfaceTriangle {
    SurfaceTriangle {
        position,
        normal: None,
        uv: None,
        color: None,
        primitive_index: 0,
        material_index: None,
    }
}

fn request(triangles: Vec<SurfaceTriangle>) -> SurfaceSampleRequest {
    SurfaceSampleRequest {
        triangles,
        count: 8,
        seed: 0,
        motion: None,
    }
}

fn regular() -> SurfaceTriangle {
    triangle([[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
}

fn cancellation_underflow() -> SurfaceTriangle {
    let epsilon = f64::EPSILON;
    let minimum = f64::MIN_POSITIVE;
    // Exact determinant = minimum * epsilon^2 = 2^-1126, not zero.
    // Both rounded products are normal, but the fused subtraction underflows.
    triangle([
        [0.0; 3],
        [1.0 + epsilon, minimum, 0.0],
        [1.0 + 2.0 * epsilon, minimum * (1.0 + epsilon), 0.0],
    ])
}

#[test]
fn single_positive_face_with_cancellation_underflow_is_a_numeric_error() {
    for reversed in [false, true] {
        let mut source = cancellation_underflow();
        if reversed {
            source.position.swap(1, 2);
        }
        let error = sample_surface(&request(vec![source])).unwrap_err();
        assert_eq!(error.code, SurfaceErrorCode::NumericRange);
        assert_eq!(error.path, "triangles[0].position");
    }
}

#[test]
fn mixed_surface_never_silently_discards_a_positive_underflowed_face() {
    for first in [false, true] {
        let sources = if first {
            vec![cancellation_underflow(), regular()]
        } else {
            vec![regular(), cancellation_underflow()]
        };
        let error = sample_surface(&request(sources)).unwrap_err();
        assert_eq!(error.code, SurfaceErrorCode::NumericRange);
        assert_eq!(
            error.path,
            if first {
                "triangles[0].position"
            } else {
                "triangles[1].position"
            }
        );
    }
}

#[test]
fn truly_degenerate_faces_remain_zero_even_when_their_products_underflow() {
    let minimum = f64::MIN_POSITIVE;
    for position in [
        [[0.0; 3]; 3],
        [
            [0.0; 3],
            [1.0, minimum, minimum],
            [2.0, 2.0 * minimum, 2.0 * minimum],
        ],
    ] {
        assert!(triangle_geometry(&position, 0).unwrap().is_none());
        let samples = sample_surface(&request(vec![triangle(position), regular()]))
            .unwrap()
            .samples;
        assert!(samples.iter().all(|sample| sample.triangle_index == 1));
    }
    assert_eq!(
        determinant(minimum, minimum, 2.0 * minimum, 0.5 * minimum, 0).unwrap(),
        0.0
    );
    assert_eq!(
        determinant(-minimum, minimum, minimum, -minimum, 0).unwrap(),
        0.0
    );
    assert_eq!(determinant(-0.0, 1.0, 0.0, 2.0, 0).unwrap(), 0.0);
}

#[test]
fn distinct_underflowed_products_are_not_mistaken_for_equal_zeros() {
    let minimum = f64::MIN_POSITIVE;
    for (c, d) in [(minimum, 2.0 * minimum), (-minimum, minimum)] {
        let error = determinant(minimum, minimum, c, d, 3).unwrap_err();
        assert_eq!(error.code, SurfaceErrorCode::NumericRange);
        assert_eq!(error.path, "triangles[3].position");
    }
}

#[test]
fn representable_near_collinear_faces_keep_the_compensated_determinant() {
    let epsilon = f64::EPSILON;
    for (position, expected_exponent) in [
        (
            [[0.0; 3], [1.0, 1.0, 0.0], [1.0, 1.0 + 4.0 * epsilon, 0.0]],
            -51,
        ),
        (
            [
                [0.0; 3],
                [1.0 + epsilon, 1.0, 0.0],
                [1.0 + 2.0 * epsilon, 1.0 + epsilon, 0.0],
            ],
            -105,
        ),
    ] {
        let (area, normal) = triangle_geometry(&position, 0).unwrap().unwrap();
        assert_eq!(area.mantissa, 1.0);
        assert_eq!(area.exponent, expected_exponent);
        assert_eq!(normal, [0.0, 0.0, 1.0]);
        assert_eq!(
            sample_surface(&request(vec![triangle(position)]))
                .unwrap()
                .samples
                .len(),
            8
        );
    }
}

#[test]
fn uniformly_extreme_scales_preserve_samples_and_unit_normals() {
    let reference = sample_surface(&request(vec![regular()])).unwrap();
    for scale in [f64::MIN_POSITIVE, 1e-250, 1e250] {
        let source = triangle([[0.0; 3], [scale, 0.0, 0.0], [0.0, scale, 0.0]]);
        let result = sample_surface(&request(vec![source])).unwrap();
        for (actual, expected) in result.samples.iter().zip(&reference.samples) {
            assert_eq!(actual.barycentric, expected.barycentric);
            assert_eq!(actual.normal, expected.normal);
            for axis in 0..3 {
                assert!((actual.position[axis] / scale - expected.position[axis]).abs() < 1e-14);
            }
        }
    }
}
