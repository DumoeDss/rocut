//! Owner/request identity for production native Blaze output, independent of JS/GPU.
#[derive(Default)]
pub(crate) struct OutputState {
    generation: u32,
    last_request: u32,
    pending: bool,
    disposed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct OutputTicket {
    pub(crate) generation: u32,
    pub(crate) request: u32,
}

impl OutputState {
    pub(crate) fn begin(&mut self, request: u32) -> Result<OutputTicket, &'static str> {
        if self.disposed {
            return Err("Blaze output owner is disposed.");
        }
        if self.pending {
            return Err("Blaze output owner must drain before another request.");
        }
        if request == 0 || request <= self.last_request {
            return Err("Blaze output request must increase and be nonzero.");
        }
        let generation = self
            .generation
            .checked_add(1)
            .ok_or("Blaze output generation exhausted.")?;
        self.generation = generation;
        self.last_request = request;
        self.pending = true;
        Ok(OutputTicket {
            generation,
            request,
        })
    }

    pub(crate) fn current(&self, ticket: OutputTicket) -> bool {
        !self.disposed
            && self.pending
            && self.generation == ticket.generation
            && self.last_request == ticket.request
    }

    pub(crate) fn cancel(&mut self) {
        // Pending remains charged until the owned readback future actually settles.
        // Saturation cannot revive a ticket: disposal is permanent at exhaustion.
        if let Some(generation) = self.generation.checked_add(1) {
            self.generation = generation;
        } else {
            self.disposed = true;
        }
    }
    pub(crate) fn dispose(&mut self) {
        self.disposed = true;
        self.cancel();
    }
    pub(crate) fn pending(&self) -> bool {
        self.pending
    }
    pub(crate) fn finish(&mut self) {
        self.pending = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlap_stale_cancel_and_drain_are_distinct() {
        let mut owner = OutputState::default();
        let first = owner.begin(1).unwrap();
        assert!(owner.current(first));
        assert!(owner.begin(2).is_err());
        owner.cancel();
        assert!(!owner.current(first));
        assert!(owner.pending());
        assert!(owner.begin(2).is_err());
        owner.finish();
        let second = owner.begin(2).unwrap();
        assert!(owner.current(second));
        assert!(!owner.current(first));
    }
    #[test]
    fn duplicate_request_dispose_and_exhaustion_fail_closed() {
        let mut owner = OutputState::default();
        assert!(owner.begin(0).is_err());
        owner.begin(5).unwrap();
        owner.finish();
        assert!(owner.begin(5).is_err());
        assert!(owner.begin(4).is_err());
        let ticket = owner.begin(6).unwrap();
        owner.dispose();
        assert!(!owner.current(ticket));
        owner.finish();
        assert!(owner.begin(7).is_err());
        let mut exhausted = OutputState {
            generation: u32::MAX,
            ..OutputState::default()
        };
        assert!(exhausted.begin(1).is_err());
        exhausted.cancel();
        assert!(exhausted.disposed);
    }
}
