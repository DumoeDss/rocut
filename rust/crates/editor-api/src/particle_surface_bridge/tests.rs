use super::*;
use crate::particle_surface::{MAX_SURFACE_JSON_BYTES, SurfaceSampleRequest, SurfaceTriangle};
use std::io::Write;

fn valid_input(count: u32) -> String {
    serde_json::to_string(&SurfaceSampleRequest {
        triangles: vec![SurfaceTriangle {
            position: [[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            normal: None,
            uv: Some([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]),
            color: Some([[1.0, 0.0, 0.0, 1.0]; 3]),
            primitive_index: 31,
            material_index: Some(47),
        }],
        count,
        seed: 1234,
        motion: None,
    })
    .unwrap()
}

#[test]
fn bridge_returns_a_versioned_success_envelope_with_source_association() {
    let encoded = sample_particle_surface_json(valid_input(3));
    let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["ok"], true);
    assert!(value.get("error").is_none());
    assert_eq!(value.as_object().unwrap().len(), 3);
    let samples = value["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 3);
    for sample in samples {
        assert_eq!(sample["triangleIndex"], 0);
        assert_eq!(sample["primitiveIndex"], 31);
        assert_eq!(sample["materialIndex"], 47);
        assert_eq!(sample["normal"], serde_json::json!([0.0, 0.0, 1.0]));
        assert_eq!(sample["color"], serde_json::json!([1.0, 0.0, 0.0, 1.0]));
        assert_eq!(sample["uv"].as_array().unwrap().len(), 2);
        assert_eq!(sample["barycentric"].as_array().unwrap().len(), 3);
    }
}

#[test]
fn bridge_failures_return_only_the_versioned_error_envelope() {
    for (input, code, path) in [
        (valid_input(0), "sampleCount", "count"),
        ("{}".into(), "invalidJson", "surface"),
        ("{".into(), "invalidJson", "surface"),
        (
            "{\"triangles\":[],\"count\":1,\"seed\":0}".into(),
            "triangleCount",
            "triangles",
        ),
    ] {
        let encoded = sample_particle_surface_json(input);
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["ok"], false);
        assert!(value.get("samples").is_none());
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert_eq!(value["error"]["code"], code);
        assert_eq!(value["error"]["path"], path);
        assert!(!value["error"]["message"].as_str().unwrap().is_empty());
    }
}

#[test]
fn equal_seed_produces_identical_encoded_output() {
    assert_eq!(
        sample_particle_surface_json(valid_input(25)),
        sample_particle_surface_json(valid_input(25))
    );
}

#[test]
fn input_allocation_is_checked_before_parsing_without_allocating_large_fixtures() {
    let error = sample_surface_json_with_allocation("", MAX_SURFACE_JSON_BYTES + 1).unwrap_err();
    assert_eq!(error.code, SurfaceErrorCode::InputBytes);
    let error = sample_surface_json_with_allocation("{}", 1).unwrap_err();
    assert_eq!(error.code, SurfaceErrorCode::InputBytes);
    let mut input = valid_input(1);
    input.reserve(2048);
    assert!(input.capacity() > input.len());
    let result: serde_json::Value =
        serde_json::from_str(&sample_particle_surface_json(input)).unwrap();
    assert_eq!(result["ok"], true);
}

#[test]
fn oversized_lexemes_are_rejected_with_a_short_error() {
    for input in [
        format!("{{\"{}\":0}}", "a".repeat(300)),
        format!("{{\"count\":{}}}", "1".repeat(300)),
        format!("{{\"seed\":\"{}\"}}", "\\u0061".repeat(60)),
    ] {
        let encoded = sample_particle_surface_json(input);
        assert!(encoded.len() < 512);
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "invalidJson");
        assert!(value["error"]["message"].as_str().unwrap().contains("256"));
    }
}

#[test]
fn valid_escaped_field_names_pass_the_lexical_budget() {
    let input = valid_input(1).replace("\"count\"", "\"\\u0063ount\"");
    let encoded = sample_particle_surface_json(input);
    let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(value["ok"], true);
}

#[test]
fn output_budget_checks_maximum_counts_capacity_and_overflow() {
    let maximum =
        output_budget(MAX_SURFACE_SAMPLES as usize, MAX_SURFACE_SAMPLES as usize).unwrap();
    assert!(maximum < MAX_OUTPUT_BYTES);
    assert_eq!(
        output_budget(MAX_SURFACE_SAMPLES as usize + 1, 0)
            .unwrap_err()
            .code,
        SurfaceErrorCode::OutputBytes
    );
    assert_eq!(
        output_budget(usize::MAX, 0).unwrap_err().code,
        SurfaceErrorCode::OutputBytes
    );
    assert_eq!(
        output_budget(1, usize::MAX).unwrap_err().code,
        SurfaceErrorCode::WorkingBytes
    );
    assert_eq!(
        BoundedWriter::new(MAX_OUTPUT_BYTES + 1).err().unwrap().code,
        SurfaceErrorCode::OutputBytes
    );
}

#[test]
fn bounded_writer_refuses_growth_and_partial_writes() {
    let mut writer = BoundedWriter::new(5).unwrap();
    let capacity = writer.bytes.capacity();
    writer.write_all(b"abc").unwrap();
    assert!(writer.write_all(b"def").is_err());
    assert_eq!(writer.bytes, b"abc");
    assert_eq!(writer.bytes.capacity(), capacity);
    assert!(writer.exceeded);
    writer.write_all(b"de").unwrap();
    assert_eq!(writer.bytes, b"abcde");
}

#[test]
fn serializer_limit_failure_discards_partial_json() {
    let error = serialize_bounded(&vec![1234, 5678], 4).unwrap_err();
    assert_eq!(error.code, SurfaceErrorCode::OutputBytes);
    let value: serde_json::Value = serde_json::from_str(&serialize_error(&error)).unwrap();
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "outputBytes");
    assert!(value.get("samples").is_none());
}

#[test]
fn serialization_failure_and_oversized_errors_never_use_panic_paths() {
    struct RefusesSerialization;
    impl Serialize for RefusesSerialization {
        fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("test rejection"))
        }
    }
    let error = serialize_bounded(&RefusesSerialization, 1024).unwrap_err();
    assert_eq!(error.code, SurfaceErrorCode::Serialization);
    let large_error = bridge_error(
        SurfaceErrorCode::InvalidJson,
        &"x".repeat(ERROR_OUTPUT_BYTES + 1),
    );
    let encoded = serialize_error(&large_error);
    assert_eq!(encoded, FALLBACK_ERROR);
    let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "serialization");
}

#[test]
fn maximal_finite_fields_fit_the_per_sample_serialization_bound() {
    let values = [-f64::MAX, f64::MIN_POSITIVE, -f64::from_bits(1)];
    let response = SurfaceSampleResponse {
        samples: vec![SurfaceSample {
            position: values,
            normal: values,
            uv: Some([-f64::MAX, -f64::from_bits(1)]),
            color: Some([-f64::MAX, -f64::MAX, -f64::MAX, -f64::MAX]),
            barycentric: values,
            triangle_index: u32::MAX,
            primitive_index: u32::MAX,
            material_index: Some(u32::MAX),
            motion_position: None,
            size: None,
        }],
    };
    let encoded = serialize_success(&response).unwrap();
    assert!(encoded.len() < SAMPLE_JSON_BYTES + ENVELOPE_BYTES);
    let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(value["samples"].as_array().unwrap().len(), 1);
    assert_eq!(value["samples"][0]["primitiveIndex"], u32::MAX);
}
