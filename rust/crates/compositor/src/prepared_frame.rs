use std::collections::VecDeque;
use std::num::NonZeroU64;

use effects::{
    EffectPass, EffectsError, LIQUID_REQUEST_MEMORY_LIMIT, LiquidPreparation, PreparedLiquidPass,
};

use crate::compositor::map_effect_passes;
use crate::{EffectPassDescriptor, FrameDescriptor, FrameItemDescriptor};

#[cfg(test)]
#[path = "prepared_frame_tests.rs"]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq)]
enum PassLocation {
    Layer(usize),
    Outgoing(usize, usize),
    Incoming(usize, usize),
    Scene(usize),
    Group(Vec<usize>),
    Nested(Vec<usize>, Box<PassLocation>),
    SceneBranch(Vec<usize>, usize, Box<PassLocation>),
}

struct PassSpec {
    location: PassLocation,
    group: usize,
    pass_index: usize,
    pass: EffectPass,
}

/// Owns the complete immutable frame: prepared output cannot be committed against
/// another descriptor, pass order, set of parameters, or canvas dimensions.
pub struct FramePreparation {
    frame: FrameDescriptor,
    specs: VecDeque<PassSpec>,
    active: Option<LiquidPreparation>,
    prepared: VecDeque<PreparedLiquidPass>,
    failed: bool,
}

pub struct PreparedFrame {
    pub(crate) frame: FrameDescriptor,
    pub(crate) liquid: VecDeque<PreparedLiquidPass>,
}

fn budget_error() -> EffectsError {
    EffectsError::LiquidSimulation {
        message: "Liquid frame request memory budget exceeded".into(),
    }
}

pub(crate) fn frame_memory(frame: &FrameDescriptor) -> u64 {
    use crate::frame::EffectUniformValueDescriptor;
    let mut bytes = 8192u64.saturating_add(
        (frame.items.capacity() * std::mem::size_of::<FrameItemDescriptor>()) as u64,
    );
    let mut pending = vec![frame.items.as_slice()];
    while let Some(items) = pending.pop() {
        for item in items {
            let layers: &[crate::LayerDescriptor] = match item {
                FrameItemDescriptor::Group(group) => {
                    bytes = bytes.saturating_add(
                        (group.items.capacity() * std::mem::size_of::<FrameItemDescriptor>())
                            as u64,
                    );
                    pending.push(&group.items);
                    &[]
                }
                FrameItemDescriptor::SceneTransition(transition) => {
                    bytes = bytes.saturating_add(
                        std::mem::size_of::<crate::SceneTransitionDescriptor>() as u64,
                    );
                    for group in [&transition.outgoing, &transition.incoming] {
                        bytes = bytes.saturating_add(
                            (group.items.capacity() * std::mem::size_of::<FrameItemDescriptor>())
                                as u64,
                        );
                        pending.push(&group.items);
                    }
                    &[]
                }
                FrameItemDescriptor::Layer(layer) => std::slice::from_ref(layer),
                FrameItemDescriptor::Transition {
                    outgoing, incoming, ..
                } => {
                    bytes = bytes.saturating_add(
                        ((outgoing.capacity() + incoming.capacity())
                            * std::mem::size_of::<crate::LayerDescriptor>())
                            as u64,
                    );
                    for layer in incoming {
                        bytes = bytes.saturating_add(
                            layer.texture_id.capacity() as u64
                                + layer
                                    .mask
                                    .as_ref()
                                    .map_or(0, |mask| mask.texture_id.capacity())
                                    as u64,
                        );
                    }
                    outgoing
                }
                FrameItemDescriptor::SceneEffect { .. } => &[],
            };
            for layer in layers {
                bytes = bytes.saturating_add(
                    layer.texture_id.capacity() as u64
                        + layer
                            .mask
                            .as_ref()
                            .map_or(0, |mask| mask.texture_id.capacity())
                            as u64,
                );
            }
        }
    }
    visit_groups(frame, |_, groups| {
        bytes = bytes.saturating_add(
            (groups.len() * std::mem::size_of::<Vec<EffectPassDescriptor>>() * 2) as u64,
        );
        for group in groups {
            bytes = bytes.saturating_add(
                (group.capacity() * std::mem::size_of::<EffectPassDescriptor>()) as u64,
            );
            for pass in group {
                bytes = bytes.saturating_add(pass.shader.capacity() as u64);
                bytes = bytes.saturating_add(
                    (pass.uniforms.capacity()
                        * (std::mem::size_of::<(String, EffectUniformValueDescriptor)>() + 16)
                        * 2) as u64,
                );
                for (key, value) in &pass.uniforms {
                    bytes = bytes.saturating_add(key.capacity() as u64);
                    if let EffectUniformValueDescriptor::Vector(values) = value {
                        bytes = bytes.saturating_add((values.capacity() * 4) as u64);
                    }
                }
            }
        }
    });
    bytes
}

