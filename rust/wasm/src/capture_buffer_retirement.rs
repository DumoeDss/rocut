//! Capture buffer retirement, independent of map success or cancellation timing.
pub(crate) trait CaptureBufferResource {
    fn destroy(&self);
}
pub(crate) struct CaptureBuffer<B: CaptureBufferResource>(pub(crate) B);
impl<B: CaptureBufferResource> Drop for CaptureBuffer<B> {
    fn drop(&mut self) {
        // Never call unmap on an idle/failed buffer. wgpu29 destroy performs
        // backend retirement including mapped/pending cleanup and tolerates Idle.
        // The capture's mapped ranges and MapWait are dropped before this owner.
        self.0.destroy();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, rc::Rc};
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Mapping { Idle, Waiting, Active, Failed }
    struct Resource { mapping: Rc<Cell<Mapping>>, destroyed: Rc<Cell<bool>> }
    impl CaptureBufferResource for Resource {
        fn destroy(&self) {
            // Actual wgpu-core29 Global::buffer_destroy invokes buffer.unmap but
            // ignores NotMapped before destroy; WebGPU destroy unmaps by contract.
            self.mapping.set(Mapping::Idle);
            self.destroyed.set(true);
        }
    }
    fn retirement(mapping: Mapping) {
        let state=Rc::new(Cell::new(mapping));let destroyed=Rc::new(Cell::new(false));
        drop(CaptureBuffer(Resource {mapping:Rc::clone(&state),destroyed:Rc::clone(&destroyed)}));
        assert!(destroyed.get());assert_eq!(state.get(),Mapping::Idle);
    }
    #[test] fn cancel_before_map_start_destroys_without_invalid_unmap(){retirement(Mapping::Idle);}
    #[test] fn failed_map_destroys_without_invalid_unmap(){retirement(Mapping::Failed);}
    #[test] fn cancel_or_timeout_pending_map_destroys(){retirement(Mapping::Waiting);}
    #[test] fn success_after_mapped_ranges_drop_destroys(){retirement(Mapping::Active);}
}
