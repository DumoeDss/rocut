use super::{Compositor, CompositorError, GpuContext, RenderFrameOptions, wgpu};
use crate::{CanvasCaptureTicket, FrameDescriptor, PreparedFrame};

impl Compositor {
    /// Actual uploaded and pooled RGBA8 storage, including idle pool allocations.
    /// Native output charges these resident resources in addition to its own
    /// conservative CPU/staging/PNG peak; no texture is retained across an await.
    pub fn resident_rgba_bytes(&self) -> Option<u64> {
        self.textures.resident_rgba_bytes()?.checked_add(self.texture_pool.resident_rgba_bytes()?)
    }

    pub fn render_frame_to_texture(
        &mut self,
        context: &GpuContext,
        frame: &FrameDescriptor,
    ) -> Result<wgpu::Texture, CompositorError> {
        crate::group_admission::validate(frame)?;
        let prepared = crate::FramePreparation::new(frame.clone())?.complete()?;
        self.render_prepared_frame_to_texture(context, prepared)
    }

    pub fn render_prepared_frame_to_texture(
        &mut self,
        context: &GpuContext,
        prepared: PreparedFrame,
    ) -> Result<wgpu::Texture, CompositorError> {
        prepared.finalize_canvas()?;
        self.validate_capture_graph(context, &prepared)?;
        let mut encoder = self.frame_encoder(context);
        let scene = self.encode_prepared_frame(context, &mut encoder, &prepared)?;
        context.queue().submit([encoder.finish()]);
        Ok(scene)
    }

    pub fn render_frame(
        &mut self,
        context: &GpuContext,
        options: RenderFrameOptions<'_, '_>,
    ) -> Result<(), CompositorError> {
        crate::group_admission::validate(options.frame)?;
        let prepared = crate::FramePreparation::new(options.frame.clone())?.complete()?;
        self.render_prepared_frame(context, prepared, options.surface)
    }

    pub fn render_prepared_frame(
        &mut self,
        context: &GpuContext,
        prepared: PreparedFrame,
        surface: &wgpu::Surface<'_>,
    ) -> Result<(), CompositorError> {
        prepared.finalize_canvas()?;
        self.validate_capture_graph(context, &prepared)?;
        let mut encoder = self.frame_encoder(context);
        let scene = self.encode_prepared_frame(context, &mut encoder, &prepared)?;
        // An incomplete traversal must never acquire/present a surface.
        let surface_texture = context.acquire_surface_texture(surface)?;
        let surface_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        context.encode_texture_presentation_to_view(
            &mut encoder,
            &scene,
            &surface_view,
            surface,
            "compositor-present-pass",
        )?;
        context.queue().submit([encoder.finish()]);
        surface_texture.present();
        Ok(())
    }

    /// Re-traverse the same immutable graph, stopping at the first missing Canvas.
    /// The capture callback must synchronously copy/submit before returning; it
    /// may retain an independent staging job, never this pooled texture for later.
    /// No surface is acquired, and the suffix is not encoded after the boundary.
    pub fn capture_prepared_frame<T>(
        &mut self,
        context: &GpuContext,
        prepared: &PreparedFrame,
        capture: impl FnOnce(CanvasCaptureTicket, &wgpu::Texture) -> T,
    ) -> Result<Option<T>, CompositorError> {
        self.validate_capture_graph(context, prepared)?;
        let mut encoder = self.frame_encoder(context);
        match self.encode_prepared_frame(context, &mut encoder, prepared) {
            Err(CompositorError::CanvasCaptureRequired { ticket, input }) => {
                // The independent capture copy must follow this prefix on the
                // same queue, with no await or pool recycle between submissions.
                context.queue().submit([encoder.finish()]);
                Ok(Some(capture(ticket, &input)))
            }
            Err(error) => Err(error),
            Ok(_) => {
                // A complete probe is not presentation. Normal requests skip
                // this path once Canvas readiness is known.
                prepared.finalize_canvas()?;
                Ok(None)
            }
        }
    }

    fn frame_encoder(&self, context: &GpuContext) -> wgpu::CommandEncoder {
        context
            .device()
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("compositor-frame-encoder"),
            })
    }

    fn encode_prepared_frame(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        prepared: &PreparedFrame,
    ) -> Result<wgpu::Texture, CompositorError> {
        let frame = &prepared.frame;
        self.texture_pool.recycle_frame();
        let scene = self.create_cleared_texture(
            context,
            encoder,
            frame.width,
            frame.height,
            frame.clear.color,
        );
        let mut cursor = prepared.traversal_cursor()?;
        let scene = self.compose_items(context, encoder, frame, scene, &mut cursor)?;
        cursor.finish()?;
        Ok(scene)
    }

    fn validate_capture_graph(
        &self,
        context: &GpuContext,
        prepared: &PreparedFrame,
    ) -> Result<(), CompositorError> {
        let mut canvas = false;
        crate::effect_positions::visit_passes(&prepared.frame, |_, pass| {
            canvas |= pass.shader == "canvas";
        });
        if !canvas {
            return super::canvas_graph_preflight::validate(&prepared.frame, &mut |id| self.textures.get(id).is_some());
        }
        let frame = &prepared.frame;
        effects::validate_canvas_device_capture(
            [frame.width, frame.height],
            &context.device().limits(),
            context.texture_format(),
        )?;
        super::canvas_graph_preflight::validate(frame, &mut |id| self.textures.get(id).is_some())
    }
}
