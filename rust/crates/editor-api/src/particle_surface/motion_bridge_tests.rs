use super::*;

fn input(moving: bool) -> String {
    let mut value = serde_json::json!({"triangles":[{"position":[[0,0,0],[1,0,0],[0,1,0]],"primitiveIndex":17,"materialIndex":29}],"count":2,"seed":1977});
    if moving {
        value["motion"] = serde_json::json!({"version":1,"timeTicks":240000,"scatterStartTicks":0,"scatterDurationTicks":120000,"holdDurationTicks":120000,"returnDurationTicks":120000,"scatterDistance":4,"driftAmplitude":0,"driftFrequency":0.5,"size":2,"sizeVariance":1});
    }
    value.to_string()
}

#[test]
fn nonmotion_json_matches_the_frozen_c1_wasm_bytes_exactly() {
    // Actual da14d668 C1 WASM, captured before C3. Not derived from this implementation.
    let golden = r#"{"version":1,"ok":true,"samples":[{"position":[0.16202120342323012,0.30633624652721037,0.0],"normal":[0.0,0.0,1.0],"barycentric":[0.5316425500495595,0.16202120342323012,0.30633624652721037],"triangleIndex":0,"primitiveIndex":17,"materialIndex":29},{"position":[0.6864410065675081,0.23032382098290566,0.0],"normal":[0.0,0.0,1.0],"barycentric":[0.08323517244958634,0.6864410065675081,0.23032382098290566],"triangleIndex":0,"primitiveIndex":17,"materialIndex":29}]}"#;
    assert_eq!(sample_particle_surface_json(input(false)), golden);
}

#[test]
fn motion_bridge_adds_only_paired_motion_fields_and_preserves_base_association() {
    let legacy: serde_json::Value =
        serde_json::from_str(&sample_particle_surface_json(input(false))).unwrap();
    let encoded = sample_particle_surface_json(input(true));
    let mut moving: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(moving["ok"], true);
    for sample in moving["samples"].as_array_mut().unwrap() {
        assert_eq!(sample["motionPosition"].as_array().unwrap().len(), 3);
        assert!(sample["size"].as_f64().unwrap() > 0.0);
        sample.as_object_mut().unwrap().remove("motionPosition");
        sample.as_object_mut().unwrap().remove("size");
    }
    assert_eq!(moving, legacy);
    assert_eq!(encoded, sample_particle_surface_json(input(true)));
}

#[test]
fn motion_output_allocation_is_bounded_at_maximum_count_and_overflow() {
    assert_eq!(
        output_budget(2, 2).unwrap(),
        2 * SAMPLE_JSON_BYTES + ENVELOPE_BYTES
    );
    let limit = output_budget_with_motion(
        MAX_SURFACE_SAMPLES as usize,
        MAX_SURFACE_SAMPLES as usize,
        true,
    )
    .unwrap();
    assert_eq!(limit, 65_536 * 960 + ENVELOPE_BYTES);
    assert!(limit < MAX_OUTPUT_BYTES);
    assert_eq!(
        output_budget_with_motion(usize::MAX, 0, true)
            .unwrap_err()
            .code,
        SurfaceErrorCode::OutputBytes
    );
    assert_eq!(
        output_budget_with_motion(1, usize::MAX, true)
            .unwrap_err()
            .code,
        SurfaceErrorCode::WorkingBytes
    );
}

#[test]
fn all_nineteen_finite_floats_fit_motion_json_bound() {
    let extreme = [-f64::MAX, f64::MIN_POSITIVE, -f64::from_bits(1)];
    let response = SurfaceSampleResponse {
        samples: vec![SurfaceSample {
            position: extreme,
            normal: extreme,
            uv: Some([-f64::MAX, -f64::from_bits(1)]),
            color: Some([-f64::MAX; 4]),
            barycentric: extreme,
            triangle_index: u32::MAX,
            primitive_index: u32::MAX,
            material_index: Some(u32::MAX),
            motion_position: Some(extreme),
            size: Some(f64::MAX),
        }],
    };
    let encoded = serialize_success(&response).unwrap();
    assert!(encoded.len() <= MOTION_SAMPLE_JSON_BYTES + ENVELOPE_BYTES);
    assert!(serde_json::from_str::<serde_json::Value>(&encoded).is_ok());
}

#[test]
fn invalid_motion_has_no_partial_samples_and_reports_existing_structured_errors() {
    let mut value: serde_json::Value = serde_json::from_str(&input(true)).unwrap();
    value["motion"]["timeTicks"] = 9_007_199_254_740_992_u64.into();
    let output: serde_json::Value =
        serde_json::from_str(&sample_particle_surface_json(value.to_string())).unwrap();
    assert_eq!(output["ok"], false);
    assert!(output.get("samples").is_none());
    assert_eq!(output["error"]["code"], "numericRange");
    assert_eq!(output["error"]["path"], "motion.timeTicks");
}
