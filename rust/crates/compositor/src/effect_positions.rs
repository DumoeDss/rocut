use crate::{EffectPassDescriptor, FrameDescriptor, FrameItemDescriptor};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum PassLocation {
    Layer(usize),
    Outgoing(usize, usize),
    Incoming(usize, usize),
    Scene(usize),
    Group(Vec<usize>),
    Nested(Vec<usize>, Box<PassLocation>),
    SceneBranch(Vec<usize>, usize, Box<PassLocation>),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct EffectPassPosition {
    pub(crate) location: PassLocation,
    pub(crate) group: usize,
    pub(crate) pass_index: usize,
}

pub(crate) fn visit_passes(
    frame: &FrameDescriptor,
    mut visit: impl FnMut(EffectPassPosition, &EffectPassDescriptor),
) {
    visit_groups(frame, |location, groups| {
        for (group, passes) in groups.iter().enumerate() {
            for (pass_index, pass) in passes.iter().enumerate() {
                visit(
                    EffectPassPosition {
                        location: location.clone(),
                        group,
                        pass_index,
                    },
                    pass,
                );
            }
        }
    });
}

pub(crate) fn visit_groups(
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

#[cfg(test)]
#[path = "effect_positions_tests.rs"]
mod tests;
