use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CaptureCancelled;

/// Never poll stale work, or publish an inner result that became stale during poll.
/// The caller owns dropping the cancelled future and its capture resources.
pub(crate) fn poll_current<F: Future>(
    future: Pin<&mut F>,
    context: &mut Context<'_>,
    mut current: impl FnMut() -> bool,
) -> Poll<Result<F::Output, CaptureCancelled>> {
    if !current() {
        return Poll::Ready(Err(CaptureCancelled));
    }
    let result = future.poll(context);
    if !current() {
        return Poll::Ready(Err(CaptureCancelled));
    }
    result.map(Ok)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::Cell,
        sync::Arc,
        task::{Wake, Waker},
    };

    struct NoWake;
    impl Wake for NoWake {
        fn wake(self: Arc<Self>) {}
    }

    struct Fake<'a> {
        polls: &'a Cell<usize>,
        identity: &'a Cell<bool>,
        invalidate: bool,
        ready: bool,
    }
    impl Future for Fake<'_> {
        type Output = u32;
        fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<u32> {
            self.polls.set(self.polls.get() + 1);
            if self.invalidate {
                self.identity.set(false);
            }
            if self.ready {
                Poll::Ready(17)
            } else {
                Poll::Pending
            }
        }
    }

    #[test]
    fn cancellation_before_poll_never_executes_inner() {
        let polls = Cell::new(0);
        let identity = Cell::new(false);
        let mut future = Fake {
            polls: &polls,
            identity: &identity,
            invalidate: false,
            ready: true,
        };
        let waker = Waker::from(Arc::new(NoWake));
        let mut context = Context::from_waker(&waker);
        assert_eq!(
            poll_current(Pin::new(&mut future), &mut context, || identity.get()),
            Poll::Ready(Err(CaptureCancelled))
        );
        assert_eq!(polls.get(), 0);
    }

    #[test]
    fn replacement_after_pending_prevents_second_poll() {
        let polls = Cell::new(0);
        let identity = Cell::new(true);
        let mut future = Fake {
            polls: &polls,
            identity: &identity,
            invalidate: false,
            ready: false,
        };
        let waker = Waker::from(Arc::new(NoWake));
        let mut context = Context::from_waker(&waker);
        assert_eq!(
            poll_current(Pin::new(&mut future), &mut context, || identity.get()),
            Poll::Pending
        );
        identity.set(false);
        assert_eq!(
            poll_current(Pin::new(&mut future), &mut context, || identity.get()),
            Poll::Ready(Err(CaptureCancelled))
        );
        assert_eq!(polls.get(), 1);
    }

    #[test]
    fn synchronous_invalidation_discards_ready_and_pending() {
        for ready in [false, true] {
            let polls = Cell::new(0);
            let identity = Cell::new(true);
            let mut future = Fake {
                polls: &polls,
                identity: &identity,
                invalidate: true,
                ready,
            };
            let waker = Waker::from(Arc::new(NoWake));
            let mut context = Context::from_waker(&waker);
            assert_eq!(
                poll_current(Pin::new(&mut future), &mut context, || identity.get()),
                Poll::Ready(Err(CaptureCancelled))
            );
            assert_eq!(polls.get(), 1);
        }
    }

    #[test]
    fn current_ready_preserves_output_and_checks_twice() {
        let polls = Cell::new(0);
        let identity = Cell::new(true);
        let checks = Cell::new(0);
        let mut future = Fake {
            polls: &polls,
            identity: &identity,
            invalidate: false,
            ready: true,
        };
        let waker = Waker::from(Arc::new(NoWake));
        let mut context = Context::from_waker(&waker);
        assert_eq!(
            poll_current(Pin::new(&mut future), &mut context, || {
                checks.set(checks.get() + 1);
                identity.get()
            }),
            Poll::Ready(Ok(17))
        );
        assert_eq!(polls.get(), 1);
        assert_eq!(checks.get(), 2);
    }
}
