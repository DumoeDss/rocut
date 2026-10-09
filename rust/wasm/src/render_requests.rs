use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RequestError {
    Cancelled,
    Exhausted,
}

struct Request<P> {
    id: u32,
    owner: u64,
    generation: u64,
    payload: P,
}

pub(crate) struct RenderRequests<P> {
    next_request: u32,
    next_owner: u64,
    pending: HashMap<u32, Request<P>>,
}

impl<P> Default for RenderRequests<P> {
    fn default() -> Self {
        Self {
            next_request: 1,
            next_owner: 1,
            pending: HashMap::new(),
        }
    }
}

impl<P> RenderRequests<P> {
    pub fn new_owner(&mut self) -> Result<u64, RequestError> {
        let id = self.next_owner;
        self.next_owner = id.checked_add(1).ok_or(RequestError::Exhausted)?;
        Ok(id)
    }

    pub fn begin(
        &mut self,
        handle: u32,
        owner: u64,
        generation: u64,
        payload: P,
    ) -> Result<u32, RequestError> {
        let id = self.next_request;
        self.next_request = id.checked_add(1).ok_or(RequestError::Exhausted)?;
        self.pending.insert(
            handle,
            Request {
                id,
                owner,
                generation,
                payload,
            },
        );
        Ok(id)
    }

    pub fn take(
        &mut self,
        handle: u32,
        id: u32,
        owner: u64,
        generation: u64,
    ) -> Result<P, RequestError> {
        let Some(request) = self.pending.get(&handle) else {
            return Err(RequestError::Cancelled);
        };
        // A late callback for an old id never consumes its replacement.
        if request.id != id {
            return Err(RequestError::Cancelled);
        }
        let request = self.pending.remove(&handle).unwrap();
        if request.owner != owner || request.generation != generation {
            return Err(RequestError::Cancelled);
        }
        Ok(request.payload)
    }

    pub fn restore(&mut self, handle: u32, id: u32, owner: u64, generation: u64, payload: P) {
        self.pending.insert(
            handle,
            Request {
                id,
                owner,
                generation,
                payload,
            },
        );
    }

    pub fn cancel(&mut self, handle: u32, id: u32) {
        if self
            .pending
            .get(&handle)
            .is_some_and(|request| request.id == id)
        {
            self.pending.remove(&handle);
        }
    }

    pub fn invalidate(&mut self, handle: u32) {
        self.pending.remove(&handle);
    }

    // GPU reset clears payloads, never the monotonically allocated identities.
    pub fn clear(&mut self) {
        self.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_cancel_and_take_do_not_remove_replacement() {
        let mut requests = RenderRequests::default();
        let owner = requests.new_owner().unwrap();
        let old = requests.begin(1, owner, 0, 11).unwrap();
        let new = requests.begin(1, owner, 1, 22).unwrap();
        requests.cancel(1, old);
        assert_eq!(
            requests.take(1, old, owner, 0),
            Err(RequestError::Cancelled)
        );
        assert_eq!(requests.take(1, new, owner, 1), Ok(22));
    }

    #[test]
    fn mutation_and_new_owner_cannot_commit_old_payload() {
        let mut requests = RenderRequests::default();
        let owner = requests.new_owner().unwrap();
        let id = requests.begin(0, owner, 1, 11).unwrap();
        assert_eq!(requests.take(0, id, owner, 2), Err(RequestError::Cancelled));
        let id = requests.begin(0, owner, 2, 22).unwrap();
        let other = requests.new_owner().unwrap();
        assert_eq!(requests.take(0, id, other, 2), Err(RequestError::Cancelled));
    }

    #[test]
    fn reset_never_reuses_request_or_owner_identity() {
        let mut requests = RenderRequests::default();
        let owner = requests.new_owner().unwrap();
        let old = requests.begin(0, owner, 0, 11).unwrap();
        requests.clear();
        let next_owner = requests.new_owner().unwrap();
        let next = requests.begin(0, next_owner, 0, 22).unwrap();
        assert_ne!(old, next);
        assert_ne!(owner, next_owner);
        requests.cancel(0, old);
        assert_eq!(requests.take(0, next, next_owner, 0), Ok(22));
    }

    #[test]
    fn invalidate_drops_only_selected_owner_payload() {
        let mut requests = RenderRequests::default();
        let a = requests.begin(1, 1, 0, 11).unwrap();
        let b = requests.begin(2, 2, 0, 22).unwrap();
        requests.invalidate(1);
        assert_eq!(requests.take(1, a, 1, 0), Err(RequestError::Cancelled));
        assert_eq!(requests.take(2, b, 2, 0), Ok(22));
    }

    #[test]
    fn restored_chunk_is_owned_until_cancel_and_drop_releases_payload() {
        use std::cell::Cell;
        use std::rc::Rc;
        struct Payload(Rc<Cell<u32>>);
        impl Drop for Payload {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }
        let drops = Rc::new(Cell::new(0));
        let mut requests = RenderRequests::default();
        let id = requests.begin(1, 1, 0, Payload(drops.clone())).unwrap();
        let payload = requests.take(1, id, 1, 0).unwrap();
        requests.restore(1, id, 1, 0, payload);
        assert_eq!(drops.get(), 0);
        requests.cancel(1, id);
        assert_eq!(drops.get(), 1);
        requests.clear();
        assert_eq!(drops.get(), 1);
    }
}
