use super::*;

impl LiquidObjectTransportSession {
    pub fn command_json(&mut self, input: &str) -> String {
        let result = (|| {
            if input.len() > liquid_object_transport_policy().max_control_json_bytes {
                return Err(Self::error("budget", "control JSON exceeds policy"));
            }
            if let Some(error) = &self.terminal {
                // Disposal retires ownership but never restores admission after failure.
                if let Ok(Command::Dispose { frame }) = serde_json::from_str(input) {
                    self.bound_frame(&frame)?;
                    self.phase = "disposed";
                    self.pending = None;
                    return Err(error.clone());
                }
                return Err(error.clone());
            }
            self.apply(
                serde_json::from_str(input)
                    .map_err(|_| Self::error("json", "strict transport command required"))?,
            )
        })();
        match result {
            Ok(reservation) => serde_json::json!({"version":1,"ok":true,"phase":self.phase,
                "totals":self.totals,"pending":self.pending.is_some(),"reservation":reservation})
            .to_string(),
            Err(error) => {
                if self.terminal.is_none() {
                    self.terminal = Some(error.clone());
                }
                if self.phase != "disposed" {
                    self.phase = "failed";
                }
                serde_json::json!({"version":1,"ok":false,"phase":self.phase,"error":self.terminal,
                    "totals":self.totals,"pending":self.pending.is_some()})
                .to_string()
            }
        }
    }
}
