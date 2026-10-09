use super::*;

fn triangle() -> SurfaceTriangle {
    SurfaceTriangle {
        position: [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        normal: None,
        uv: None,
        color: None,
        primitive_index: 17,
        material_index: Some(29),
    }
}

fn request(triangles: Vec<SurfaceTriangle>, count: u32) -> SurfaceSampleRequest {
    SurfaceSampleRequest {
        triangles,
        count,
        seed: 1977,
        motion: None,
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} differs from {expected}, tolerance {tolerance}"
    );
}

fn assert_error(request: &SurfaceSampleRequest, code: SurfaceErrorCode) -> SurfaceError {
    let error = sample_surface(request).unwrap_err();
    assert_eq!(error.code, code, "{error:?}");
    error
}

#[test]
fn splitmix64_stream_is_fixed_and_uniforms_are_half_open() {
    let mut random = SplitMix64(0);
    assert_eq!(random.next(), 0xe220_a839_7b1d_cdaf);
    assert_eq!(random.next(), 0x6e78_9e6a_a1b9_65f4);
    assert_eq!(random.next(), 0x06c4_5d18_8009_454f);
    for _ in 0..10_000 {
        assert!((0.0..1.0).contains(&random.unit()));
    }
}

#[test]
fn seed_replays_exact_samples_and_different_seeds_change_them() {
    let mut input = request(vec![triangle()], 100);
    let first = sample_surface(&input).unwrap();
    assert_eq!(first, sample_surface(&input).unwrap());
    input.seed += 1;
    assert_ne!(first, sample_surface(&input).unwrap());
}

#[test]
fn triangle_selection_uses_true_area_not_triangle_count_or_edge_length() {
    let small = triangle();
    let mut large = triangle();
    large.position = [[10.0, 0.0, 2.0], [10.0, 3.0, 2.0], [10.0, 0.0, 5.0]];
    large.primitive_index = 99;
    large.material_index = Some(88);
    let samples = sample_surface(&request(vec![small, large], MAX_SURFACE_SAMPLES))
        .unwrap()
        .samples;
    let small_count = samples
        .iter()
        .filter(|sample| sample.triangle_index == 0)
        .count();
    close(small_count as f64 / samples.len() as f64, 0.1, 0.004);
    for sample in samples {
        match sample.triangle_index {
            0 => {
                assert_eq!(
                    (sample.primitive_index, sample.material_index),
                    (17, Some(29))
                );
                close(sample.position[2], 0.0, 0.0);
            }
            1 => {
                assert_eq!(
                    (sample.primitive_index, sample.material_index),
                    (99, Some(88))
                );
                close(sample.position[0], 10.0, 0.0);
                assert!(sample.position[2] >= 2.0);
                assert_eq!(sample.normal, [1.0, 0.0, 0.0]);
            }
            other => panic!("Unexpected source triangle {other}"),
        }
    }
}

#[test]
fn barycentric_distribution_has_uniform_simplex_moments_and_corner_mass() {
    let samples = sample_surface(&request(vec![triangle()], MAX_SURFACE_SAMPLES))
        .unwrap()
        .samples;
    let mut means = [0.0; 3];
    let mut squares = [0.0; 3];
    let mut product = 0.0;
    let mut near_corner = 0;
    for sample in &samples {
        let b = sample.barycentric;
        close(b.iter().sum(), 1.0, 4.5e-16);
        assert!(b.iter().all(|value| (0.0..=1.0).contains(value)));
        close(sample.position[0], b[1], 3e-16);
        close(sample.position[1], b[2], 3e-16);
        for axis in 0..3 {
            means[axis] += b[axis];
            squares[axis] += b[axis] * b[axis];
        }
        product += b[0] * b[1];
        near_corner += usize::from(b[0] > 0.9);
    }
    let count = samples.len() as f64;
    for axis in 0..3 {
        close(means[axis] / count, 1.0 / 3.0, 0.004);
        close(squares[axis] / count, 1.0 / 6.0, 0.003);
    }
    close(product / count, 1.0 / 12.0, 0.002);
    close(near_corner as f64 / count, 0.01, 0.002);
}