fn visit_groups(
    frame: &FrameDescriptor,
    mut visit: impl FnMut(PassLocation, &[Vec<EffectPassDescriptor>]),
) {
    visit_item_groups(&frame.items, &[], &mut visit);
}

fn visit_item_groups(
    items: &[FrameItemDescriptor],
    ancestors: &[usize],
    visit: &mut dyn FnMut(PassLocation, &[Vec<EffectPassDescriptor>]),
) {
    let location = |local| {
        if ancestors.is_empty() {
            local
        } else {
            PassLocation::Nested(ancestors.to_vec(), Box::new(local))
        }
    };
    for (index, item) in items.iter().enumerate() {
        match item {
            FrameItemDescriptor::SceneTransition(transition) => {
                let mut path = ancestors.to_vec();
                path.push(index);
                for (side, group) in [&transition.outgoing, &transition.incoming]
                    .into_iter()
                    .enumerate()
                {
                    let mut branch = |local, groups: &[Vec<EffectPassDescriptor>]| {
                        visit(
                            PassLocation::SceneBranch(path.clone(), side, Box::new(local)),
                            groups,
                        );
                    };
                    visit_item_groups(&group.items, &[], &mut branch);
                    branch(PassLocation::Group(vec![]), &group.effect_pass_groups);
                }
            }
            FrameItemDescriptor::Group(group) => {
                let mut path = ancestors.to_vec();
                path.push(index);
                // GPU consumes descendants first, then the group's own post.
                visit_item_groups(&group.items, &path, visit);
                visit(PassLocation::Group(path), &group.effect_pass_groups);
            }
            FrameItemDescriptor::Layer(layer) => visit(
                location(PassLocation::Layer(index)),
                &layer.effect_pass_groups,
            ),
            FrameItemDescriptor::SceneEffect { effect_pass_groups } => {
                visit(location(PassLocation::Scene(index)), effect_pass_groups)
            }
            FrameItemDescriptor::Transition {
                outgoing, incoming, ..
            } => {
                for (layer_index, layer) in outgoing.iter().enumerate() {
                    visit(
                        location(PassLocation::Outgoing(index, layer_index)),
                        &layer.effect_pass_groups,
                    );
                }
                for (layer_index, layer) in incoming.iter().enumerate() {
                    visit(
                        location(PassLocation::Incoming(index, layer_index)),
                        &layer.effect_pass_groups,
                    );
                }
            }
        }
    }
}

