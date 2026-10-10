use super::{
    CompositionScope, Compositor, CompositorError, FrameDescriptor, FrameTraversalCursor,
    GpuContext, LayerDescriptor, wgpu,
};
use crate::{IsolatedGroupDescriptor, QuadTransformDescriptor};

impl Compositor {
    pub(super) fn compose_group(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        parent: &wgpu::Texture,
        group: &IsolatedGroupDescriptor,
        scope: &CompositionScope,
        prepared: &mut FrameTraversalCursor<'_>,
    ) -> Result<wgpu::Texture, CompositorError> {
        let transparent =
            self.create_cleared_texture(context, encoder, frame.width, frame.height, [0.0; 4]);
        // sceneEffect inside the child list can only see this group's earlier
        // children. It cannot modify or sample the parent or adjacent groups.
        let mut current = self.compose_item_list(
            context,
            encoder,
            frame,
            &group.items,
            transparent,
            scope,
            prepared,
        )?;
        if !group.effect_pass_groups.is_empty() {
            current = self.apply_effect_groups(
                context,
                encoder,
                &current,
                frame.width,
                frame.height,
                &group.effect_pass_groups,
                &scope.group_post(),
                prepared,
            )?;
        }
        if group.opacity != 1.0 {
            let target = self.texture_pool.acquire(
                context,
                frame.width,
                frame.height,
                "compositor-group-opacity",
            );
            // Reuse the straight-alpha layer transfer shader without publishing
            // an intermediate texture ID into the persistent source registry.
            let layer = LayerDescriptor {
                texture_id: String::new(),
                transform: QuadTransformDescriptor {
                    center_x: frame.width as f32 / 2.0,
                    center_y: frame.height as f32 / 2.0,
                    width: frame.width as f32,
                    height: frame.height as f32,
                    rotation_degrees: 0.0,
                    flip_x: false,
                    flip_y: false,
                },
                opacity: group.opacity,
                blend_mode: group.blend_mode,
                effect_pass_groups: vec![],
                mask: None,
            };
            self.render_source_to_texture(
                context,
                encoder,
                &current,
                &target,
                frame.width,
                frame.height,
                &layer,
            );
            current = target;
        }
        self.blend_texture(
            context,
            encoder,
            parent,
            &current,
            group.blend_mode,
            frame.width,
            frame.height,
        )
    }
}
