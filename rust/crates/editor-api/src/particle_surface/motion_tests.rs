use super::*;

fn motion(time_ticks: u64) -> motion::SurfaceMotion {
    motion::SurfaceMotion {
        version: 1,
        time_ticks,
        scatter_start_ticks: 100,
        scatter_duration_ticks: 200,
        hold_duration_ticks: 100,
        return_duration_ticks: 200,
        scatter_distance: 4.0,
        drift_amplitude: 0.0,
        drift_frequency: 0.5,
        size: 2.0,
        size_variance: 1.0,
    }
}

fn request(time: u64, count: u32) -> SurfaceSampleRequest {
    SurfaceSampleRequest {
        triangles: vec![SurfaceTriangle {
            position: [[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            normal: Some([[0.0, 0.0, 1.0]; 3]),
            uv: Some([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]),
            color: Some([[0.1, 0.2, 0.3, 1.0]; 3]),
            primitive_index: 17,
            material_index: Some(29),
        }],
        count,
        seed: 1977,
        motion: Some(motion(time)),
    }
}

fn sample(time: u64) -> Vec<SurfaceSample> {
    sample_surface(&request(time, 8)).unwrap().samples
}

#[test]
fn scatter_hold_return_endpoints_and_midpoints_are_seekable() {
    let base = sample(100);
    for time in [0, 99, 100, 600, 601, motion::MAX_TIME_TICKS] {
        for item in sample(time) {
            assert_eq!(item.motion_position.unwrap(), item.position);
        }
    }
    let out = sample(300);
    assert_eq!(out, sample(350));
    assert_eq!(out, sample(400));
    assert_eq!(sample(200), sample(500));
    for ((rest, full), half) in base.iter().zip(&out).zip(sample(200)) {
        for axis in 0..3 {
            let expected = rest.position[axis]
                + (full.motion_position.unwrap()[axis] - rest.position[axis]) * 0.5;
            assert!((half.motion_position.unwrap()[axis] - expected).abs() < 1e-14);
        }
    }
    // Arbitrary reverse seeks do not depend on a previously evaluated frame.
    let expected = sample(431);
    for time in [599, 0, 500, 101, 300] {
        let _ = sample(time);
    }
    assert_eq!(sample(431), expected);
}

#[test]
fn motion_never_changes_base_sampling_and_count_prefix_or_time_randomness() {
    let moving = request(287, 16);
    let mut legacy = moving.clone();
    legacy.motion = None;
    let legacy = sample_surface(&legacy).unwrap();
    let result = sample_surface(&moving).unwrap();
    for (sample, base) in result.samples.iter().zip(&legacy.samples) {
        let mut unchanged = sample.clone();
        unchanged.motion_position = None;
        unchanged.size = None;
        assert_eq!(&unchanged, base);
    }
    let mut more = moving.clone();
    more.count = 64;
    assert_eq!(result.samples, sample_surface(&more).unwrap().samples[..16]);
    let mut later = moving.clone();
    later.motion.as_mut().unwrap().time_ticks = 520;
    let later = sample_surface(&later).unwrap();
    for (a, b) in result.samples.iter().zip(later.samples) {
        assert_eq!(a.size, b.size);
    }
    let mut other = moving;
    other.seed += 1;
    assert_ne!(result, sample_surface(&other).unwrap());
}

#[test]
fn scatter_and_continuous_idle_drift_are_bounded_and_periodic() {
    let mut input = request(350, 2048);
    input.motion.as_mut().unwrap().drift_amplitude = 2.0;
    for value in sample_surface(&input).unwrap().samples {
        let distance = value
            .motion_position
            .unwrap()
            .iter()
            .zip(value.position)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        assert!(distance <= 6.0 + 1e-12);
        assert!((1.0..3.0).contains(&value.size.unwrap()));
    }
    let parameters = input.motion.as_mut().unwrap();
    parameters.scatter_distance = 0.0;
    parameters.time_ticks = 0;
    let zero = sample_surface(&input).unwrap();
    input.motion.as_mut().unwrap().time_ticks = 240_000;
    assert_eq!(zero, sample_surface(&input).unwrap());
    assert!(
        zero.samples
            .iter()
            .any(|value| value.motion_position.unwrap() != value.position)
    );
    input.motion.as_mut().unwrap().time_ticks = motion::MAX_TIME_TICKS;
    input.motion.as_mut().unwrap().drift_frequency = 100.0;
    assert!(
        sample_surface(&input)
            .unwrap()
            .samples
            .iter()
            .all(|value| value.motion_position.unwrap().iter().all(|v| v.is_finite()))
    );
}

#[test]
fn normalized_size_variance_has_a_strict_positive_lower_bound() {
    let mut input = request(300, 4096);
    input.motion.as_mut().unwrap().size = 1e-100;
    for value in sample_surface(&input).unwrap().samples {
        assert!(value.size.unwrap() >= 0.5e-100);
        assert!(value.size.unwrap() < 1.5e-100);
    }
    input.motion.as_mut().unwrap().size_variance = 0.0;
    for value in sample_surface(&input).unwrap().samples {
        assert_eq!(value.size, Some(1e-100));
    }
}

#[test]
fn motion_ranges_reject_nonfinite_invalid_versions_and_unsafe_ticks() {
    for (field, value, code) in [
        ("scatterDistance", -1.0, SurfaceErrorCode::NumericRange),
        ("scatterDistance", f64::MAX, SurfaceErrorCode::NumericRange),
        (
            "driftAmplitude",
            1_000_001.0,
            SurfaceErrorCode::NumericRange,
        ),
        ("driftFrequency", 100.1, SurfaceErrorCode::NumericRange),
        ("size", 0.0, SurfaceErrorCode::NumericRange),
        ("sizeVariance", 1.1, SurfaceErrorCode::NumericRange),
        ("size", f64::NAN, SurfaceErrorCode::NonFinite),
        ("driftAmplitude", f64::INFINITY, SurfaceErrorCode::NonFinite),
    ] {
        let mut input = request(1, 1);
        let parameters = input.motion.as_mut().unwrap();
        match field {
            "scatterDistance" => parameters.scatter_distance = value,
            "driftAmplitude" => parameters.drift_amplitude = value,
            "driftFrequency" => parameters.drift_frequency = value,
            "size" => parameters.size = value,
            _ => parameters.size_variance = value,
        }
        let error = sample_surface(&input).unwrap_err();
        assert_eq!(error.code, code);
        assert_eq!(error.path, format!("motion.{field}"));
    }
    for (field, ticks) in [
        ("timeTicks", motion::MAX_TIME_TICKS + 1),
        ("scatterStartTicks", u64::MAX),
        ("scatterDurationTicks", 0),
        ("returnDurationTicks", 0),
    ] {
        let mut input = request(1, 1);
        let parameters = input.motion.as_mut().unwrap();
        match field {
            "timeTicks" => parameters.time_ticks = ticks,
            "scatterStartTicks" => parameters.scatter_start_ticks = ticks,
            "scatterDurationTicks" => parameters.scatter_duration_ticks = ticks,
            _ => parameters.return_duration_ticks = ticks,
        }
        assert_eq!(
            sample_surface(&input).unwrap_err().path,
            format!("motion.{field}")
        );
    }
    let mut input = request(1, 1);
    input.motion.as_mut().unwrap().version = 2;
    assert_eq!(sample_surface(&input).unwrap_err().path, "motion.version");
}

#[test]
fn checked_endpoints_include_hold_and_return_and_allow_zero_hold() {
    let mut input = request(1, 1);
    input.motion.as_mut().unwrap().scatter_start_ticks = motion::MAX_TIME_TICKS - 199;
    assert_eq!(
        sample_surface(&input).unwrap_err().path,
        "motion.scatterDurationTicks"
    );
    input.motion.as_mut().unwrap().scatter_start_ticks = motion::MAX_TIME_TICKS - 299;
    assert_eq!(
        sample_surface(&input).unwrap_err().path,
        "motion.holdDurationTicks"
    );
    input.motion.as_mut().unwrap().scatter_start_ticks = motion::MAX_TIME_TICKS - 499;
    assert_eq!(
        sample_surface(&input).unwrap_err().path,
        "motion.returnDurationTicks"
    );
    input.motion.as_mut().unwrap().scatter_start_ticks = motion::MAX_TIME_TICKS - 500;
    assert!(sample_surface(&input).is_ok());
    input.motion.as_mut().unwrap().hold_duration_ticks = 0;
    assert!(sample_surface(&input).is_ok());
}

#[test]
fn motion_schema_rejects_null_missing_unknown_duplicate_and_noninteger_time() {
    let original = serde_json::to_value(request(1, 1)).unwrap();
    let mut cases = Vec::new();
    for invalid in [
        serde_json::Value::Null,
        serde_json::json!({}),
        serde_json::json!([]),
    ] {
        let mut value = original.clone();
        value["motion"] = invalid;
        cases.push(value.to_string());
    }
    let mut unknown = original.clone();
    unknown["motion"]["authorTime"] = 0.into();
    cases.push(unknown.to_string());
    let mut fractional = original.clone();
    fractional["motion"]["timeTicks"] = 1.5.into();
    cases.push(fractional.to_string());
    cases.push(
        original
            .to_string()
            .replace("\"version\":1", "\"version\":1,\"version\":1"),
    );
    for json in cases {
        assert_eq!(
            sample_surface_json(&json).unwrap_err().code,
            SurfaceErrorCode::InvalidJson
        );
    }
}

#[test]
fn motion_fixed_state_and_expanded_sample_struct_are_in_the_working_budget() {
    assert!(
        size_of::<motion::SurfaceMotion>() + size_of::<motion::PreparedMotion>() + 256
            <= motion::MOTION_FIXED_WORKING_BYTES
    );
    let fixed =
        size_of::<PreparedTriangle>() + size_of::<SurfaceSample>() + SURFACE_FIXED_OVERHEAD_BYTES;
    let capacity = (MAX_SURFACE_WORKING_BYTES - fixed) / size_of::<SurfaceTriangle>();
    check_budget(1, capacity, 1, 0).unwrap();
    assert_eq!(
        check_budget_with_motion(1, capacity, 1, 0, true)
            .unwrap_err()
            .code,
        SurfaceErrorCode::WorkingBytes
    );
    check_budget_with_motion(
        MAX_SURFACE_TRIANGLES,
        MAX_SURFACE_TRIANGLES,
        MAX_SURFACE_SAMPLES,
        MAX_SURFACE_JSON_BYTES,
        true,
    )
    .unwrap();
}