#[test]
fn position_normals_uv_and_rgba_share_the_same_barycentric_coordinates() {
    let mut source = triangle();
    source.position = [[1.0, 2.0, 3.0], [5.0, 2.0, 4.0], [1.0, 8.0, 6.0]];
    source.normal = Some([[2.0, 0.0, 0.0], [0.0, 3.0, 0.0], [0.0, 0.0, 4.0]]);
    source.uv = Some([[-3.0, 2.0], [7.0, 6.0], [5.0, -4.0]]);
    source.color = Some([
        [1.0, 0.0, 0.0, 0.2],
        [0.0, 1.0, 0.0, 0.6],
        [0.0, 0.0, 1.0, 1.0],
    ]);
    let samples = sample_surface(&request(vec![source.clone()], 100))
        .unwrap()
        .samples;
    for sample in samples {
        let b = sample.barycentric;
        for axis in 0..3 {
            let expected = (0..3)
                .map(|vertex| source.position[vertex][axis] * b[vertex])
                .sum();
            close(sample.position[axis], expected, 3e-15);
        }
        let normal = [2.0 * b[0], 3.0 * b[1], 4.0 * b[2]];
        let length = normal.iter().map(|value| value * value).sum::<f64>().sqrt();
        for axis in 0..3 {
            close(sample.normal[axis], normal[axis] / length, 5e-15);
            close(sample.color.unwrap()[axis], b[axis], 5e-16);
        }
        close(
            sample.normal.iter().map(|value| value * value).sum::<f64>(),
            1.0,
            5e-16,
        );
        close(
            sample.color.unwrap()[3],
            0.2 * b[0] + 0.6 * b[1] + b[2],
            5e-16,
        );
        for axis in 0..2 {
            let expected = (0..3)
                .map(|vertex| source.uv.unwrap()[vertex][axis] * b[vertex])
                .sum();
            close(sample.uv.unwrap()[axis], expected, 3e-15);
        }
    }
}

#[test]
fn omitted_attributes_stay_absent_and_winding_controls_geometric_normal() {
    let mut reversed = triangle();
    reversed.position.swap(1, 2);
    for (source, expected_z) in [(triangle(), 1.0), (reversed, -1.0)] {
        let sample = sample_surface(&request(vec![source], 1))
            .unwrap()
            .samples
            .remove(0);
        assert_eq!(sample.normal, [0.0, 0.0, expected_z]);
        assert_eq!(sample.uv, None);
        assert_eq!(sample.color, None);
    }
}

#[test]
fn degenerate_triangles_get_no_probability_but_preserve_source_indices() {
    let mut collapsed = triangle();
    collapsed.position = [[0.0; 3]; 3];
    let mut collinear = triangle();
    collinear.position = [[0.0; 3], [1.0, 2.0, 3.0], [2.0, 4.0, 6.0]];
    let input = request(vec![collapsed.clone(), triangle(), collinear.clone()], 100);
    assert!(
        sample_surface(&input)
            .unwrap()
            .samples
            .iter()
            .all(|sample| sample.triangle_index == 1)
    );
    assert_error(
        &request(vec![collapsed, collinear], 1),
        SurfaceErrorCode::AllDegenerate,
    );
}

#[test]
fn area_weights_and_normals_survive_extreme_uniform_world_scales() {
    let reference = sample_surface(&request(vec![triangle()], 100)).unwrap();
    for scale in [1e-250, 1e250] {
        let mut source = triangle();
        for vertex in &mut source.position {
            for value in vertex {
                *value *= scale;
            }
        }
        let result = sample_surface(&request(vec![source], 100)).unwrap();
        for (sample, expected) in result.samples.iter().zip(&reference.samples) {
            assert_eq!(sample.barycentric, expected.barycentric);
            assert_eq!(sample.normal, expected.normal);
            for axis in 0..3 {
                close(
                    sample.position[axis] / scale,
                    expected.position[axis],
                    5e-16,
                );
            }
        }
    }
}

