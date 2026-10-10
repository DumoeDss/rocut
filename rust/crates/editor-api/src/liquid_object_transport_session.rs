use super::policy::{liquid_object_transport_policy, response_reservation};
use super::types::*;
use std::collections::BTreeSet;

#[path = "liquid_object_transport_command.rs"]
mod command;
#[path = "liquid_object_transport_reservation.rs"]
mod reservation;

pub struct LiquidObjectTransportSession {
    frame: LiquidObjectTransportFrame,
    phase: &'static str,
    terminal: Option<LiquidObjectTransportError>,
    totals: LiquidObjectTransportTotals,
    meshes: BTreeSet<u32>,
    pending: Option<LiquidObjectTransportReservation>,
    next_request: u32,
}

impl LiquidObjectTransportSession {
    pub fn new(frame: LiquidObjectTransportFrame) -> Result<Self, LiquidObjectTransportError> {
        frame.validate()?;
        Ok(Self {
            frame,
            phase: "created",
            terminal: None,
            totals: Default::default(),
            meshes: BTreeSet::new(),
            pending: None,
            next_request: 1,
        })
    }

    pub fn from_frame_json(input: &str) -> Result<Self, LiquidObjectTransportError> {
        if input.len() > liquid_object_transport_policy().max_control_json_bytes {
            return Err(Self::error("budget", "frame identity JSON exceeds policy"));
        }
        Self::new(
            serde_json::from_str(input)
                .map_err(|_| Self::error("json", "strict frame identity required"))?,
        )
    }

    fn error(code: &'static str, message: &'static str) -> LiquidObjectTransportError {
        LiquidObjectTransportError::new(code, message)
    }
    fn bound_frame(
        &self,
        frame: &LiquidObjectTransportFrame,
    ) -> Result<(), LiquidObjectTransportError> {
        if frame != &self.frame {
            return Err(Self::error("identity", "frame identity mismatch"));
        }
        Ok(())
    }
    fn live(&self) -> Result<(), LiquidObjectTransportError> {
        if let Some(error) = &self.terminal {
            return Err(error.clone());
        }
        if self.phase != "open" {
            return Err(Self::error("phase", "operation is outside the open frame"));
        }
        Ok(())
    }

    fn apply(
        &mut self,
        command: Command,
    ) -> Result<Option<LiquidObjectTransportReservation>, LiquidObjectTransportError> {
        match command {
            Command::Dispose { frame } => {
                self.bound_frame(&frame)?;
                self.phase = "disposed";
                self.pending = None;
                Ok(None)
            }
            Command::Fail { frame } => {
                self.bound_frame(&frame)?;
                Err(Self::error("cancelled", "frame terminated by Host"))
            }
            Command::Open { frame } => {
                self.bound_frame(&frame)?;
                if self.phase != "created" {
                    return Err(Self::error("phase", "frame can open exactly once"));
                }
                self.phase = "open";
                Ok(None)
            }
            Command::Close { frame } => {
                self.live()?;
                self.bound_frame(&frame)?;
                if self.pending.is_some() {
                    return Err(Self::error("pending", "cannot close an unsettled frame"));
                }
                self.phase = "closed";
                Ok(None)
            }
            Command::Reserve {
                identity,
                mesh_id,
                vertices,
                request_json_bytes,
                request_envelope_bytes,
            } => self.reserve(
                identity,
                mesh_id,
                vertices,
                request_json_bytes,
                request_envelope_bytes,
            ),
            Command::Settle {
                identity,
                response_json_bytes,
                response_envelope_bytes,
            } => self.settle(identity, response_json_bytes, response_envelope_bytes),
        }
    }
}
