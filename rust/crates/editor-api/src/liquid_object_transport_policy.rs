use effects::liquid_object::MAX_LIQUID_OBJECT_VERTICES;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiquidObjectTransportPolicy {
    pub version: u8,
    pub max_control_json_bytes: usize,
    pub max_vertices_per_request: usize,
    pub max_request_json_bytes: usize,
    pub max_response_json_bytes: usize,
    pub max_request_envelope_bytes: usize,
    pub max_response_envelope_bytes: usize,
    pub max_meshes_per_frame: usize,
    pub max_vertices_per_frame: usize,
    pub max_requests_per_frame: usize,
    pub max_encoded_bytes_per_frame: usize,
    pub max_retained_payload_bytes_per_frame: usize,
    pub max_in_flight: usize,
    pub request_timeout_ms: u32,
    pub frame_timeout_ms: u32,
    pub cleanup_timeout_ms: u32,
    pub init_timeout_ms: u32,
    pub termination_timeout_ms: u32,
}

pub fn liquid_object_transport_policy() -> LiquidObjectTransportPolicy {
    LiquidObjectTransportPolicy {
        version: 1,
        max_control_json_bytes: 8192,
        max_vertices_per_request: MAX_LIQUID_OBJECT_VERTICES,
        // Preserve the existing evaluator's decimal 12MB input boundary.
        max_request_json_bytes: 12_000_000,
        max_response_json_bytes: 12_000_000,
        max_request_envelope_bytes: 24_004_096,
        max_response_envelope_bytes: 24_004_096,
        max_meshes_per_frame: 32,
        max_vertices_per_frame: 200_000,
        max_requests_per_frame: 64,
        max_encoded_bytes_per_frame: 48_000_000,
        max_retained_payload_bytes_per_frame: 96_000_000,
        max_in_flight: 1,
        request_timeout_ms: 15_000,
        frame_timeout_ms: 30_000,
        cleanup_timeout_ms: 5000,
        init_timeout_ms: 5000,
        termination_timeout_ms: 5000,
    }
}

pub fn liquid_object_transport_policy_json() -> String {
    serde_json::to_string(&liquid_object_transport_policy()).expect("finite static policy")
}

// Reservation includes a conservative f64 JSON representation allowance and
// full escaping of the reply JSON inside a transport envelope. Not GPU memory.
pub(super) fn response_reservation(vertices: usize) -> Option<(usize, usize)> {
    let json = vertices.checked_mul(3)?.checked_mul(32)?.checked_add(512)?;
    let envelope = json.checked_mul(2)?.checked_add(4096)?;
    Some((json, envelope))
}
