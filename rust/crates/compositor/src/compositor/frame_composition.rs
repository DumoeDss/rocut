use super::{
    BlendUniformBuffer, Compositor, CompositorError, FrameDescriptor, FrameItemDescriptor,
    GpuContext, LayerDescriptor, wgpu,
};

impl Compositor {
    // Surface rendering and texture readback must execute exactly the same item graph.
    pub(super) fn compose_items(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        mut scene: wgpu::Texture,
    ) -> Result<wgpu::Texture, CompositorError> {
        for item in &frame.items {
            scene = match item {
                FrameItemDescriptor::Layer(layer) => self.compose_layers(
                    context,
                    encoder,
                    frame,
                    &scene,
                    std::slice::from_ref(layer),
                )?,
                FrameItemDescriptor::SceneEffect { effect_pass_groups } => self
                    .apply_effect_groups(
                        context,
                        encoder,
                        &scene,
                        frame.width,
                        frame.height,
                        effect_pass_groups,
                    )?,
                FrameItemDescriptor::Transition {
                    outgoing,
                    incoming,
                    progress,
                } => {
                    if !progress.is_finite() || !(0.0..=1.0).contains(progress) {
                        return Err(CompositorError::InvalidTransitionProgress(*progress));
                    }
                    // Composite each picture against the SAME backdrop, not against
                    // each other. This preserves clip blend modes, masks and alpha.
                    let from = self.compose_layers(context, encoder, frame, &scene, outgoing)?;
                    let to = self.compose_layers(context, encoder, frame, &scene, incoming)?;
                    self.blend_textures(
                        context,
                        encoder,
                        &from,
                        &to,
                        BlendUniformBuffer {
                            blend_mode: 17,
                            progress: *progress,
                            _padding: [0; 2],
                        },
                        frame.width,
                        frame.height,
                    )?
                }
            };
        }
        Ok(scene)
    }

    fn compose_layers(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        frame: &FrameDescriptor,
        base: &wgpu::Texture,
        layers: &[LayerDescriptor],
    ) -> Result<wgpu::Texture, CompositorError> {
        let mut scene = base.clone();
        for layer in layers {
            let texture = self.render_layer(context, encoder, frame, layer)?;
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
