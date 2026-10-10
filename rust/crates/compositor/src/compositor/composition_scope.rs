use crate::effect_positions::PassLocation;

/// Matches the frozen graph's position grammar without equating identical passes
/// or letting an isolated group's local scene include its parent's backdrop.
#[derive(Clone, Default)]
pub(super) struct CompositionScope {
    ancestors: Vec<usize>,
    branches: Vec<(Vec<usize>, usize)>,
}

impl CompositionScope {
    pub fn group(&self, index: usize) -> Self {
        let mut child = self.clone();
        child.ancestors.push(index);
        child
    }

    pub fn branch(&self, index: usize, side: usize) -> Self {
        let mut path = self.ancestors.clone();
        path.push(index);
        let mut child = self.clone();
        child.branches.push((path, side));
        child.ancestors.clear();
        child
    }

    pub fn item(&self, local: PassLocation) -> PassLocation {
        let local = if self.ancestors.is_empty() {
            local
        } else {
            PassLocation::Nested(self.ancestors.clone(), Box::new(local))
        };
        self.wrap(local)
    }

    pub fn group_post(&self) -> PassLocation {
        self.wrap(PassLocation::Group(self.ancestors.clone()))
    }

    fn wrap(&self, mut local: PassLocation) -> PassLocation {
        for (path, side) in self.branches.iter().rev() {
            local = PassLocation::SceneBranch(path.clone(), *side, Box::new(local));
        }
        local
    }
}

