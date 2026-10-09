//! Bound the transient targets of an entire grouped request before cloning/GPU
//! allocation. This is not a process RSS, driver or persistent texture-pool cap.
//! Liquid's existing aggregate preparation admission remains independently active.
use crate::{
    CompositorError, EffectPassDescriptor, FrameDescriptor, FrameItemDescriptor,
    IsolatedGroupDescriptor, LayerDescriptor,
};

pub const MAX_GROUP_DEPTH: usize = 8;
pub const MAX_GROUPS: usize = 64;
pub const MAX_GROUP_FRAME_ITEMS: usize = 4096;
const MAX_GROUP_TARGET_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GROUP_EFFECT_PASSES: usize = 4096;
pub const MAX_GROUP_TRANSPORT_BYTES: u64 = 8 * 1024 * 1024;

struct Budget {
    pixel_bytes: u64,
    bytes: u64,
    passes: usize,
    pass_groups: usize,
}
impl Budget {
    fn reserve(&mut self, bytes: u64) -> Result<(), CompositorError> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or_else(|| invalid("target byte count overflow"))?;
        if self.bytes > MAX_GROUP_TARGET_BYTES {
            return Err(invalid("grouped request target memory limit exceeded"));
        }
        Ok(())
    }
    fn targets(&mut self, count: u64) -> Result<(), CompositorError> {
        self.reserve(
            self.pixel_bytes
                .checked_mul(count)
                .ok_or_else(|| invalid("target size overflow"))?,
        )
    }
    fn effects(&mut self, groups: &[Vec<EffectPassDescriptor>]) -> Result<(), CompositorError> {
        self.pass_groups = self.pass_groups.saturating_add(groups.len());
        if self.pass_groups > MAX_GROUP_EFFECT_PASSES {
            return Err(invalid("effect pass-group limit exceeded"));
        }
        for passes in groups {
            self.passes = self.passes.saturating_add(passes.len());
            if self.passes > MAX_GROUP_EFFECT_PASSES {
                return Err(invalid("effect pass limit exceeded"));
            }
            self.targets(passes.len() as u64)?;
            for descriptor in passes {
                if descriptor.shader == "liquid" {
                    let pass =
                        crate::compositor::map_effect_passes(std::slice::from_ref(descriptor))
                            .remove(0);
                    // The existing conservative replay reservation includes the
                    // RGBA32Float state upload; do not invent a second grid parser.
                    self.reserve(effects::LiquidPreparation::memory_budget(&pass)?)?;
                }
            }
        }
        Ok(())
    }
    fn layer(&mut self, layer: &LayerDescriptor) -> Result<(), CompositorError> {
        // Source transfer and parent blend; mask copy/apply, or two 2-target
        // JFA runs plus feather output and mask apply.
        let mask_targets = layer
            .mask
            .as_ref()
            .map_or(0, |mask| if mask.feather > 0.0 { 6 } else { 2 });
        self.targets(2 + mask_targets + u64::from(!layer.effect_pass_groups.is_empty()))?;
        self.effects(&layer.effect_pass_groups)
    }

    fn group(
        &mut self,
        group: &IsolatedGroupDescriptor,
        depth: usize,
        groups: &mut usize,
    ) -> Result<(), CompositorError> {
        *groups += 1;
        if depth > MAX_GROUP_DEPTH || *groups > MAX_GROUPS {
            return Err(invalid("group depth or count limit exceeded"));
        }
        if !group.opacity.is_finite() || !(0.0..=1.0).contains(&group.opacity) {
            return Err(invalid("opacity must be finite and between zero and one"));
        }
        // Transparent initial target + parent blend; optional post copy and
        // once-only opacity. Zero opacity never skips child admission/preparation.
        self.targets(
            2 + u64::from(group.opacity != 1.0) + u64::from(!group.effect_pass_groups.is_empty()),
        )?;
        self.effects(&group.effect_pass_groups)
    }
}

fn invalid(message: &'static str) -> CompositorError {
    CompositorError::InvalidGroup { message }
}

pub(crate) fn validate(frame: &FrameDescriptor) -> Result<(), CompositorError> {
    // Keep the historical non-group path unchanged.
    if !frame.items.iter().any(|item| {
        matches!(
            item,
            FrameItemDescriptor::Group(_) | FrameItemDescriptor::SceneTransition(_)
        )
    }) {
        return Ok(());
    }
    let pixels = u64::from(frame.width) * u64::from(frame.height);
    if frame.width == 0
        || frame.height == 0
        || frame.width > 8192
        || frame.height > 8192
        || pixels > 16_777_216
    {
        return Err(invalid(
            "canvas dimensions exceed the grouped render budget",
        ));
    }
    let (mut groups, mut items) = (0usize, 0usize);
    let mut budget = Budget {
        pixel_bytes: pixels * 4,
        bytes: 0,
        passes: 0,
        pass_groups: 0,
    };
    budget.targets(1)?; // Root clear belongs to the grouped request too.
    let mut pending = vec![(frame.items.as_slice().iter(), 0usize)];
    while let Some((iterator, depth)) = pending.last_mut() {
        let Some(item) = iterator.next() else {
            pending.pop();
            continue;
        };
        items = items.saturating_add(1);
        match item {
            FrameItemDescriptor::Group(group) => {
                let child_depth = *depth + 1;
                budget.group(group, child_depth, &mut groups)?;
                pending.push((group.items.iter(), child_depth));
            }
            FrameItemDescriptor::SceneTransition(transition) => {
                if !transition.progress.is_finite() || !(0.0..=1.0).contains(&transition.progress) {
                    return Err(CompositorError::InvalidTransitionProgress(
                        transition.progress,
                    ));
                }
                // Branch descriptors are full groups even without a wire `type`.
                // They each consume group/item/depth budget at every endpoint.
                items = items.saturating_add(2);
                let child_depth = *depth + 1;
                budget.group(&transition.outgoing, child_depth, &mut groups)?;
                budget.group(&transition.incoming, child_depth, &mut groups)?;
                budget.targets(1)?;
                pending.push((transition.incoming.items.iter(), child_depth));
                pending.push((transition.outgoing.items.iter(), child_depth));
            }
            FrameItemDescriptor::Transition {
                outgoing, incoming, ..
            } => {
                items = items
                    .saturating_add(outgoing.len())
                    .saturating_add(incoming.len());
                if items > MAX_GROUP_FRAME_ITEMS {
                    return Err(invalid("expanded frame item limit exceeded"));
                }
                budget.targets(1)?; // Crossfade after composing both pictures.
                for layer in outgoing.iter().chain(incoming) {
                    budget.layer(layer)?;
                }
            }
            FrameItemDescriptor::Layer(layer) => budget.layer(layer)?,
            FrameItemDescriptor::SceneEffect { effect_pass_groups } => {
                budget.targets(1)?;
                budget.effects(effect_pass_groups)?;
            }
        }
        if items > MAX_GROUP_FRAME_ITEMS {
            return Err(invalid("expanded frame item limit exceeded"));
        }
    }
    if crate::prepared_frame::frame_memory(frame) > MAX_GROUP_TRANSPORT_BYTES {
        return Err(invalid("grouped request transport memory limit exceeded"));
    }
    Ok(())
}
