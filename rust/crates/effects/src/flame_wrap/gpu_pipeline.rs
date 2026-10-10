use super::pack_uniforms;

pub(crate) const BOUNDARY_ENTRY_POINT: &str = "fragment_boundary";
pub(crate) const FINAL_ENTRY_POINT: &str = crate::pipeline::EFFECT_FRAGMENT_ENTRY_POINT;
use crate::{EffectPass, EffectsError};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use wgpu::util::DeviceExt;

pub(crate) struct FlameWrapPipeline {
    boundary_layout: wgpu::BindGroupLayout,
    final_layout: wgpu::BindGroupLayout,
    boundary: wgpu::RenderPipeline,
    final_pass: wgpu::RenderPipeline,
}

impl FlameWrapPipeline {
    pub(crate) fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let uniform = wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: std::num::NonZeroU64::new(48),
            },
            count: None,
        };
        let boundary_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("flame-wrap-boundary-uniforms"),
            entries: &[uniform],
        });
        let final_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("flame-wrap-final-uniforms-mask"),
            entries: &[
                uniform,
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
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("flame-wrap-vertex"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("flame-wrap"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/flame_wrap.wgsl").into()),
        });
        let make = |layout: &wgpu::BindGroupLayout, entry: &str, format: wgpu::TextureFormat| {
            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(entry),
                bind_group_layouts: &[
                    Some(context.texture_sampler_bind_group_layout()),
                    Some(layout),
                ],
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &vertex,
                    entry_point: Some("vertex_main"),
                    buffers: &[wgpu::VertexBufferLayout {
                        array_stride: 8,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 0,
                            shader_location: 0,
                        }],
                    }],
                    compilation_options: Default::default(),
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(entry),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let boundary = make(
            &boundary_layout,
            BOUNDARY_ENTRY_POINT,
            wgpu::TextureFormat::Rgba8Unorm,
        );
        let final_pass = make(&final_layout, FINAL_ENTRY_POINT, context.texture_format());
        Self {
            boundary_layout,
            final_layout,
            boundary,
            final_pass,
        }
    }

    /// Both passes stay on the caller's encoder. Encoded resources remain owned by
    /// wgpu until submission completes; no source readback or queue submission.
    pub(crate) fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        pass: &EffectPass,
    ) -> Result<wgpu::Texture, EffectsError> {
        // Admission and source contract checks precede every allocation.
        let uniforms = pack_uniforms(pass, width, height)?;
        let invalid = || EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: "sourceTexture".into(),
        };
        if source.width() != width
            || source.height() != height
            || source.depth_or_array_layers() != 1
            || source.sample_count() != 1
            || source.dimension() != wgpu::TextureDimension::D2
            || source.format() != context.texture_format()
            || !source
                .usage()
                .contains(wgpu::TextureUsages::TEXTURE_BINDING)
        {
            return Err(invalid());
        }
        let maximum = context.device().limits().max_texture_dimension_2d;
        if width > maximum || height > maximum {
            return Err(EffectsError::InvalidInputDimensions {
                width,
                height,
                maximum,
            });
        }
        let device = context.device();
        let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("flame-wrap-uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let mask = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("flame-wrap-boundary-mask"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let mask_view = mask.create_view(&Default::default());
        let source_view = source.create_view(&Default::default());
        let source_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("flame-wrap-source"),
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
        let boundary_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("flame-wrap-boundary"),
            layout: &self.boundary_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            }],
        });
        let final_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("flame-wrap-final"),
            layout: &self.final_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&mask_view),
                },
            ],
        });
        let output = context.create_render_texture(width, height, "flame-wrap-output");
        let output_view = output.create_view(&Default::default());
        for (pipeline, group, view, label) in [
            (
                &self.boundary,
                &boundary_group,
                &mask_view,
                "flame-wrap-mask",
            ),
            (
                &self.final_pass,
                &final_group,
                &output_view,
                "flame-wrap-optics",
            ),
        ] {
            let mut render = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
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
            render.set_pipeline(pipeline);
            render.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
            render.set_bind_group(0, &source_group, &[]);
            render.set_bind_group(1, group, &[]);
            render.draw(0..6, 0..1);
        }
        Ok(output)
    }
}