impl FramePreparation {
    pub fn new(frame: FrameDescriptor) -> Result<Self, crate::CompositorError> {
        crate::group_admission::validate(&frame)?;
        if frame.width == 0 || frame.height == 0 {
            return Err(EffectsError::LiquidSimulation {
                message: "Invalid frame dimensions".into(),
            }
            .into());
        }
        let mut specs = VecDeque::new();
        let mut admission = Ok(frame_memory(&frame));
        visit_groups(&frame, |location, groups| {
            for (group, passes) in groups.iter().enumerate() {
                for (pass_index, descriptor) in passes.iter().enumerate() {
                    if descriptor.shader != "liquid" || admission.is_err() {
                        continue;
                    }
                    let transport_bytes =
                        descriptor
                            .uniforms
                            .iter()
                            .fold(0usize, |sum, (key, value)| {
                                let values = match value {
                                    crate::frame::EffectUniformValueDescriptor::Vector(values) => {
                                        values.len().saturating_mul(4)
                                    }
                                    _ => 4,
                                };
                                sum.saturating_add(key.len())
                                    .saturating_add(values)
                                    .saturating_add(64)
                            });
                    if admission
                        .as_ref()
                        .is_ok_and(|used| *used > LIQUID_REQUEST_MEMORY_LIMIT)
                        || descriptor.uniforms.len() > 128
                        || transport_bytes > 8192
                        || descriptor.uniforms.iter().any(|(key, value)| {
                            key.len() > 128
                                || matches!(value,
                                crate::frame::EffectUniformValueDescriptor::Vector(values)
                                if values.len() > 112)
                        })
                    {
                        admission = Err(budget_error());
                        continue;
                    }
                    let pass = map_effect_passes(std::slice::from_ref(descriptor)).remove(0);
                    admission = admission
                        .as_ref()
                        .copied()
                        .map_err(|_| budget_error())
                        .and_then(|used| {
                            used.checked_add(LiquidPreparation::memory_budget(&pass)?)
                                .filter(|bytes| *bytes <= LIQUID_REQUEST_MEMORY_LIMIT)
                                .ok_or_else(budget_error)
                        });
                    if admission.is_ok() {
                        specs.push_back(PassSpec {
                            location: location.clone(),
                            group,
                            pass_index,
                            pass,
                        });
                    }
                }
            }
        });
        // Ordinary frames retain the original admission semantics. The request
        // aggregate limits CPU Liquid state, transport and retained raster only.
        let admitted = admission?;
        if !specs.is_empty() && admitted > LIQUID_REQUEST_MEMORY_LIMIT {
            return Err(budget_error().into());
        }
        Ok(Self {
            frame,
            specs,
            active: None,
            prepared: VecDeque::new(),
            failed: false,
        })
    }

    /// The quota is shared by all passes, not restarted for every Liquid layer.
    /// No mutable compositor/GPU borrow may surround this call.
    pub fn advance(&mut self, quota: NonZeroU64) -> Result<bool, EffectsError> {
        if self.failed {
            return Err(EffectsError::Cancelled);
        }
        let result = self.advance_inner(quota);
        if result.is_err() {
            self.failed = true;
            self.active = None;
            self.specs.clear();
            self.prepared.clear();
        }
        result
    }

    fn advance_inner(&mut self, quota: NonZeroU64) -> Result<bool, EffectsError> {
        let mut remaining = quota.get();
        loop {
            if self.active.is_none() {
                let Some(spec) = self.specs.pop_front() else {
                    return Ok(true);
                };
                // Location belongs to the frozen graph; consumption order is identical
                // to frame_composition, including both sides of a transition.
                let _location = (spec.location, spec.group, spec.pass_index);
                self.active = Some(LiquidPreparation::new(
                    spec.pass,
                    [self.frame.width, self.frame.height],
                )?);
            }
            let (ready, executed) = self
                .active
                .as_mut()
                .unwrap()
                .advance(NonZeroU64::new(remaining).unwrap())?;
            remaining = remaining
                .checked_sub(executed)
                .ok_or(EffectsError::InvalidPreparedLiquid)?;
            if ready {
                self.prepared
                    .push_back(self.active.take().unwrap().finish()?);
            } else {
                return Ok(false);
            }
            if remaining == 0 {
                return Ok(self.active.is_none() && self.specs.is_empty());
            }
        }
    }

    pub fn finish(self) -> Result<PreparedFrame, EffectsError> {
        if self.failed || self.active.is_some() || !self.specs.is_empty() {
            return Err(EffectsError::InvalidPreparedLiquid);
        }
        Ok(PreparedFrame {
            frame: self.frame,
            liquid: self.prepared,
        })
    }

    pub fn complete(mut self) -> Result<PreparedFrame, EffectsError> {
        while !self.advance(NonZeroU64::new(1).unwrap())? {}
        self.finish()
    }
}

impl PreparedFrame {
    pub fn dimensions(&self) -> (u32, u32) {
        (self.frame.width, self.frame.height)
    }
}
