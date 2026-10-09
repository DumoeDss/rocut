use super::*;
use crate::particle_surface_bridge::{ENVELOPE_BYTES, SAMPLE_JSON_BYTES};
use serde_json::{Value, json};

#[test]
fn policy_has_the_exact_versioned_native_schema_and_defaults() {
    let actual: Value = serde_json::from_str(&particle_transport_policy_json()).unwrap();
    assert_eq!(
        actual,
        json!({
            "version": 1,
            "operation": "particleSurface",
            "surfaceVersion": 1,
            "transportVersion": 1,
            "kernel": {
                "maxTriangles": 262144,
                "maxSamples": 65536,
                "maxInputJsonBytes": 67108864,
                "maxOutputJsonBytes": 67108864,
                "maxWorkingBytes": 201326592,
                "maxJsonTokenBytes": 256
            },
            "hostDefaults": {
                "maxTriangles": 16384,
                "maxSamples": 4096,
                "maxRequestJsonBytes": 2097152,
                "maxResponseJsonBytes": 4194304,
                "maxRequestEnvelopeBytes": 4198400,
                "maxResponseEnvelopeBytes": 8392704,
                "maxRequestsPerFrame": 2,
                "maxInFlight": 1,
                "maxFrameRetainedPayloadBytes": 67108864,
                "requestTimeoutMs": 15000,
                "frameTimeoutMs": 30000,
                "process": {
                    "maxPendingRequests": 1,
                    "initTimeoutMs": 5000,
                    "terminationTimeoutMs": 5000
                },
                "cleanupTimeoutMs": 5000
            }
        })
    );
}

#[test]
fn published_hard_limits_use_the_actual_kernel_and_bridge_constants() {
    let p = policy();
    assert_eq!(p.surface_version, SURFACE_VERSION);
    assert_eq!(p.kernel.max_triangles, MAX_SURFACE_TRIANGLES);
    assert_eq!(p.kernel.max_samples, MAX_SURFACE_SAMPLES);
    assert_eq!(p.kernel.max_input_json_bytes, MAX_SURFACE_JSON_BYTES);
    assert_eq!(p.kernel.max_output_json_bytes, MAX_OUTPUT_BYTES);
    assert_eq!(p.kernel.max_working_bytes, MAX_SURFACE_WORKING_BYTES);
    assert_eq!(p.kernel.max_json_token_bytes, MAX_SURFACE_JSON_TOKEN_BYTES);
}

#[test]
fn host_defaults_fit_kernel_limits_and_bound_serial_admission() {
    let p = policy();
    let h = p.host_defaults;
    assert!(h.max_triangles <= p.kernel.max_triangles);
    assert!(h.max_samples <= p.kernel.max_samples);
    assert!(h.max_request_json_bytes <= p.kernel.max_input_json_bytes);
    assert!(h.max_response_json_bytes <= p.kernel.max_output_json_bytes);
    assert!(h.max_in_flight <= h.max_requests_per_frame);
    assert!(h.process.max_pending_requests <= h.max_requests_per_frame);
    assert_eq!(h.max_in_flight, h.process.max_pending_requests);
    assert_eq!(h.max_in_flight, 1);
    assert_eq!(
        h.max_request_envelope_bytes,
        2 * h.max_request_json_bytes + ENVELOPE_HEADROOM_BYTES
    );
    assert_eq!(
        h.max_response_envelope_bytes,
        2 * h.max_response_json_bytes + ENVELOPE_HEADROOM_BYTES
    );
}

#[test]
fn recommended_sample_count_fits_the_actual_bridge_serialization_bound() {
    let h = policy().host_defaults;
    let output = (h.max_samples as usize)
        .checked_mul(SAMPLE_JSON_BYTES)
        .and_then(|bytes| bytes.checked_add(ENVELOPE_BYTES))
        .unwrap();
    assert!(output <= h.max_response_json_bytes);
    let nested_output = output
        .checked_mul(2)
        .and_then(|bytes| bytes.checked_add(ENVELOPE_HEADROOM_BYTES))
        .unwrap();
    assert!(nested_output <= h.max_response_envelope_bytes);
}

fn retained_payload_reservation(h: &HostDefaults, frame_requests: usize) -> Option<usize> {
    let per_request = h
        .max_request_json_bytes
        .checked_add(h.max_response_json_bytes)?
        .checked_add(h.max_request_envelope_bytes)?
        .checked_add(h.max_response_envelope_bytes)?;
    frame_requests
        .checked_mul(per_request)?
        .checked_add(
            h.process
                .max_pending_requests
                .checked_mul(h.max_request_json_bytes)?,
        )?
        .checked_add(h.max_response_json_bytes)
}

#[test]
fn frame_reserves_all_reply_tails_not_only_current_sampling() {
    let h = policy().host_defaults;
    let full_frame = retained_payload_reservation(&h, h.max_requests_per_frame).unwrap();
    assert_eq!(full_frame, 42 * MIB + 16 * 1024);
    assert!(full_frame <= h.max_frame_retained_payload_bytes);
    assert!(full_frame > retained_payload_reservation(&h, h.max_in_flight).unwrap());
    assert!(retained_payload_reservation(&h, 4).unwrap() > h.max_frame_retained_payload_bytes);
    assert_eq!(retained_payload_reservation(&h, usize::MAX), None);
}

#[test]
fn every_numeric_field_is_positive_and_safe_for_javascript_and_deadlines() {
    fn check(value: &Value) {
        match value {
            Value::Number(number) => {
                let value = number.as_u64().expect("policy numbers are integers");
                assert!((1..=9_007_199_254_740_991).contains(&value));
            }
            Value::Object(fields) => fields.values().for_each(check),
            Value::String(_) => {}
            _ => panic!("unexpected policy value"),
        }
    }
    check(&serde_json::from_str(&particle_transport_policy_json()).unwrap());
    let h = policy().host_defaults;
    for timeout in [
        h.request_timeout_ms,
        h.frame_timeout_ms,
        h.cleanup_timeout_ms,
        h.process.init_timeout_ms,
        h.process.termination_timeout_ms,
    ] {
        assert!(timeout <= i32::MAX as u32);
    }
    // The current browser client rejects request timeouts above 30 seconds.
    assert!(h.request_timeout_ms <= 30_000);
    assert!(h.process.init_timeout_ms <= h.request_timeout_ms);
    assert!(h.request_timeout_ms <= h.frame_timeout_ms);
    assert!(h.process.termination_timeout_ms <= h.cleanup_timeout_ms);
}

#[test]
fn native_json_is_stable_and_contains_no_host_specific_inputs() {
    let first = particle_transport_policy_json();
    assert_eq!(first, particle_transport_policy_json());
    assert!(first.len() < 2048);
    assert!(!first.contains('\n'));
    assert_eq!(first, serde_json::to_string(&policy()).unwrap());
}
