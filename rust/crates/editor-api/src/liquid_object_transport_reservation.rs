use super::*;

impl LiquidObjectTransportSession {
    pub(super) fn reserve(
        &mut self,
        identity: LiquidObjectTransportIdentity,
        mesh: u32,
        vertices: usize,
        json_bytes: usize,
        envelope_bytes: usize,
    ) -> Result<Option<LiquidObjectTransportReservation>, LiquidObjectTransportError> {
        self.live()?;
        self.bound_frame(&identity.frame)?;
        let p = liquid_object_transport_policy();
        if identity.request_id != self.next_request || mesh == 0 {
            return Err(Self::error(
                "identity",
                "request ID must be the next monotonic ID and mesh ID nonzero",
            ));
        }
        if self.pending.is_some() {
            return Err(Self::error("inFlight", "one request is already reserved"));
        }
        if vertices == 0
            || vertices > p.max_vertices_per_request
            || json_bytes == 0
            || json_bytes > p.max_request_json_bytes
            || envelope_bytes < json_bytes
            || envelope_bytes > p.max_request_envelope_bytes
        {
            return Err(Self::error(
                "budget",
                "per-request reservation exceeds policy",
            ));
        }
        let (response_json, response_envelope) = response_reservation(vertices)
            .ok_or(Self::error("overflow", "response reservation overflow"))?;
        let add = |a: usize, b: usize| {
            a.checked_add(b)
                .ok_or(Self::error("overflow", "frame accounting overflow"))
        };
        let mut totals = self.totals.clone();
        totals.meshes = add(totals.meshes, usize::from(!self.meshes.contains(&mesh)))?;
        totals.vertices = add(totals.vertices, vertices)?;
        totals.requests = add(totals.requests, 1)?;
        totals.encoded_bytes = add(totals.encoded_bytes, envelope_bytes)?;
        let encoded_reserved = add(totals.encoded_bytes, response_envelope)?;
        let retained = add(
            add(json_bytes, envelope_bytes)?,
            add(response_json, response_envelope)?,
        )?;
        totals.retained_payload_bytes = add(totals.retained_payload_bytes, retained)?;
        if response_json > p.max_response_json_bytes
            || response_envelope > p.max_response_envelope_bytes
            || totals.meshes > p.max_meshes_per_frame
            || totals.vertices > p.max_vertices_per_frame
            || totals.requests > p.max_requests_per_frame
            || encoded_reserved > p.max_encoded_bytes_per_frame
            || totals.retained_payload_bytes > p.max_retained_payload_bytes_per_frame
        {
            return Err(Self::error(
                "budget",
                "whole-frame reservation exceeds policy",
            ));
        }
        let next = self
            .next_request
            .checked_add(1)
            .ok_or(Self::error("overflow", "request ID overflow"))?;
        let reservation = LiquidObjectTransportReservation {
            request_id: identity.request_id,
            max_response_json_bytes: response_json,
            max_response_envelope_bytes: response_envelope,
        };
        self.totals = totals;
        self.meshes.insert(mesh);
        self.next_request = next;
        self.pending = Some(reservation.clone());
        Ok(Some(reservation))
    }

    pub(super) fn settle(
        &mut self,
        identity: LiquidObjectTransportIdentity,
        json_bytes: usize,
        envelope_bytes: usize,
    ) -> Result<Option<LiquidObjectTransportReservation>, LiquidObjectTransportError> {
        self.live()?;
        self.bound_frame(&identity.frame)?;
        let pending = self
            .pending
            .as_ref()
            .ok_or(Self::error("identity", "no request is pending"))?;
        if identity.request_id != pending.request_id {
            return Err(Self::error("identity", "reply request ID mismatch"));
        }
        if json_bytes == 0
            || json_bytes > pending.max_response_json_bytes
            || envelope_bytes < json_bytes
            || envelope_bytes > pending.max_response_envelope_bytes
        {
            return Err(Self::error(
                "budget",
                "actual UTF-8 response bytes exceed reservation",
            ));
        }
        let encoded = self
            .totals
            .encoded_bytes
            .checked_add(envelope_bytes)
            .ok_or(Self::error(
                "overflow",
                "encoded response accounting overflow",
            ))?;
        if encoded > liquid_object_transport_policy().max_encoded_bytes_per_frame {
            return Err(Self::error(
                "budget",
                "whole-frame encoded response bytes exceed policy",
            ));
        }
        self.totals.encoded_bytes = encoded;
        self.pending = None; // Never refund vertices, requests or retained payload reservations.
        Ok(None)
    }
}
