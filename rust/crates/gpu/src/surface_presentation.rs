use crate::{FULLSCREEN_SHADER_SOURCE, GpuContext};

pub(crate) struct SurfacePresentation {
    premultiplied: wgpu::RenderPipeline,
}

impl SurfacePresentation {
    pub(crate) fn new(
        device: &wgpu::Device,
        texture_layout: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
    ) -> Self {
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gpu-surface-presentation-layout"),
            bind_group_layouts: &[Some(texture_layout)],
            immediate_size: 0,
        });
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-surface-presentation-vertex"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let fragment = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-surface-presentation-fragment"),
            source: wgpu::ShaderSource::Wgsl(
                include_str!("shaders/surface_presentation.wgsl").into(),
            ),
        });
        let premultiplied = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("gpu-surface-presentation-premultiplied"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &vertex,
                entry_point: Some("vertex_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x2,
                        offset: 0,
                        shader_location: 0,
                    }],
                }],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &fragment,
                entry_point: Some("fragment_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Self { premultiplied }
    }

    pub(crate) fn encode(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        target: &wgpu::TextureView,
        premultiply: bool,
        label: &'static str,
    ) {
        if !premultiply {
            context.encode_texture_blit_to_view(encoder, source, target, label);
            return;
        }
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let group = context
            .device()
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("gpu-surface-presentation-source"),
                layout: context.texture_sampler_bind_group_layout(),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&source_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                    },
                ],
            });
        let mut render = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
            multiview_mask: None,
        });
        render.set_pipeline(&self.premultiplied);
        render.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
        render.set_bind_group(0, &group, &[]);
        render.draw(0..6, 0..1);
    }
}
