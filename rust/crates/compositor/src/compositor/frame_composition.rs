use super::{
    BlendUniformBuffer, CompositionScope, Compositor, CompositorError, FrameDescriptor,
    FrameItemDescriptor, FrameTraversalCursor, GpuContext, LayerDescriptor, LayerListPosition,
    PassLocation, wgpu,
};

impl Compositor {
    // Surface rendering and texture readback must execute exactly the same item graph.
    pub(super) fn compose_items(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        scene: wgpu::Texture,
        prepared: &mut FrameTraversalCursor<'_>,
    ) -> Result<wgpu::Texture, CompositorError> {
        self.compose_item_list(
            context,
            encoder,
            frame,
            &frame.items,
            scene,
            &CompositionScope::default(),
            prepared,
        )
    }

    pub(super) fn compose_item_list(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        items: &[FrameItemDescriptor],
        mut scene: wgpu::Texture,
        scope: &CompositionScope,
        prepared: &mut FrameTraversalCursor<'_>,
    ) -> Result<wgpu::Texture, CompositorError> {
        for (index, item) in items.iter().enumerate() {
            scene = match item {
                FrameItemDescriptor::Group(group) => self.compose_group(
                    context,
                    encoder,
                    frame,
                    &scene,
                    group,
                    &scope.group(index),
                    prepared,
                )?,
                FrameItemDescriptor::SceneTransition(transition) => {
                    // Both complete pictures see the same parent. Branch-local
                    // post only sees its isolated group, never that backdrop.
                    // Endpoints still consume/validate both branches' local cursor.
                    let from = self.compose_group(
                        context,
                        encoder,
                        frame,
                        &scene,
                        &transition.outgoing,
                        &scope.branch(index, 0),
                        prepared,
                    )?;
                    let to = self.compose_group(
                        context,
                        encoder,
                        frame,
                        &scene,
                        &transition.incoming,
                        &scope.branch(index, 1),
                        prepared,
                    )?;
                    self.compose_transition(
                        context,
                        encoder,
                        &from,
                        &to,
                        transition.progress,
                        transition.style.as_ref(),
                        frame.width,
                        frame.height,
                    )?
                }
                FrameItemDescriptor::Layer(layer) => self.compose_layers(
                    context,
                    encoder,
                    frame,
                    &scene,
                    std::slice::from_ref(layer),
                    scope,
                    LayerListPosition::Single(index),
                    prepared,
                )?,
                FrameItemDescriptor::SceneEffect { effect_pass_groups } => self
                    .apply_effect_groups(
                        context,
                        encoder,
                        &scene,
                        frame.width,
                        frame.height,
                        effect_pass_groups,
                        &scope.item(PassLocation::Scene(index)),
                        prepared,
                    )?,
                FrameItemDescriptor::Transition {
                    outgoing,
                    incoming,
                    progress,
                    style,
                } => {
                    if !progress.is_finite() || !(0.0..=1.0).contains(progress) {
                        return Err(CompositorError::InvalidTransitionProgress(*progress));
                    }
                    // Composite each picture against the SAME backdrop, not against
                    // each other. This preserves clip blend modes, masks and alpha.
                    let from = self.compose_layers(
                        context,
                        encoder,
                        frame,
                        &scene,
                        outgoing,
                        scope,
                        LayerListPosition::Outgoing(index),
                        prepared,
                    )?;
                    let to = self.compose_layers(
                        context,
                        encoder,
                        frame,
                        &scene,
                        incoming,
                        scope,
                        LayerListPosition::Incoming(index),
                        prepared,
                    )?;
                    self.compose_transition(
                        context,
                        encoder,
                        &from,
                        &to,
                        *progress,
                        style.as_ref(),
                        frame.width,
                        frame.height,
                    )?
                }
            };
        }
        Ok(scene)
    }

    fn compose_transition(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        from: &wgpu::Texture,
        to: &wgpu::Texture,
        progress: f32,
        style: Option<&crate::NativeTransitionStyle>,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        if let Some(style) = style {
            if !style.valid() {
                return Err(CompositorError::InvalidTransitionStyle);
            }
            // Both branches have already been consumed, even at exact endpoints.
            if progress == 0.0 {
                return Ok(from.clone());
            }
            if progress == 1.0 {
                return Ok(to.clone());
            }
            let draws = super::peel_pipeline::geometry(style, progress, width, height)?;
            let premultiplied =
                self.texture_pool
                    .acquire(context, width, height, "native-peel-premultiplied");
            let output = self
                .texture_pool
                .acquire(context, width, height, "native-peel-straight");
            self.peel
                .render(context, encoder, from, to, &premultiplied, &output, &draws);
            Ok(output)
        } else {
            self.blend_textures(
                context,
                encoder,
                from,
                to,
                BlendUniformBuffer {
                    blend_mode: 17,
                    progress,
                    _padding: [0; 2],
                },
                width,
                height,
            )
        }
    }

    fn compose_layers(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        base: &wgpu::Texture,
        layers: &[LayerDescriptor],
        scope: &CompositionScope,
        list: LayerListPosition,
        prepared: &mut FrameTraversalCursor<'_>,
    ) -> Result<wgpu::Texture, CompositorError> {
        let mut scene = base.clone();
        for (index, layer) in layers.iter().enumerate() {
            let location = scope.item(list.layer(index));
            let texture = self.render_layer(context, encoder, frame, layer, &location, prepared)?;
            scene = self.blend_texture(
                context,
                encoder,
                &scene,
                &texture,
                layer.blend_mode,
                frame.width,
                frame.height,
            )?;
        }
        Ok(scene)
    }
}