#[test]
fn multiple_areas_keep_their_ratio_when_actual_areas_overflow_or_underflow() {
    for scale in [1e-250, 1e250] {
        let mut small = triangle();
        let mut large = triangle();
        small.position = [[0.0; 3], [scale, 0.0, 0.0], [0.0, scale, 0.0]];
        large.position = [[0.0; 3], [scale * 3.0, 0.0, 0.0], [0.0, scale * 3.0, 0.0]];
        let samples = sample_surface(&request(vec![small, large], 20_000))
            .unwrap()
            .samples;
        let share = samples
            .iter()
            .filter(|sample| sample.triangle_index == 0)
            .count() as f64
            / samples.len() as f64;
        close(share, 0.1, 0.008);
    }
}

#[test]
fn overflowing_coordinate_differences_still_sample_finite_world_positions() {
    let mut source = triangle();
    source.position = [
        [-f64::MAX, -f64::MAX, 0.0],
        [f64::MAX, -f64::MAX, 0.0],
        [-f64::MAX, f64::MAX, 0.0],
    ];
    let samples = sample_surface(&request(vec![source], 100)).unwrap().samples;
    for sample in samples {
        assert!(sample.position.iter().all(|value| value.is_finite()));
        assert_eq!(sample.normal, [0.0, 0.0, 1.0]);
    }
}

#[test]
fn near_parallel_edges_are_not_confused_with_zero_area() {
    let mut source = triangle();
    source.position = [
        [0.0; 3],
        [1.0, 1.0, 0.0],
        [1.0, 1.0 + 4.0 * f64::EPSILON, 0.0],
    ];
    let sample = sample_surface(&request(vec![source], 1))
        .unwrap()
        .samples
        .remove(0);
    assert_eq!(sample.normal, [0.0, 0.0, 1.0]);
}

#[test]
fn input_and_working_set_limits_are_checked_without_large_allocations() {
    assert_eq!(
        check_budget(0, 0, 1, 0).unwrap_err().code,
        SurfaceErrorCode::TriangleCount
    );
    assert_eq!(
        check_budget(MAX_SURFACE_TRIANGLES + 1, 0, 1, 0)
            .unwrap_err()
            .code,
        SurfaceErrorCode::TriangleCount
    );
    assert_eq!(
        check_budget(1, 1, 0, 0).unwrap_err().code,
        SurfaceErrorCode::SampleCount
    );
    assert_eq!(
        check_budget(1, 1, MAX_SURFACE_SAMPLES + 1, 0)
            .unwrap_err()
            .code,
        SurfaceErrorCode::SampleCount
    );
    assert_eq!(
        check_budget(1, usize::MAX, 1, 0).unwrap_err().code,
        SurfaceErrorCode::WorkingBytes
    );
    assert_eq!(
        check_budget(1, MAX_SURFACE_WORKING_BYTES, 1, 0)
            .unwrap_err()
            .code,
        SurfaceErrorCode::WorkingBytes
    );
    assert_eq!(
        check_budget(1, 1, 1, MAX_SURFACE_JSON_BYTES + 1)
            .unwrap_err()
            .code,
        SurfaceErrorCode::InputBytes
    );
    check_budget(
        MAX_SURFACE_TRIANGLES,
        MAX_SURFACE_TRIANGLES,
        MAX_SURFACE_SAMPLES,
        MAX_SURFACE_JSON_BYTES,
    )
    .unwrap();
    assert_eq!(
        sample_surface(&request(vec![triangle()], 1))
            .unwrap()
            .samples
            .len(),
        1
    );
}

