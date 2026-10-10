use super::*;
fn matches_descriptor(a: &crate::EffectPassDescriptor, b: &EffectPass) -> bool {
    a.shader == b.shader
        && a.uniforms.len() == b.uniforms.len()
        && a.uniforms.iter().all(|(k, v)| {
            b.uniforms.get(k).is_some_and(|w| match (v, w) {
                (
                    crate::frame::EffectUniformValueDescriptor::Number(a),
                    UniformValue::Number(b),
                ) => a.to_bits() == b.to_bits(),
                (
                    crate::frame::EffectUniformValueDescriptor::Vector(a),
                    UniformValue::Vector(b),
                ) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.to_bits() == b.to_bits()),
                _ => false,
            })
        })
}
pub(crate) enum FrameTraversalPass<'a> {
    Ordinary,
    Liquid(&'a PreparedLiquidPass),
    Canvas(&'a PreparedCanvasPass),
    NeedCapture(CanvasCaptureTicket),
}
pub(crate) struct FrameTraversalCursor<'a> {
    frame: &'a PreparedFrame,
    identities: Vec<(EffectPassPosition, &'a crate::EffectPassDescriptor)>,
    next: usize,
}
pub(super) fn cursor_storage_bytes(count: usize) -> Option<u64> {
    // Constructor temporarily owns keys and borrowed references separately,
    // then moves keys into the exact-capacity paired identity vector.
    let per_pass = std::mem::size_of::<EffectPassPosition>()
        + std::mem::size_of::<&crate::EffectPassDescriptor>()
        + std::mem::size_of::<(EffectPassPosition, &crate::EffectPassDescriptor)>();
    (count as u64).checked_mul(per_pass as u64)?.checked_add(
        (std::mem::size_of::<FrameTraversalCursor<'_>>() + 2 * std::mem::size_of::<Vec<usize>>())
            as u64,
    )
}
pub(super) fn validate_cursor_shape(
    count: usize,
    lengths: [usize; 2],
    capacities: [usize; 3],
) -> Result<(), EffectsError> {
    if lengths != [count, count] || capacities.iter().any(|capacity| *capacity < count) {
        return Err(error("Frozen graph visitor identity count disagreement"));
    }
    let sizes = [
        std::mem::size_of::<EffectPassPosition>(),
        std::mem::size_of::<&crate::EffectPassDescriptor>(),
        std::mem::size_of::<(EffectPassPosition, &crate::EffectPassDescriptor)>(),
    ];
    let mut actual = (std::mem::size_of::<FrameTraversalCursor<'_>>()
        + 2 * std::mem::size_of::<Vec<usize>>()) as u64;
    for (capacity, size) in capacities.into_iter().zip(sizes) {
        actual = actual
            .checked_add(
                (capacity as u64)
                    .checked_mul(size as u64)
                    .ok_or_else(|| error("Canvas cursor capacity overflow"))?,
            )
            .ok_or_else(|| error("Canvas cursor capacity overflow"))?;
    }
    let predicted =
        cursor_storage_bytes(count).ok_or_else(|| error("Canvas cursor storage bound overflow"))?;
    if actual > predicted {
        return Err(error("Canvas cursor capacity exceeds precharged bound"));
    }
    Ok(())
}
fn borrowed_passes<'a>(
    items: &'a [crate::FrameItemDescriptor],
    out: &mut Vec<&'a crate::EffectPassDescriptor>,
    count: usize,
) -> Result<(), EffectsError> {
    use crate::FrameItemDescriptor::*;
    let append = |groups: &'a [Vec<crate::EffectPassDescriptor>],
                  out: &mut Vec<&'a crate::EffectPassDescriptor>|
     -> Result<(), EffectsError> {
        for group in groups {
            if out
                .len()
                .checked_add(group.len())
                .is_none_or(|length| length > count)
            {
                return Err(error("Frozen borrowed visitor exceeds predicted count"));
            }
            out.extend(group);
        }
        Ok(())
    };
    for item in items {
        match item {
            Group(group) => {
                borrowed_passes(&group.items, out, count)?;
                append(&group.effect_pass_groups, out)?;
            }
            SceneTransition(transition) => {
                for group in [&transition.outgoing, &transition.incoming] {
                    borrowed_passes(&group.items, out, count)?;
                    append(&group.effect_pass_groups, out)?;
                }
            }
            Layer(layer) => append(&layer.effect_pass_groups, out)?,
            Transition {
                outgoing, incoming, ..
            } => {
                for layer in outgoing.iter().chain(incoming) {
                    append(&layer.effect_pass_groups, out)?;
                }
            }
            SceneEffect { effect_pass_groups } => append(effect_pass_groups, out)?,
        }
    }
    Ok(())
}
impl<'a> FrameTraversalCursor<'a> {
    pub(crate) fn new(frame: &'a PreparedFrame) -> Result<Self, EffectsError> {
        let count = frame.canvas.total_passes;
        cursor_storage_bytes(count).ok_or_else(|| error("Canvas cursor storage bound overflow"))?;
        let mut keys = Vec::with_capacity(count);
        let mut descriptors = Vec::with_capacity(count);
        let mut identities = Vec::with_capacity(count);
        validate_cursor_shape(
            count,
            [count, count],
            [
                keys.capacity(),
                descriptors.capacity(),
                identities.capacity(),
            ],
        )?;
        let mut overflow = false;
        crate::effect_positions::visit_passes(&frame.frame, |position, _| {
            if keys.len() == count {
                overflow = true;
            } else {
                keys.push(position);
            }
        });
        if overflow {
            return Err(error("Frozen position visitor exceeds predicted count"));
        }
        borrowed_passes(&frame.frame.items, &mut descriptors, count)?;
        validate_cursor_shape(
            count,
            [keys.len(), descriptors.len()],
            [
                keys.capacity(),
                descriptors.capacity(),
                identities.capacity(),
            ],
        )?;
        let capacities = [
            keys.capacity(),
            descriptors.capacity(),
            identities.capacity(),
        ];
        identities.extend(keys.into_iter().zip(descriptors));
        validate_cursor_shape(
            count,
            [identities.len(), identities.len()],
            [capacities[0], capacities[1], identities.capacity()],
        )?;
        Ok(Self {
            frame,
            identities,
            next: 0,
        })
    }
    pub(crate) fn next(
        &mut self,
        position: &EffectPassPosition,
        pass: &EffectPass,
    ) -> Result<FrameTraversalPass<'a>, EffectsError> {
        let state = &self.frame.canvas;
        let (frozen_position, descriptor) = self
            .identities
            .get(self.next)
            .ok_or_else(|| error("Unexpected extra frame pass"))?;
        if frozen_position != position || !matches_descriptor(descriptor, pass) {
            return Err(error("Frozen frame pass identity mismatch"));
        }
        let ordinal = self.next;
        let result = match pass.shader.as_str() {
            "liquid" => {
                let index = self
                    .frame
                    .liquid_positions
                    .iter()
                    .position(|p| p == position)
                    .ok_or_else(|| error("Missing positioned Liquid state"))?;
                let prepared = &self.frame.liquid[index];
                if !prepared.matches(pass, state.dimensions) {
                    return Err(error("Liquid frozen identity mismatch"));
                }
                FrameTraversalPass::Liquid(prepared)
            }
            "canvas" => match &state
                .entries
                .iter()
                .find(|e| e.ordinal == ordinal)
                .ok_or_else(|| error("Missing Canvas slot"))?
                .prepared
            {
                Some(prepared) if prepared.matches(pass, state.dimensions) => {
                    FrameTraversalPass::Canvas(prepared)
                }
                Some(_) => return Err(error("Canvas frozen identity mismatch")),
                None if state.active.is_none() && state.missing() == Some(ordinal) => {
                    FrameTraversalPass::NeedCapture(CanvasCaptureTicket {
                        frame_id: state.frame_id,
                        ordinal,
                        dimensions: state.dimensions,
                    })
                }
                None => return Err(error("Canvas preparation pending or capture out of order")),
            },
            _ => FrameTraversalPass::Ordinary,
        };
        self.next += 1;
        Ok(result)
    }
    pub(crate) fn finish(self) -> Result<(), EffectsError> {
        if self.next == self.frame.canvas.total_passes {
            Ok(())
        } else {
            Err(error("Incomplete frozen frame traversal"))
        }
    }
}
