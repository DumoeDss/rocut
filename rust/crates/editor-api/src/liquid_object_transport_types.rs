use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiquidObjectTransportFrame {
    pub session_id: String,
    pub index: u64,
    pub time: f64,
    pub seed: u32,
}

impl LiquidObjectTransportFrame {
    pub fn validate(&self) -> Result<(), LiquidObjectTransportError> {
        if self.session_id.is_empty()
            || self.session_id.len() > 64
            || !self
                .session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || self.index > 9_007_199_254_740_991
            || !self.time.is_finite()
            || !(0.0..=86_400.0).contains(&self.time)
        {
            return Err(LiquidObjectTransportError::new(
                "identity",
                "invalid trusted mapped frame identity",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiquidObjectTransportIdentity {
    pub frame: LiquidObjectTransportFrame,
    pub request_id: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LiquidObjectTransportError {
    pub code: &'static str,
    pub message: &'static str,
}
impl LiquidObjectTransportError {
    pub(super) fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiquidObjectTransportTotals {
    pub meshes: usize,
    pub vertices: usize,
    pub requests: usize,
    pub encoded_bytes: usize,
    pub retained_payload_bytes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiquidObjectTransportReservation {
    pub request_id: u32,
    pub max_response_json_bytes: usize,
    pub max_response_envelope_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Command {
    Open {
        frame: LiquidObjectTransportFrame,
    },
    #[serde(rename_all = "camelCase")]
    Reserve {
        identity: LiquidObjectTransportIdentity,
        mesh_id: u32,
        vertices: usize,
        request_json_bytes: usize,
        request_envelope_bytes: usize,
    },
    #[serde(rename_all = "camelCase")]
    Settle {
        identity: LiquidObjectTransportIdentity,
        response_json_bytes: usize,
        response_envelope_bytes: usize,
    },
    Close {
        frame: LiquidObjectTransportFrame,
    },
    Fail {
        frame: LiquidObjectTransportFrame,
    },
    Dispose {
        frame: LiquidObjectTransportFrame,
    },
}
