use std::collections::BTreeMap;

pub(crate) const DEFAULT_COMPOSITOR_HANDLE: u32 = 0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SelectedBackend {
    WebGl,
    WebGpu,
}

impl SelectedBackend {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::WebGl => "webgl",
            Self::WebGpu => "webgpu",
        }
    }

    pub(crate) const fn compositor_capacity(self) -> usize {
        match self {
            Self::WebGl => 1,
            Self::WebGpu => 2,
        }
    }
}

#[derive(Debug)]
pub(crate) struct RuntimeGraphicsState {
    selected_backend: Option<SelectedBackend>,
    unavailable_reason: String,
}

impl Default for RuntimeGraphicsState {
    fn default() -> Self {
        Self {
            selected_backend: None,
            unavailable_reason: "GPU has not been initialized.".to_owned(),
        }
    }
}

impl RuntimeGraphicsState {
    pub(crate) fn selected_backend(&self) -> Option<SelectedBackend> {
        self.selected_backend
    }

    pub(crate) fn compositor_capacity(&self) -> usize {
        self.selected_backend
            .map(SelectedBackend::compositor_capacity)
            .unwrap_or(0)
    }

    pub(crate) fn unavailable_reason(&self) -> &str {
        if self.selected_backend.is_some() {
            ""
        } else {
            &self.unavailable_reason
        }
    }

    pub(crate) fn select(&mut self, backend: SelectedBackend) {
        self.selected_backend = Some(backend);
        self.unavailable_reason.clear();
    }