#[test]
fn finite_shape_strictness_is_enforced_at_the_json_boundary() {
    let valid = serde_json::to_value(request(vec![triangle()], 1)).unwrap();
    assert_eq!(
        sample_surface_json(&valid.to_string())
            .unwrap()
            .samples
            .len(),
        1
    );
    let mut malformed = Vec::new();
    for (field, value) in [
        ("position", serde_json::json!([[0, 0, 0], [1, 0, 0]])),
        ("position", serde_json::json!([[0, 0], [1, 0], [0, 1]])),
        ("normal", serde_json::json!([[0, 0, 1], [0, 0, 1]])),
        ("uv", serde_json::json!([[0, 0, 0], [1, 0, 0], [0, 1, 0]])),
        (
            "color",
            serde_json::json!([[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
        ),
        ("primitiveIndex", serde_json::json!(-1)),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut value_json = valid.clone();
        value_json["triangles"][0][field] = value;
        malformed.push(value_json);
    }
    for (field, value) in [
        ("seed", serde_json::json!(4294967296_u64)),
        ("count", serde_json::json!(1.5)),
        ("extra", serde_json::json!(0)),
    ] {
        let mut value_json = valid.clone();
        value_json[field] = value;
        malformed.push(value_json);
    }
    for value_json in malformed {
        assert_eq!(
            sample_surface_json(&value_json.to_string())
                .unwrap_err()
                .code,
            SurfaceErrorCode::InvalidJson
        );
    }
    assert_eq!(
        sample_surface_json("{\"count\":1e999}").unwrap_err().code,
        SurfaceErrorCode::InvalidJson
    );
}

#[test]
fn nonfinite_attributes_are_rejected_even_on_unselected_or_degenerate_faces() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in ["position", "normal", "uv", "color"] {
            let mut bad = triangle();
            match field {
                "position" => bad.position[0][0] = value,
                "normal" => bad.normal = Some([[value, 0.0, 1.0]; 3]),
                "uv" => bad.uv = Some([[value, 0.0]; 3]),
                "color" => bad.color = Some([[value, 0.0, 0.0, 1.0]; 3]),
                _ => unreachable!(),
            }
            let error = assert_error(
                &request(vec![triangle(), bad], 1),
                SurfaceErrorCode::NonFinite,
            );
            assert!(error.path.contains(field));
        }
    }
}

#[test]
fn out_of_range_rgba_and_zero_vertex_normals_are_rejected() {
    for value in [-0.001, 1.001] {
        for channel in 0..4 {
            let mut bad = triangle();
            let mut colors = [[0.5; 4]; 3];
            colors[2][channel] = value;
            bad.color = Some(colors);
            assert_error(&request(vec![bad], 1), SurfaceErrorCode::ColorRange);
        }
    }
    let mut bad = triangle();
    bad.normal = Some([[0.0; 3]; 3]);
    assert_error(&request(vec![bad], 1), SurfaceErrorCode::ZeroNormal);
}

#[test]
fn cancelling_interpolated_normals_have_a_specific_error() {
    let mut input = request(vec![triangle()], 1);
    let mut random = SplitMix64(u64::from(input.seed));
    random.unit();
    let radial = random.unit().sqrt();
    input.triangles[0].normal = Some([
        [-radial, 0.0, 0.0],
        [1.0 - radial, 0.0, 0.0],
        [1.0 - radial, 0.0, 0.0],
    ]);
    let error = assert_error(&input, SurfaceErrorCode::NormalCancellation);
    assert_eq!(error.path, "samples[0].normal");
}

#[test]
fn very_large_and_small_nonunit_normals_are_normalized_after_interpolation() {
    for value in [1e-300, 1e300] {
        let mut source = triangle();
        source.normal = Some([[value, value, value]; 3]);
        let sample = sample_surface(&request(vec![source], 1))
            .unwrap()
            .samples
            .remove(0);
        for actual in sample.normal {
            close(actual, 1.0 / 3.0_f64.sqrt(), 2e-16);
        }
    }
}

#[test]
fn unsupported_aspect_and_area_ranges_fail_without_dropping_positive_faces() {
    let mut skinny = triangle();
    skinny.position = [[0.0; 3], [1e300, 1e-300, 0.0], [0.0, 1.0, 0.0]];
    assert_error(&request(vec![skinny], 1), SurfaceErrorCode::NumericRange);
    let mut tiny = triangle();
    tiny.position = [[0.0; 3], [1e-100, 0.0, 0.0], [0.0, 1e-100, 0.0]];
    assert_error(
        &request(vec![triangle(), tiny], 1),
        SurfaceErrorCode::NumericRange,
    );
}
