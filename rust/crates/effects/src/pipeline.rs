use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::color_uniforms::pack_color_uniforms;
use crate::{EffectPass, UniformValue};

const GAUSSIAN_BLUR_SHADER_ID: &str = "gaussian-blur";
const COLOR_ADJUSTMENT_SHADER_ID: &str = "color-adjustment";
pub(crate) const EFFECT_FRAGMENT_ENTRY_POINT: &str = "fragment_main";
const COLOR_ADJUSTMENT_SHADER_SOURCE: &str = include_str!("shaders/color_adjustment.wgsl");
const GAUSSIAN_BLUR_SHADER_SOURCE: &str = include_str!("shaders/gaussian_blur.wgsl");

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
}

enum LiquidPreparedInput<'a, 'b> {
    Owned(&'a mut std::collections::VecDeque<crate::PreparedLiquidPass>),
    Borrowed(&'a mut dyn Iterator<Item = &'b crate::PreparedLiquidPass>),
}

pub struct EffectPipeline {
    liquid: crate::liquid_pipeline::LiquidPipeline,
    flame_wrap: crate::flame_wrap::gpu_pipeline::FlameWrapPipeline,
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error(
        "Invalid output dimensions: {width}x{height}; each dimension must be in 1..={maximum} (device max_texture_dimension_2d)"
    )]
    InvalidInputDimensions {
        width: u32,
        height: u32,
        maximum: u32,
    },
    #[error("Render preparation was cancelled")]
    Cancelled,
    #[error("Prepared Liquid pass does not match the frame")]
    InvalidPreparedLiquid,
    #[error("Liquid simulation failed: {message}")]
    LiquidSimulation { message: String },
    #[error("Bubble work budget exceeded: {message}")]
    BubbleWorkBudget { message: String },
    #[error("Frost work budget exceeded: {message}")]
    FrostWorkBudget { message: String },
    #[error("Canvas preparation failed: {message}")]
    CanvasPreparation { message: String },
    #[error("Canvas pass {pass_index} requires ordered input capture before material preparation")]
    CanvasSourceRequired { pass_index: usize },
    #[error("At least one effect pass is required")]
    MissingEffectPasses,
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
    #[error("Missing uniform '{uniform}' for shader '{shader}'")]
    MissingUniform { shader: String, uniform: String },
    #[error("Uniform '{uniform}' for shader '{shader}' must be a number")]
    InvalidNumberUniform { shader: String, uniform: String },
    #[error(
        "Uniform '{uniform}' for shader '{shader}' must be a vector of length {expected_length}"
    )]
    InvalidVectorUniform {
        shader: String,
        uniform: String,
        expected_length: usize,
    },
    #[error("Shader '{shader}' does not support uniform '{uniform}'")]
    UnsupportedUniform { shader: String, uniform: String },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct EffectUniformBuffer {
    pub(crate) resolution: [f32; 2],
    pub(crate) direction: [f32; 2],
    pub(crate) scalars: [f32; 4],
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let uniform_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-uniform-bind-group-layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    }],
                });
        let vertex_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-fullscreen-shader"),
                    source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
                });

        let pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        let pipelines = [
            (GAUSSIAN_BLUR_SHADER_ID, GAUSSIAN_BLUR_SHADER_SOURCE),
            (COLOR_ADJUSTMENT_SHADER_ID, COLOR_ADJUSTMENT_SHADER_SOURCE),
            ("vhs", include_str!("shaders/vhs.wgsl")),
            ("glitch", include_str!("shaders/glitch.wgsl")),
            ("retro-dither", include_str!("shaders/retro_dither.wgsl")),
            ("ascii", include_str!("shaders/ascii.wgsl")),
            ("mono-dither", include_str!("shaders/mono_dither.wgsl")),
            ("lens", include_str!("shaders/lens.wgsl")),
            ("magnify", include_str!("shaders/magnify.wgsl")),
            ("displacement", include_str!("shaders/displacement.wgsl")),
            ("laser", include_str!("shaders/laser.wgsl")),
            (
                "decrypt-reveal",
                include_str!("shaders/decrypt-reveal.wgsl"),
            ),
            ("ripple", include_str!("shaders/ripple.wgsl")),
            ("force-field", include_str!("shaders/force_field.wgsl")),
            ("droplets", include_str!("shaders/droplets.wgsl")),
            ("clouds", include_str!("shaders/clouds.wgsl")),
            ("blaze", include_str!("shaders/blaze.wgsl")),
            ("bubble", include_str!("shaders/bubble.wgsl")),
            ("frost", include_str!("shaders/frost.wgsl")),
        ]
        .into_iter()
        .map(|(id, source)| {
            let source = if matches!(id, "lens" | "magnify" | "displacement") {
                format!(
                    "{}\n{}\n{source}",
                    include_str!("shaders/spatial_region.wgsl"),
                    include_str!("shaders/lens_sampling.wgsl")
                )
            } else if matches!(id, "ripple" | "force-field") {
                format!("{}\n{source}", include_str!("shaders/wave_common.wgsl"))
            } else if matches!(id, "ascii" | "retro-dither") {
                format!("{}\n{source}", include_str!("shaders/spatial_region.wgsl"))
            } else {
                source.to_owned()
            };
            let shader_module =
                context
                    .device()
                    .create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some(id),
                        source: wgpu::ShaderSource::Wgsl(source.into()),
                    });
            let pipeline =
                context
                    .device()
                    .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                        label: Some(id),
                        layout: Some(&pipeline_layout),
                        vertex: wgpu::VertexState {
                            module: &vertex_shader_module,
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
                            module: &shader_module,
                            entry_point: Some(EFFECT_FRAGMENT_ENTRY_POINT),
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

            (id.to_string(), pipeline)
        })
        .collect();

        Self {
            liquid: crate::liquid_pipeline::LiquidPipeline::new(context),
            flame_wrap: crate::flame_wrap::gpu_pipeline::FlameWrapPipeline::new(context),
            uniform_bind_group_layout,
            pipelines,
        }
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("effects-command-encoder"),
                });
        let output = self.apply_with_encoder(
            context,
            &mut encoder,
            ApplyEffectsOptions {
                source,
                width,
                height,
                passes,
            },
        )?;
        context.queue().submit([encoder.finish()]);
        Ok(output)
    }

    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        options: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        self.apply_prepared_with_encoder(context, encoder, options, None)
    }

    pub fn apply_prepared_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        options: ApplyEffectsOptions<'_>,
        prepared: Option<&mut std::collections::VecDeque<crate::PreparedLiquidPass>>,
    ) -> Result<wgpu::Texture, EffectsError> {
        self.apply_liquid_input_with_encoder(
            context,
            encoder,
            options,
            prepared.map(LiquidPreparedInput::Owned),
        )
    }

    /// Request-local iteration leaves immutable Liquid material available when
    /// compositor traversal restarts at a Canvas capture boundary. No payload clone.
    pub fn apply_borrowed_prepared_with_encoder<'b>(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        options: ApplyEffectsOptions<'_>,
        prepared: &mut dyn Iterator<Item = &'b crate::PreparedLiquidPass>,
    ) -> Result<wgpu::Texture, EffectsError> {
        self.apply_liquid_input_with_encoder(
            context,
            encoder,
            options,
            Some(LiquidPreparedInput::Borrowed(prepared)),
        )
    }

    fn apply_liquid_input_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
        mut prepared: Option<LiquidPreparedInput<'_, '_>>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut current_texture: Option<wgpu::Texture> = None;

        for (pass_index, pass) in passes.iter().enumerate() {
            if pass.shader == "canvas" {
                crate::decode_canvas_pass(pass).map_err(|error| {
                    EffectsError::CanvasPreparation {
                        message: error.to_string(),
                    }
                })?;
                return Err(EffectsError::CanvasSourceRequired { pass_index });
            }
            let input_texture = current_texture.as_ref().unwrap_or(source);
            if pass.shader == "flame_wrap" {
                current_texture = Some(self.flame_wrap.apply_with_encoder(
                    context,
                    encoder,
                    input_texture,
                    width,
                    height,
                    pass,
                )?);
                continue;
            }
            if pass.shader == "liquid" {
                if let Some(prepared) = prepared.as_mut() {
                    let owned;
                    let state = match prepared {
                        LiquidPreparedInput::Owned(queue) => {
                            owned = queue
                                .pop_front()
                                .ok_or(EffectsError::InvalidPreparedLiquid)?;
                            &owned
                        }
                        LiquidPreparedInput::Borrowed(iterator) => {
                            iterator.next().ok_or(EffectsError::InvalidPreparedLiquid)?
                        }
                    };
                    current_texture = Some(self.liquid.apply_prepared(
                        context,
                        encoder,
                        input_texture,
                        width,
                        height,
                        pass,
                        state,
                    )?);
                    continue;
                }
                current_texture = Some(self.liquid.apply(
                    context,
                    encoder,
                    input_texture,
                    width,
                    height,
                    pass,
                )?);
                continue;
            }
            // Validate this pass before allocating its output or GPU uniforms.
            let packed_uniforms = pack_effect_uniforms(pass, width, height)?;
            let pipeline = self.pipelines.get(&pass.shader).ok_or_else(|| {
                EffectsError::UnknownEffectShader {
                    shader: pass.shader.clone(),
                }
            })?;
            if pass.shader == "bubble" {
                crate::bubble::validate_device_dimensions(
                    width,
                    height,
                    context.device().limits().max_texture_dimension_2d,
                )?;
            }
            if pass.shader == "frost" {
                let maximum = context.device().limits().max_texture_dimension_2d;
                if width > maximum || height > maximum {
                    return Err(EffectsError::InvalidInputDimensions {
                        width,
                        height,
                        maximum,
                    });
                }
            }
            let output_texture =
                context.create_render_texture(width, height, "effects-pass-output");
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let texture_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-texture-bind-group"),
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
            let uniform_buffer =
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("effects-uniform-buffer"),
                        contents: &packed_uniforms,
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    });
            let uniform_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-uniform-bind-group"),
                        layout: &self.uniform_bind_group_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform_buffer.as_entire_binding(),
                        }],
                    });
            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
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
                render_pass.set_pipeline(pipeline);
                render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                render_pass.draw(0..6, 0..1);
            }

            current_texture = Some(output_texture);
        }

        current_texture.ok_or(EffectsError::MissingEffectPasses)
    }
}

