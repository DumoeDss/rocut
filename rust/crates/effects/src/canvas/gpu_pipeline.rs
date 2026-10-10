//! Canvas GPU execution only. Caller must prove capture-barrier full-source byte
//! identity and ordered preparation; texture metadata cannot prove GPU contents.
use super::raster::CanvasRasterPayload;
#[path = "gpu_admission.rs"]
mod admission;
use crate::EffectsError;
use admission::{invalid, payload_layout, supported};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use wgpu::util::DeviceExt;

pub(crate) struct CanvasGpuPipeline {
    source_layout: wgpu::BindGroupLayout,
    material_layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    output_format: wgpu::TextureFormat,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct PackedUniforms {
    geometry: [u32; 4],
    material: [f32; 4],
    light: [f32; 4],
    metadata: [u32; 4],
}
fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

impl CanvasGpuPipeline {
    /// Allocation-free first-capture admission, independent of source/payload.
    pub(crate) fn validate_device_capture(
        dimensions: [u32; 2],
        limits: &wgpu::Limits,
        format: wgpu::TextureFormat,
    ) -> Result<(), EffectsError> {
        super::renderer_bridge::validate_canvas_device_capture(dimensions, limits, format)
    }
    /// Pure CPU upload admission. Does not prove upstream capture provenance.
    pub(crate) fn validate_prepared_upload(
        width: u32,
        height: u32,
        payload: &CanvasRasterPayload,
        source_rgba: &[u8],
        limits: &wgpu::Limits,
        output_format: wgpu::TextureFormat,
    ) -> Result<u32, EffectsError> {
        Self::validate_device_capture([width, height], limits, output_format)?;
        payload_layout(width, height, payload, limits.max_texture_dimension_2d)?;
        let row = width
            .checked_mul(4)
            .ok_or_else(|| invalid("source upload row overflow"))?;
        let bytes = u64::from(row)
            .checked_mul(u64::from(height))
            .ok_or_else(|| invalid("source upload byte overflow"))?;
        if usize::try_from(bytes).ok() != Some(source_rgba.len()) {
            return Err(invalid(
                "exact source upload bytes or device/output limits invalid",
            ));
        }
        Ok(row)
    }

    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let source_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("canvas-full-source-layout"),
            entries: &[texture_entry(0)],
        });
        let material_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("canvas-material-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(64),
                    },
                    count: None,
                },
                texture_entry(1),
                texture_entry(2),
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("canvas-pipeline-layout"),
            bind_group_layouts: &[Some(&source_layout), Some(&material_layout)],
            immediate_size: 0,
        });
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("canvas-quad"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let fragment = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("canvas-shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/canvas.wgsl").into()),
        });
        let output_format = context.texture_format();
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("canvas-pipeline"),
            layout: Some(&layout),
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
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &fragment,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: output_format,
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
        Self {
            source_layout,
            material_layout,
            pipeline,
            output_format,
        }
    }

    pub fn apply_prepared(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        payload: &CanvasRasterPayload,
    ) -> Result<wgpu::Texture, EffectsError> {
        let (nx, ny, row) = payload_layout(
            width,
            height,
            payload,
            context.device().limits().max_texture_dimension_2d,
        )?;
        if source.width() != width
            || source.height() != height
            || source.depth_or_array_layers() != 1
            || source.dimension() != wgpu::TextureDimension::D2
            || source.sample_count() != 1
            || source.mip_level_count() != 1
            || !source
                .usage()
                .contains(wgpu::TextureUsages::TEXTURE_BINDING)
            || !supported(source.format())
            || !supported(self.output_format)
            || context.texture_format() != self.output_format
        {
            return Err(invalid(
                "source/output texture metadata or linear storage format mismatch",
            ));
        }
        // No GPU resource allocations or queue writes above this point.
        // Metadata cannot prove byte identity; caller must enforce its capture barrier.
        let device = context.device();
        let u = &payload.uniforms;
        let packed = PackedUniforms {
            geometry: u.geometry,
            material: u.material,
            light: u.light,
            metadata: u.metadata,
        };
        let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("canvas-uniforms"),
            contents: bytemuck::bytes_of(&packed),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let upload = |label: &str, values: &[[f32; 4]]| {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: nx,
                    height: ny,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba32Float,
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            context.queue().write_texture(
                texture.as_image_copy(),
                bytemuck::cast_slice(values),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(ny),
                },
                texture.size(),
            );
            texture
        };
        let pigment = upload("canvas-pigment", &payload.pigment_coverage);
        let height_texture = upload("canvas-height", &payload.height_wetness);
        let pigment_view = pigment.create_view(&wgpu::TextureViewDescriptor::default());
        let height_view = height_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let source_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("canvas-source"),
            layout: &self.source_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&source_view),
            }],
        });
        let material_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("canvas-material"),
            layout: &self.material_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&pigment_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&height_view),
                },
            ],
        });
        let output = context.create_render_texture(width, height, "canvas-output");
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());
        {
            let mut render = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("canvas-render"),
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
            render.set_bind_group(1, &material_group, &[]);
            render.draw(0..6, 0..1);
        }
        Ok(output)
    }
}