    pub(crate) fn mark_unavailable(&mut self, reason: impl Into<String>) {
        self.selected_backend = None;
        self.unavailable_reason = reason.into();
        if self.unavailable_reason.is_empty() {
            self.unavailable_reason = "GPU is unavailable.".to_owned();
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum InitializationAction {
    Start(u64),
    Join(u64),
}

#[derive(Debug, Default)]
pub(crate) struct InitializationEpoch {
    generation: u64,
    in_flight: Option<u64>,
}

impl InitializationEpoch {
    pub(crate) fn begin(&mut self) -> Result<InitializationAction, &'static str> {
        if let Some(generation) = self.in_flight {
            return Ok(InitializationAction::Join(generation));
        }

        self.generation = self
            .generation
            .checked_add(1)
            .ok_or("GPU initialization generation is exhausted.")?;
        self.in_flight = Some(self.generation);
        Ok(InitializationAction::Start(self.generation))
    }

    pub(crate) fn is_current(&self, generation: u64) -> bool {
        self.in_flight == Some(generation)
    }

    pub(crate) fn finish(&mut self, generation: u64) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.in_flight = None;
        true
    }

    pub(crate) fn cancel(&mut self) {
        self.in_flight = None;
        if let Some(next) = self.generation.checked_add(1) {
            self.generation = next;
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum HandleRegistryError {
    CapacityExceeded { capacity: usize },
    Exhausted,
}

#[derive(Debug)]
pub(crate) struct HandleRegistry<T> {
    entries: BTreeMap<u32, T>,
    next_explicit_handle: Option<u32>,
}

impl<T> Default for HandleRegistry<T> {
    fn default() -> Self {
        Self {
            entries: BTreeMap::new(),
            next_explicit_handle: Some(1),
        }
    }
}

impl<T> HandleRegistry<T> {
    pub(crate) fn reserve_default(&self, capacity: usize) -> Result<(), HandleRegistryError> {
        if !self.entries.contains_key(&DEFAULT_COMPOSITOR_HANDLE) && self.entries.len() >= capacity
        {
            return Err(HandleRegistryError::CapacityExceeded { capacity });
        }
        Ok(())
    }

    pub(crate) fn reserve_explicit(&mut self, capacity: usize) -> Result<u32, HandleRegistryError> {
        if self.entries.len() >= capacity {
            return Err(HandleRegistryError::CapacityExceeded { capacity });
        }
        let handle = self
            .next_explicit_handle
            .ok_or(HandleRegistryError::Exhausted)?;
        self.next_explicit_handle = handle.checked_add(1);
        Ok(handle)
    }

    pub(crate) fn insert(&mut self, handle: u32, value: T) -> Option<T> {
        self.entries.insert(handle, value)
    }

    pub(crate) fn get(&self, handle: u32) -> Option<&T> {
        self.entries.get(&handle)
    }

    #[cfg(test)]
    pub(crate) fn get_mut(&mut self, handle: u32) -> Option<&mut T> {
        self.entries.get_mut(&handle)
    }

    pub(crate) fn remove(&mut self, handle: u32) -> Option<T> {
        self.entries.remove(&handle)
    }

    pub(crate) fn handles(&self) -> Vec<u32> {
        self.entries.keys().copied().collect()
    }

    #[cfg(test)]
    fn set_next_explicit_handle(&mut self, handle: Option<u32>) {
        self.next_explicit_handle = handle;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphics_state_is_truthful_before_success_and_after_failure() {
        let mut state = RuntimeGraphicsState::default();
        assert_eq!(state.selected_backend(), None);
        assert_eq!(state.compositor_capacity(), 0);
        assert!(!state.unavailable_reason().is_empty());

        state.mark_unavailable("adapter request failed");
        assert_eq!(state.selected_backend(), None);
        assert_eq!(state.compositor_capacity(), 0);
        assert_eq!(state.unavailable_reason(), "adapter request failed");
    }

    #[test]
    fn graphics_state_reports_each_selected_backend() {
        let mut state = RuntimeGraphicsState::default();
        state.select(SelectedBackend::WebGpu);
        assert_eq!(state.selected_backend(), Some(SelectedBackend::WebGpu));
        assert_eq!(SelectedBackend::WebGpu.as_str(), "webgpu");
        assert_eq!(state.compositor_capacity(), 2);
        assert_eq!(state.unavailable_reason(), "");

        state.select(SelectedBackend::WebGl);
        assert_eq!(state.selected_backend(), Some(SelectedBackend::WebGl));
        assert_eq!(SelectedBackend::WebGl.as_str(), "webgl");
        assert_eq!(state.compositor_capacity(), 1);
        assert_eq!(state.unavailable_reason(), "");
    }

    #[test]
    fn empty_unavailable_reason_is_replaced() {
        let mut state = RuntimeGraphicsState::default();
        state.mark_unavailable("");
        assert_eq!(state.unavailable_reason(), "GPU is unavailable.");
    }

    #[test]
    fn concurrent_initialization_joins_one_generation() {
        let mut epoch = InitializationEpoch::default();

        assert_eq!(epoch.begin(), Ok(InitializationAction::Start(1)));
        assert_eq!(epoch.begin(), Ok(InitializationAction::Join(1)));
        assert!(epoch.is_current(1));
        assert!(epoch.finish(1));
        assert!(!epoch.is_current(1));
        assert!(!epoch.finish(1));
        assert_eq!(epoch.begin(), Ok(InitializationAction::Start(2)));
    }

    #[test]
    fn disposal_invalidates_a_late_initialization_result() {
        let mut epoch = InitializationEpoch::default();

        assert_eq!(epoch.begin(), Ok(InitializationAction::Start(1)));
        epoch.cancel();
        assert!(!epoch.is_current(1));
        assert!(!epoch.finish(1));
        assert_eq!(epoch.begin(), Ok(InitializationAction::Start(3)));
    }

    #[test]
    fn explicit_handles_are_distinct_monotonic_and_sorted() {
        let mut registry = HandleRegistry::default();
        let first = registry.reserve_explicit(2).unwrap();
        registry.insert(first, "first");
        let second = registry.reserve_explicit(2).unwrap();
        registry.insert(second, "second");

        assert_eq!((first, second), (1, 2));
        assert_eq!(registry.handles(), vec![1, 2]);
        assert_eq!(registry.get(first), Some(&"first"));
        assert_eq!(registry.get(second), Some(&"second"));
    }

    #[test]
    fn default_and_explicit_handles_compete_for_capacity() {
        let mut registry = HandleRegistry::default();
        registry.reserve_default(2).unwrap();
        registry.insert(DEFAULT_COMPOSITOR_HANDLE, "default");
        let explicit = registry.reserve_explicit(2).unwrap();
        registry.insert(explicit, "explicit");

        assert_eq!(
            registry.reserve_explicit(2),
            Err(HandleRegistryError::CapacityExceeded { capacity: 2 })
        );
        assert_eq!(registry.handles(), vec![0, 1]);
    }

    #[test]
    fn replacing_default_does_not_consume_capacity() {
        let mut registry = HandleRegistry::default();
        registry.reserve_default(1).unwrap();
        registry.insert(DEFAULT_COMPOSITOR_HANDLE, "old");
        registry.reserve_default(1).unwrap();
        assert_eq!(
            registry.insert(DEFAULT_COMPOSITOR_HANDLE, "new"),
            Some("old")
        );
        assert_eq!(registry.handles(), vec![0]);
    }

    #[test]
    fn over_capacity_reservation_changes_nothing() {
        let mut registry = HandleRegistry::default();
        let handle = registry.reserve_explicit(1).unwrap();
        registry.insert(handle, "only");
        let before = registry.handles();

        assert_eq!(
            registry.reserve_explicit(1),
            Err(HandleRegistryError::CapacityExceeded { capacity: 1 })
        );
        assert_eq!(registry.handles(), before);
    }

    #[test]
    fn release_is_exact_and_idempotent() {
        let mut registry = HandleRegistry::default();
        registry.insert(1, "first");
        registry.insert(2, "second");

        assert_eq!(registry.remove(1), Some("first"));
        assert_eq!(registry.remove(1), None);
        assert_eq!(registry.get(2), Some(&"second"));
        assert_eq!(registry.handles(), vec![2]);
    }

    #[test]
    fn mutable_lookup_is_handle_scoped() {
        let mut registry = HandleRegistry::default();
        registry.insert(1, vec![1]);
        registry.insert(2, vec![2]);
        registry.get_mut(1).unwrap().push(3);

        assert_eq!(registry.get(1), Some(&vec![1, 3]));
        assert_eq!(registry.get(2), Some(&vec![2]));
    }

    #[test]
    fn handle_exhaustion_never_wraps() {
        let mut registry = HandleRegistry::default();
        registry.set_next_explicit_handle(Some(u32::MAX));
        let last = registry.reserve_explicit(2).unwrap();
        registry.insert(last, "last");

        assert_eq!(last, u32::MAX);
        assert_eq!(
            registry.reserve_explicit(2),
            Err(HandleRegistryError::Exhausted)
        );
        assert_eq!(registry.handles(), vec![u32::MAX]);
    }
}
