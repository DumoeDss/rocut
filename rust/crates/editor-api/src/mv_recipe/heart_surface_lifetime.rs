//! One-frame scratch ownership. Released names remain consumed for the frame.
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub struct Lifetimes {
    live: BTreeMap<String, u64>,
    seen: BTreeSet<String>,
}
impl Lifetimes {
    pub fn create(&mut self, id: &str, bytes: u64) -> Result<(), String> {
        if id.is_empty()
            || id.len() > 128
            || self.live.len() >= 64
            || self.seen.len() >= 4096
            || self.seen.contains(id)
        {
            return Err("Heart surface lifetime collision/capability exceeded".into());
        }
        self.seen.insert(id.to_owned());
        self.live.insert(id.to_owned(), bytes);
        Ok(())
    }
    pub fn bytes(&self, id: &str) -> Result<u64, String> {
        self.live
            .get(id)
            .copied()
            .ok_or_else(|| "Heart sampled an unavailable surface".into())
    }
    pub fn sample(&self, id: &str, target: Option<&str>) -> Result<(), String> {
        if target == Some(id) {
            return Err("Heart surface feedback is forbidden".into());
        }
        self.bytes(id).map(|_| ())
    }
    pub fn release(&mut self, id: &str) -> Result<u64, String> {
        self.live
            .remove(id)
            .ok_or_else(|| "Heart released an unavailable surface".into())
    }
    pub fn finish(&self) -> Result<(), String> {
        if self.live.is_empty() {
            Ok(())
        } else {
            Err("Heart producer leaked a scratch surface".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn released_ids_stay_consumed_and_dead_self_future_refs_fail() {
        let mut state = Lifetimes::default();
        state.create("chip-0", 16).unwrap();
        assert!(state.sample("chip-0", Some("chip-0")).is_err());
        assert!(state.sample("future", None).is_err());
        assert!(state.finish().is_err());
        state.sample("chip-0", None).unwrap();
        assert_eq!(state.release("chip-0").unwrap(), 16);
        assert!(state.create("chip-0", 16).is_err());
        assert!(state.sample("chip-0", None).is_err());
        assert!(state.release("chip-0").is_err());
        state.create("chip-1", 16).unwrap();
        state.release("chip-1").unwrap();
        state.finish().unwrap();
    }
}
