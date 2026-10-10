use crate::effect_positions::EffectPassPosition;
use crate::prepared_frame::PreparedFrame;
use effects::{
    CanvasPreparation, EffectPass, EffectsError, PreparedCanvasPass, PreparedLiquidPass,
    UniformValue,
};
use std::num::NonZeroU64;
use std::sync::atomic::{AtomicU64, Ordering};

fn error(message: &str) -> EffectsError {
    EffectsError::CanvasPreparation {
        message: message.into(),
    }
}
static FRAME_ID: AtomicU64 = AtomicU64::new(1);

/// Opaque frame/position binding. A ticket is not proof of GPU source provenance.
#[derive(Clone, Debug)]
pub struct CanvasCaptureTicket {
    frame_id: u64,
    ordinal: usize,
    dimensions: [u32; 2],
}
impl CanvasCaptureTicket {
    pub fn ordinal(&self) -> usize {
        self.ordinal
    }
    pub fn dimensions(&self) -> [u32; 2] {
        self.dimensions
    }
}
struct Entry {
    ordinal: usize,
    position: EffectPassPosition,
    pass: EffectPass,
    prepared: Option<PreparedCanvasPass>,
    capacity: usize,
}
pub(crate) struct CanvasFrameState {
    frame_id: u64,
    dimensions: [u32; 2],
    base_bytes: u64,
    total_passes: usize,
    entries: Vec<Entry>,
    active: Option<(usize, CanvasPreparation)>,
}
fn pass_bytes(pass: &EffectPass) -> Result<u64, EffectsError> {
    let mut bytes = (std::mem::size_of::<EffectPass>() as u64)
        .checked_add(pass.shader.capacity() as u64)
        .and_then(|v| v.checked_add((pass.uniforms.capacity() as u64).checked_mul(512)?))
        .ok_or_else(|| error("Canvas frame pass metadata overflow"))?;
    for (key, value) in &pass.uniforms {
        bytes = bytes
            .checked_add(key.capacity() as u64)
            .ok_or_else(|| error("Canvas metadata overflow"))?;
        if let UniformValue::Vector(v) = value {
            bytes = bytes
                .checked_add(
                    (v.capacity() as u64)
                        .checked_mul(4)
                        .ok_or_else(|| error("Canvas metadata overflow"))?,
                )
                .ok_or_else(|| error("Canvas metadata overflow"))?;
        }
    }
    Ok(bytes)
}
// Charge before map_effect_passes clones anything. The bucket bound deliberately
// exceeds the collected HashMap's requested capacity, including growth overlap.
fn predicted_clone_bytes(pass: &crate::EffectPassDescriptor) -> Result<u64, EffectsError> {
    let buckets = pass
        .uniforms
        .len()
        .checked_mul(2)
        .and_then(|v| v.checked_add(1))
        .and_then(usize::checked_next_power_of_two)
        .ok_or_else(|| error("Canvas clone bound overflow"))?;
    let mut bytes = (std::mem::size_of::<EffectPass>() * 2) as u64 + pass.shader.len() as u64;
    bytes = bytes
        .checked_add(
            (buckets as u64)
                .checked_mul(512)
                .ok_or_else(|| error("Canvas clone bound overflow"))?,
        )
        .ok_or_else(|| error("Canvas clone bound overflow"))?;
    for (key, value) in &pass.uniforms {
        bytes = bytes
            .checked_add(key.len() as u64)
            .ok_or_else(|| error("Canvas clone bound overflow"))?;
        if let crate::frame::EffectUniformValueDescriptor::Vector(values) = value {
            bytes = bytes
                .checked_add(
                    (values.len() as u64)
                        .checked_mul(4)
                        .ok_or_else(|| error("Canvas clone bound overflow"))?,
                )
                .ok_or_else(|| error("Canvas clone bound overflow"))?;
        }
    }
    Ok(bytes)
}
pub(crate) fn location_bytes(location: &crate::effect_positions::PassLocation) -> u64 {
    use crate::effect_positions::PassLocation::*;
    match location {
        Group(path) => (path.capacity() * std::mem::size_of::<usize>()) as u64,
        Nested(path, inner) | SceneBranch(path, _, inner) => {
            (path.capacity() * std::mem::size_of::<usize>()
                + std::mem::size_of::<crate::effect_positions::PassLocation>()) as u64
                + location_bytes(inner)
        }
        _ => 0,
    }
}
impl CanvasFrameState {
    pub(crate) fn new(
        frame: &crate::FrameDescriptor,
        base_bytes: u64,
    ) -> Result<Self, EffectsError> {
        let dimensions = [frame.width, frame.height];
        let mut count = 0usize;
        let mut total_passes = 0usize;
        let mut contains_liquid = false;
        let mut predicted = Ok(base_bytes
            .checked_add(
                (std::mem::size_of::<Self>() + 2 * std::mem::size_of::<CanvasCaptureTicket>())
                    as u64,
            )
            .ok_or_else(|| error("Canvas state metadata overflow"))?);
        crate::effect_positions::visit_passes(frame, |position, descriptor| {
            total_passes += 1;
            contains_liquid |= descriptor.shader == "liquid";
            predicted = predicted
                .as_ref()
                .copied()
                .map_err(|_| error("Canvas cursor metadata rejected"))
                .and_then(|v| {
                    v.checked_add(location_bytes(&position.location))
                        .ok_or_else(|| error("Canvas cursor location overflow"))
                });
            if descriptor.shader != "canvas" || predicted.is_err() {
                return;
            }
            count += 1;
            predicted = predicted
                .as_ref()
                .copied()
                .map_err(|_| error("Canvas metadata rejected"))
                .and_then(|v| {
                    v.checked_add(predicted_clone_bytes(descriptor)?)
                        .and_then(|v| v.checked_add(location_bytes(&position.location)))
                        .ok_or_else(|| error("Canvas metadata overflow"))
                });
        });
        if count > crate::canvas_capture_budget::MAX_CANVAS_FRAME_POSITIONS {
            return Err(error("Canvas slot count exceeded"));
        }
        let capacity = if count == 0 {
            0
        } else {
            u64::from(frame.width)
                .checked_mul(u64::from(frame.height))
                .and_then(|v| v.checked_mul(4))
                .and_then(|v| usize::try_from(v).ok())
                .ok_or_else(|| error("Canvas source size overflow"))?
        };
        let base_bytes = predicted?
            .checked_add((count * std::mem::size_of::<Entry>()) as u64)
            .and_then(|v| v.checked_add(identity::cursor_storage_bytes(total_passes)?))
            .ok_or_else(|| error("Canvas metadata overflow"))?;
        // No ordinary/Liquid identities are cloned: the frozen descriptor is the
        // identity source. Reject metadata before allocating slots/native maps.
        if count != 0 {
            crate::canvas_capture_budget::CanvasFrameCaptureBudget::new(base_bytes)
                .map_err(|e| error(&e.to_string()))?;
            if total_passes > 4096 {
                return Err(error("Canvas frame traversal pass count exceeded"));
            }
        } else if contains_liquid && base_bytes > effects::LIQUID_REQUEST_MEMORY_LIMIT {
            return Err(EffectsError::LiquidSimulation {
                message: "Liquid frame positioned-state memory budget exceeded".into(),
            });
        }
        let mut entries = Vec::with_capacity(count);
        if entries.capacity() != count {
            return Err(error("Canvas slot capacity exceeds precharged bound"));
        }
        let mut ordinal = 0usize;
        let mut admission = Ok(());
        let mut aggregate = if count == 0 {
            None
        } else {
            Some(
                crate::canvas_capture_budget::CanvasFrameCaptureBudget::new(base_bytes)
                    .map_err(|e| error(&e.to_string()))?,
            )
        };
        crate::effect_positions::visit_passes(frame, |position, descriptor| {
            let current = ordinal;
            ordinal += 1;
            if descriptor.shader != "canvas" || admission.is_err() {
                return;
            }
            let pass =
                crate::compositor::map_effect_passes(std::slice::from_ref(descriptor)).remove(0);
            match pass_bytes(&pass).and_then(|actual| {
                predicted_clone_bytes(descriptor).and_then(|predicted| {
                    if actual <= predicted {
                        Ok(())
                    } else {
                        Err(error("Canvas clone capacity exceeds precharged bound"))
                    }
                })
            }) {
                Ok(()) => (),
                Err(e) => {
                    admission = Err(e);
                    return;
                }
            }
            admission = CanvasPreparation::estimate(&pass, dimensions, capacity)
                .map_err(|e| error(&e.to_string()))
                .and_then(|budget| {
                    aggregate
                        .as_mut()
                        .unwrap()
                        .add(current, dimensions, &budget)
                        .map(|_| ())
                        .map_err(|e| error(&e.to_string()))
                });
            if admission.is_ok() {
                entries.push(Entry {
                    ordinal: current,
                    position,
                    pass,
                    prepared: None,
                    capacity,
                });
            }
        });
        admission?;
        // Final revalidation allocates its own position ledger. Keep only one
        // ledger alive, matching the metadata charge in the aggregate budget.
        drop(aggregate);
        let frame_id = FRAME_ID
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
            .map_err(|_| error("Canvas frame identity exhausted"))?;
        let state = Self {
            frame_id,
            dimensions,
            base_bytes,
            total_passes,
            entries,
            active: None,
        };
        state.admit(None)?;
        Ok(state)
    }
    fn admit(&self, replacement: Option<(usize, usize)>) -> Result<(), EffectsError> {
        if !self.entries.iter().any(|e| e.pass.shader == "canvas") {
            return Ok(());
        }
        let mut aggregate =
            crate::canvas_capture_budget::CanvasFrameCaptureBudget::new(self.base_bytes)
                .map_err(|e| error(&e.to_string()))?;
        for entry in &self.entries {
            let ordinal = entry.ordinal;
            if entry.pass.shader != "canvas" {
                continue;
            }
            let capacity = replacement
                .filter(|(i, _)| *i == ordinal)
                .map_or(entry.capacity, |(_, cap)| cap);
            let budget = CanvasPreparation::estimate(&entry.pass, self.dimensions, capacity)
                .map_err(|e| error(&e.to_string()))?;
            aggregate
                .add(ordinal, self.dimensions, &budget)
                .map_err(|e| error(&e.to_string()))?;
        }
        Ok(())
    }
    fn missing(&self) -> Option<usize> {
        self.entries
            .iter()
            .find(|e| e.prepared.is_none())
            .map(|e| e.ordinal)
    }
    pub(crate) fn ready(&self) -> bool {
        self.active.is_none() && self.missing().is_none()
    }
    pub(crate) fn begin(
        &mut self,
        ticket: CanvasCaptureTicket,
        captured: Vec<u8>,
    ) -> Result<(), EffectsError> {
        if self.active.is_some()
            || ticket.frame_id != self.frame_id
            || ticket.dimensions != self.dimensions
            || self.missing() != Some(ticket.ordinal)
        {
            return Err(error(
                "Canvas capture ticket is stale, foreign or out of order",
            ));
        }
        let expected = u64::from(self.dimensions[0]) * u64::from(self.dimensions[1]) * 4;
        if captured.len() as u64 != expected {
            return Err(error("Canvas captured byte length mismatch"));
        }
        self.admit(Some((ticket.ordinal, captured.capacity())))?;
        let index = self
            .entries
            .iter()
            .position(|e| e.ordinal == ticket.ordinal)
            .ok_or_else(|| error("Unknown Canvas ordinal"))?;
        let entry = &mut self.entries[index];
        let preparation = CanvasPreparation::new(entry.pass.clone(), self.dimensions, captured)
            .map_err(|e| error(&e.to_string()))?;
        entry.capacity = preparation.budget().captured_capacity_bytes as usize;
        self.active = Some((index, preparation));
        Ok(())
    }
    pub(crate) fn minimum(&self) -> Option<NonZeroU64> {
        self.active.as_ref().map(|(_, p)| p.minimum_step_work())
    }
    pub(crate) fn advance(&mut self, quota: NonZeroU64) -> Result<bool, EffectsError> {
        let Some((_, preparation)) = self.active.as_mut() else {
            return Ok(self.ready());
        };
        let progress = preparation
            .advance(quota)
            .map_err(|e| error(&e.to_string()))?;
        if progress.is_complete() {
            let (ordinal, preparation) = self.active.take().unwrap();
            self.entries[ordinal].prepared =
                Some(preparation.finish().map_err(|e| error(&e.to_string()))?);
        }
        Ok(self.ready())
    }
}
#[path = "canvas_frame_identity.rs"]
mod identity;
pub(crate) use identity::{FrameTraversalCursor, FrameTraversalPass};

#[cfg(test)]
#[path = "canvas_frame_state_tests.rs"]
mod tests;
