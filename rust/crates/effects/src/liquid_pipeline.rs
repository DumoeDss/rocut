use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use wgpu::util::DeviceExt;

use crate::{EffectPass, EffectsError};

pub(crate) struct LiquidPipeline {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    resolution_grid: [f32; 4],
    optics: [f32; 4],
    color: [f32; 4],
}

impl LiquidPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("liquid-state-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("liquid-pipeline-layout"),
            bind_group_layouts: &[
                Some(context.texture_sampler_bind_group_layout()),
                Some(&layout),
            ],
            immediate_size: 0,
        });
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liquid-quad"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let fragment = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liquid-shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/liquid.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("liquid-pipeline"),
            layout: Some(&pipeline_layout),
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
                    format: context.texture_format(),
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
        Self { layout, pipeline }
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        pass: &EffectPass,
    ) -> Result<wgpu::Texture, EffectsError> {
        let prepared = crate::LiquidPreparation::new(pass.clone(), [width, height])?.complete()?;
        self.apply_prepared(context, encoder, source, width, height, pass, &prepared)
    }

    pub fn apply_prepared(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        pass: &EffectPass,
        prepared: &crate::PreparedLiquidPass,
    ) -> Result<wgpu::Texture, EffectsError> {
        if !prepared.matches(pass, [width, height]) {
            return Err(EffectsError::InvalidPreparedLiquid);
        }
        let [nx, ny] = prepared.grid;
        let uniforms = Uniforms {
            resolution_grid: [width as f32, height as f32, nx as f32, ny as f32],
            optics: prepared.optics,
            color: prepared.color,
        };
        let device = context.device();
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("liquid-uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        // An unfiltered data texture stays within the existing WebGL2-level
        // device limits; no storage-buffer or float-filtering feature is needed.
        let state_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("liquid-state"),
            size: wgpu::Extent3d {
                width: nx as u32,
                height: ny as u32,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba32Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        context.queue().write_texture(
            state_texture.as_image_copy(),
            bytemuck::cast_slice(&prepared.cells),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(nx as u32 * 16),
                rows_per_image: Some(ny as u32),
            },
            state_texture.size(),
        );
        let state_view = state_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let state_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("liquid-state"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&state_view),
                },
            ],
        });
        let input_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let source_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("liquid-source"),
            layout: context.texture_sampler_bind_group_layout(),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&input_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                },
            ],
        });
        let output = context.create_render_texture(width, height, "liquid-output");
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());
        {
            let mut render = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("liquid-render"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
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
            render.set_pipeline(&self.pipeline);
            render.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
            render.set_bind_group(0, &source_group, &[]);
            render.set_bind_group(1, &state_group, &[]);
            render.draw(0..6, 0..1);
        }
        Ok(output)
    }
}
