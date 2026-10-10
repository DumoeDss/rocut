//! Opaque per-evaluation context. No caller-authored Prepared/Frame or admitted
//! font/geometry token can enter this map; only the existing owner constructs it.
use super::PreparationRequest;
use crate::mv_night_owner::{Frame, Owner, Prepared};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
struct Node {
    owner: Owner,
    session: u32,
    metadata_sha: String,
    sample: (u64, u64, u64),
    active: bool,
}
pub(in crate::mv_recipe) struct Context {
    nodes: BTreeMap<(String, u32), Node>,
}
impl Context {
    pub(in crate::mv_recipe) fn new() -> Result<Self, String> {
        Ok(Self {
            nodes: BTreeMap::new(),
        })
    }
    pub(in crate::mv_recipe) fn inspect<B: AsRef<[u8]>>(
        &mut self,
        request: &PreparationRequest,
        length: usize,
        copy: impl FnOnce() -> Result<B, String>,
    ) -> Result<Prepared, String> {
        let key = (request.node_id.clone(), request.occurrence_id);
        if request.occurrence_id == 0
            || self.nodes.contains_key(&key)
            || length != request.physical_encoded_bytes
        {
            return Err(
                "Night unissued/duplicate occurrence or physical packet length mismatch".into(),
            );
        }
        let mut owner = Owner::new()?;
        let prepared = owner.inspect_with(&request.metadata, length, copy)?;
        self.nodes.insert(
            key,
            Node {
                owner,
                session: prepared.session_id,
                metadata_sha: format!("{:x}", Sha256::digest(request.metadata.as_bytes())),
                sample: (
                    request.song_ticks,
                    request.shot_start_ticks,
                    request.shot_end_ticks,
                ),
                active: false,
            },
        );
        Ok(prepared)
    }
    fn node(&mut self, request: &PreparationRequest) -> Result<&mut Node, String> {
        let node = self
            .nodes
            .get_mut(&(request.node_id.clone(), request.occurrence_id))
            .ok_or("Night public node has no actual source/font admission")?;
        if format!("{:x}", Sha256::digest(request.metadata.as_bytes())) != node.metadata_sha
            || node.sample
                != (
                    request.song_ticks,
                    request.shot_start_ticks,
                    request.shot_end_ticks,
                )
        {
            return Err(
                "Night public node source/audio/instance binding changed after admission".into(),
            );
        }
        Ok(node)
    }
    /// Host reports actual createImageBitmap output through this existing owner
    /// check; JSON cannot substitute for its prior byte-proven geometry.
    pub(in crate::mv_recipe) fn bind_decoded(
        &mut self,
        request: &PreparationRequest,
        facts: &str,
    ) -> Result<(), String> {
        let node = self.node(request)?;
        node.owner.bind_decoded(node.session, facts)
    }
    pub(in crate::mv_recipe) fn bind_reflection(
        &mut self,
        request: &PreparationRequest,
        rgba: &[u8],
    ) -> Result<serde_json::Value, String> {
        let node = self.node(request)?;
        node.owner.bind_reflection(node.session, rgba)
    }
    pub(in crate::mv_recipe) fn prepare_lut<B: AsRef<[u8]>>(
        &mut self,
        request: &PreparationRequest,
        metadata: &str,
        length: usize,
        copy: impl FnOnce() -> Result<B, String>,
    ) -> Result<serde_json::Value, String> {
        serde_json::to_value(
            self.node(request)?
                .owner
                .prepare_lut_with(metadata, length, copy)?,
        )
        .map_err(|e| e.to_string())
    }
    pub(in crate::mv_recipe) fn bind_lut_row(
        &mut self,
        request: &PreparationRequest,
        rgba: &[u8],
    ) -> Result<serde_json::Value, String> {
        serde_json::to_value(self.node(request)?.owner.bind_lut_row(rgba)?)
            .map_err(|e| e.to_string())
    }
    pub(in crate::mv_recipe) fn frame(
        &mut self,
        request: &PreparationRequest,
        song_ticks: u64,
        shot_start_ticks: u64,
        shot_end_ticks: u64,
    ) -> Result<Frame, String> {
        let sample=serde_json::json!({"songTicks":song_ticks,"shotStartTicks":shot_start_ticks,"shotEndTicks":shot_end_ticks}).to_string();
        let node = self.node(request)?;
        if node.sample != (song_ticks, shot_start_ticks, shot_end_ticks) {
            return Err("Night occurrence sample changed after admission".into());
        }
        let frame = node.owner.evaluate(node.session, &sample)?;
        node.active = true;
        Ok(frame)
    }
    /// Release only after native main/foreground/GL surfaces are destroyed.
    pub(in crate::mv_recipe) fn release_frame(
        &mut self,
        request: &PreparationRequest,
        id: u32,
    ) -> Result<(), String> {
        let node = self.node(request)?;
        node.owner.release_frame(id)?;
        node.active = false;
        Ok(())
    }
    pub(in crate::mv_recipe) fn dispose(
        &mut self,
        request: &PreparationRequest,
    ) -> Result<(), String> {
        let node = self.node(request)?;
        node.owner.dispose(node.session)?;
        self.nodes
            .remove(&(request.node_id.clone(), request.occurrence_id));
        Ok(())
    }
    pub(in crate::mv_recipe) fn clear(&mut self) -> Result<(), String> {
        if self.nodes.values().any(|node| node.active) {
            return Err("Night cannot clear while occurrence frame surfaces are live".into());
        }
        for node in self.nodes.values_mut() {
            node.owner.clear()?;
        }
        self.nodes.clear();
        Ok(())
    }
    pub(in crate::mv_recipe) fn diagnostic(&self) -> serde_json::Value {
        let bytes: u64 = self
            .nodes
            .values()
            .map(|node| {
                node.owner.diagnostic()["reservedBytes"]
                    .as_u64()
                    .unwrap_or(0)
            })
            .sum();
        serde_json::json!({"sessions":self.nodes.len(),"reservedBytes":bytes,"activeFrames":self.nodes.values().filter(|node|node.active).count()})
    }
}