#[derive(Clone, Copy)]
pub(super) enum LayerListPosition {
    Single(usize),
    Outgoing(usize),
    Incoming(usize),
}
impl LayerListPosition {
    pub fn layer(self, layer: usize) -> PassLocation {
        match self {
            Self::Single(item) => PassLocation::Layer(item),
            Self::Outgoing(item) => PassLocation::Outgoing(item, layer),
            Self::Incoming(item) => PassLocation::Incoming(item, layer),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_branches_and_nested_scene_transitions_keep_full_locations() {
        let root = CompositionScope::default();
        let group = root.group(3).group(2);
        assert_eq!(group.group_post(), PassLocation::Group(vec![3, 2]));
        assert_eq!(
            group.item(PassLocation::Scene(4)),
            PassLocation::Nested(vec![3, 2], Box::new(PassLocation::Scene(4)))
        );
        let branch = group.branch(1, 0);
        assert_eq!(
            branch.group_post(),
            PassLocation::SceneBranch(vec![3, 2, 1], 0, Box::new(PassLocation::Group(vec![])))
        );
        let inner = branch.group(5).branch(6, 1);
        assert_eq!(
            inner.item(PassLocation::Incoming(7, 8)),
            PassLocation::SceneBranch(
                vec![3, 2, 1],
                0,
                Box::new(PassLocation::SceneBranch(
                    vec![5, 6],
                    1,
                    Box::new(PassLocation::Incoming(7, 8))
                ))
            )
        );
        assert_ne!(branch.group_post(), group.branch(1, 1).group_post());
    }

    #[test]
    fn runtime_scope_keys_equal_static_visitor_for_double_branches_and_legacy_lists() {
        use crate::effect_positions::EffectPassPosition;
        use crate::{
            BlendMode, CanvasClearDescriptor, EffectPassDescriptor, FrameDescriptor,
            FrameItemDescriptor, IsolatedGroupDescriptor, LayerDescriptor, QuadTransformDescriptor,
            SceneTransitionDescriptor,
        };
        fn passes() -> Vec<Vec<EffectPassDescriptor>> {
            vec![
                vec![
                    EffectPassDescriptor {
                        shader: "canvas".into(),
                        uniforms: Default::default(),
                    },
                    EffectPassDescriptor {
                        shader: "liquid".into(),
                        uniforms: Default::default(),
                    },
                ],
                vec![EffectPassDescriptor {
                    shader: "canvas".into(),
                    uniforms: Default::default(),
                }],
            ]
        }
        fn layer() -> LayerDescriptor {
            LayerDescriptor {
                texture_id: "source".into(),
                transform: QuadTransformDescriptor {
                    center_x: 8.0,
                    center_y: 8.0,
                    width: 16.0,
                    height: 16.0,
                    rotation_degrees: 0.0,
                    flip_x: false,
                    flip_y: false,
                },
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                effect_pass_groups: passes(),
                mask: None,
            }
        }
        fn group(items: Vec<FrameItemDescriptor>) -> IsolatedGroupDescriptor {
            IsolatedGroupDescriptor {
                items,
                effect_pass_groups: passes(),
                opacity: 0.0,
                blend_mode: BlendMode::Normal,
            }
        }
        fn legacy() -> FrameItemDescriptor {
            FrameItemDescriptor::Transition {
                outgoing: vec![layer(), layer()],
                incoming: vec![layer()],
                progress: 0.0,
            }
        }
        fn branch(items: Vec<FrameItemDescriptor>) -> FrameItemDescriptor {
            FrameItemDescriptor::SceneTransition(Box::new(SceneTransitionDescriptor {
                outgoing: group(items),
                incoming: group(vec![legacy()]),
                progress: 1.0,
            }))
        }
        fn emit(
            out: &mut Vec<EffectPassPosition>,
            location: PassLocation,
            groups: &[Vec<EffectPassDescriptor>],
        ) {
            for (group, passes) in groups.iter().enumerate() {
                for pass_index in 0..passes.len() {
                    out.push(EffectPassPosition {
                        location: location.clone(),
                        group,
                        pass_index,
                    });
                }
            }
        }
        fn post(
            out: &mut Vec<EffectPassPosition>,
            group: &IsolatedGroupDescriptor,
            scope: &CompositionScope,
        ) {
            walk(out, &group.items, scope);
            emit(out, scope.group_post(), &group.effect_pass_groups);
        }
        fn walk(
            out: &mut Vec<EffectPassPosition>,
            items: &[FrameItemDescriptor],
            scope: &CompositionScope,
        ) {
            for (index, item) in items.iter().enumerate() {
                match item {
                    FrameItemDescriptor::Group(group) => post(out, group, &scope.group(index)),
                    FrameItemDescriptor::SceneTransition(t) => {
                        post(out, &t.outgoing, &scope.branch(index, 0));
                        post(out, &t.incoming, &scope.branch(index, 1));
                    }
                    FrameItemDescriptor::Layer(layer) => emit(
                        out,
                        scope.item(LayerListPosition::Single(index).layer(0)),
                        &layer.effect_pass_groups,
                    ),
                    FrameItemDescriptor::SceneEffect { effect_pass_groups } => emit(
                        out,
                        scope.item(PassLocation::Scene(index)),
                        effect_pass_groups,
                    ),
                    FrameItemDescriptor::Transition {
                        outgoing, incoming, ..
                    } => {
                        for (side, layers) in [
                            (LayerListPosition::Outgoing(index), outgoing),
                            (LayerListPosition::Incoming(index), incoming),
                        ] {
                            for (layer, value) in layers.iter().enumerate() {
                                emit(
                                    out,
                                    scope.item(side.layer(layer)),
                                    &value.effect_pass_groups,
                                );
                            }
                        }
                    }
                }
            }
        }
        let inner = branch(vec![FrameItemDescriptor::Group(group(vec![
            legacy(),
            FrameItemDescriptor::Layer(layer()),
        ]))]);
        let outer = branch(vec![FrameItemDescriptor::Group(group(vec![
            inner,
            FrameItemDescriptor::SceneEffect {
                effect_pass_groups: passes(),
            },
        ]))]);
        let frame = FrameDescriptor {
            width: 16,
            height: 16,
            clear: CanvasClearDescriptor { color: [0.0; 4] },
            items: vec![
                legacy(),
                FrameItemDescriptor::Group(group(vec![outer])),
                FrameItemDescriptor::Layer(layer()),
            ],
        };
        let mut expected = Vec::new();
        crate::effect_positions::visit_passes(&frame, |position, _| expected.push(position));
        let mut actual = Vec::new();
        walk(&mut actual, &frame.items, &CompositionScope::default());
        assert_eq!(actual, expected);
        assert_eq!(
            actual
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            actual.len()
        );
        assert!(actual.iter().any(|p| matches!(&p.location,
            PassLocation::SceneBranch(_, _, inner) if matches!(inner.as_ref(), PassLocation::SceneBranch(_, _, _)))));
    }
}