pub(crate) fn pack_effect_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, EffectsError> {
    if pass.shader == "flame_wrap" {
        return Ok(bytemuck::bytes_of(&crate::flame_wrap::pack_uniforms(pass, width, height)?).to_vec());
    }
    if pass.shader == "frost" {
        return Ok(bytemuck::bytes_of(&crate::frost::pack_uniforms(pass, width, height)?).to_vec());
    }
    if pass.shader == "bubble" {
        return Ok(
            bytemuck::bytes_of(&crate::bubble::pack_uniforms(pass, width, height)?).to_vec(),
        );
    }
    if pass.shader == "blaze" {
        return Ok(bytemuck::bytes_of(&crate::blaze::pack_uniforms(pass, width, height)?).to_vec());
    }
    if pass.shader == COLOR_ADJUSTMENT_SHADER_ID {
        return Ok(bytemuck::bytes_of(&pack_color_uniforms(pass, width, height)?).to_vec());
    }
    if pass.shader == "displacement" {
        return Ok(
            bytemuck::bytes_of(&crate::displacement::pack_uniforms(pass, width, height)?).to_vec(),
        );
    }
    if pass.shader == "laser" {
        return Ok(bytemuck::bytes_of(&crate::laser::pack_uniforms(pass, width, height)?).to_vec());
    }
    if pass.shader == "decrypt-reveal" {
        return Ok(
            bytemuck::bytes_of(&crate::decrypt_reveal::pack_uniforms(pass, width, height)?)
                .to_vec(),
        );
    }
    if matches!(pass.shader.as_str(), "ripple" | "force-field") {
        return Ok(
            bytemuck::bytes_of(&crate::wave_uniforms::pack_wave_uniforms(
                pass, width, height,
            )?)
            .to_vec(),
        );
    }
    if pass.shader == "clouds" {
        return Ok(
            bytemuck::bytes_of(&crate::clouds::pack_uniforms(pass, width, height)?).to_vec(),
        );
    }
    if pass.shader == "droplets" {
        return Ok(
            bytemuck::bytes_of(&crate::droplets::pack_uniforms(pass, width, height)?).to_vec(),
        );
    }
    if matches!(
        pass.shader.as_str(),
        "vhs" | "glitch" | "retro-dither" | "ascii" | "mono-dither" | "lens" | "magnify"
    ) {
        return Ok(
            bytemuck::bytes_of(&crate::stylized_uniforms::pack_stylized_uniforms(
                pass, width, height,
            )?)
            .to_vec(),
        );
    }
    if pass.shader != GAUSSIAN_BLUR_SHADER_ID {
        return Err(EffectsError::UnknownEffectShader {
            shader: pass.shader.clone(),
        });
    }
    let shader = pass.shader.as_str();
    let sigma = read_number_uniform(pass, "u_sigma")?;
    let step = read_number_uniform(pass, "u_step")?;
    let direction = read_vec2_uniform(pass, "u_direction")?;

    for uniform in pass.uniforms.keys() {
        if uniform == "u_sigma" || uniform == "u_step" || uniform == "u_direction" {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: shader.to_string(),
            uniform: uniform.clone(),
        });
    }

    Ok(bytemuck::bytes_of(&EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction,
        scalars: [sigma, step, 0.0, 0.0],
    })
    .to_vec())
}

pub(crate) fn read_number_uniform(pass: &EffectPass, uniform: &str) -> Result<f32, EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    match value {
        UniformValue::Number(value) => Ok(*value),
        UniformValue::Vector(_) => Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        }),
    }
}

fn read_vec2_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 2], EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    };
    if values.len() != 2 {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    }
    Ok([values[0], values[1]])
}
