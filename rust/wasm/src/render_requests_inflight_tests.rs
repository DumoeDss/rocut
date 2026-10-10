use super::*;

#[test]
fn replacement_rejects_late_restore_finish_and_cancel() {
    let mut r = RenderRequests::default();
    let old = r.begin(1, 1, 0, 11).unwrap();
    let payload = r.take(1, old, 1, 0).unwrap();
    let new = r.begin(1, 2, 1, 22).unwrap();
    assert_eq!(
        r.restore(1, old, 1, 0, payload),
        Err(RequestError::Cancelled)
    );
    assert_eq!(r.finish(1, old, 1, 0), Err(RequestError::Cancelled));
    r.cancel(1, old);
    assert_eq!(r.take(1, new, 2, 1), Ok(22));
    assert_eq!(r.pending.len(), 1);
    r.finish(1, new, 2, 1).unwrap();
    assert!(r.pending.is_empty());
}

#[test]
fn cancel_invalidate_and_clear_prevent_inflight_resurrection() {
    for action in 0..3 {
        let mut r = RenderRequests::default();
        let owner = r.new_owner().unwrap();
        let id = r.begin(1, owner, 0, 11).unwrap();
        let payload = r.take(1, id, owner, 0).unwrap();
        match action {
            0 => r.cancel(1, id),
            1 => r.invalidate(1),
            _ => r.clear(),
        }
        assert_eq!(
            r.restore(1, id, owner, 0, payload),
            Err(RequestError::Cancelled)
        );
        assert_eq!(r.finish(1, id, owner, 0), Err(RequestError::Cancelled));
        assert!(r.pending.is_empty());
        assert!(r.new_owner().unwrap() > owner);
        assert!(r.begin(1, owner, 0, 22).unwrap() > id);
    }
}

#[test]
fn double_take_restore_and_ready_finish_are_rejected() {
    let mut r = RenderRequests::default();
    let id = r.begin(1, 1, 0, 11).unwrap();
    assert!(!r.is_in_flight(1, id, 1, 0));
    assert_eq!(r.finish(1, id, 1, 0), Err(RequestError::Cancelled));
    let payload = r.take(1, id, 1, 0).unwrap();
    assert!(r.is_in_flight(1, id, 1, 0));
    assert!(!r.is_in_flight(2, id, 1, 0));
    assert!(!r.is_in_flight(1, id + 1, 1, 0));
    assert!(!r.is_in_flight(1, id, 2, 0));
    assert!(!r.is_in_flight(1, id, 1, 1));
    assert_eq!(r.take(1, id, 1, 0), Err(RequestError::Cancelled));
    assert_eq!(r.restore(1, id, 2, 0, 99), Err(RequestError::Cancelled));
    assert_eq!(r.restore(1, id, 1, 1, 99), Err(RequestError::Cancelled));
    r.restore(1, id, 1, 0, payload).unwrap();
    assert!(!r.is_in_flight(1, id, 1, 0));
    assert_eq!(r.restore(1, id, 1, 0, 99), Err(RequestError::Cancelled));
    assert_eq!(r.take(1, id, 1, 0), Ok(11));
    assert_eq!(r.finish(1, id, 2, 0), Err(RequestError::Cancelled));
    assert_eq!(r.finish(1, id, 1, 1), Err(RequestError::Cancelled));
    r.finish(1, id, 1, 0).unwrap();
    assert!(!r.is_in_flight(1, id, 1, 0));
    assert_eq!(r.finish(1, id, 1, 0), Err(RequestError::Cancelled));
}

#[test]
fn rejected_restore_drops_payload_once_and_preserves_replacement() {
    use std::{cell::Cell, rc::Rc};
    struct Payload(Rc<Cell<u32>>);
    impl Drop for Payload {
        fn drop(&mut self) {
            self.0.set(self.0.get() + 1);
        }
    }
    let drops = Rc::new(Cell::new(0));
    let mut r = RenderRequests::default();
    let old = r.begin(1, 1, 0, Payload(drops.clone())).unwrap();
    let payload = r.take(1, old, 1, 0).unwrap();
    let new = r.begin(1, 1, 1, Payload(drops.clone())).unwrap();
    assert!(r.restore(1, old, 1, 0, payload).is_err());
    assert_eq!(drops.get(), 1);
    assert_eq!(r.pending.len(), 1);
    r.cancel(1, new);
    assert_eq!(drops.get(), 2);
    r.clear();
    assert_eq!(drops.get(), 2);
}
