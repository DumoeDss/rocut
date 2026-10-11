//! GPU transport of authoritative recipe Peel/Bend plans; no fold mathematics here.
use super::{CompositorError, GpuContext, wgpu};
use bytemuck::{Pod, Zeroable};
use editor_api::{
    NativeTransitionBlend as Blend, NativeTransitionClip as Clip,
    NativeTransitionDrawCommand as Command, NativeTransitionInput as Input, NativeTransitionStyle,
};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(super) struct Vertex {
    position: [f32; 4],
    uv: [f32; 2],
    brightness: f32,
    opacity: f32,
}
pub(super) struct Draw {
    pub input: Input,
    pub vertices: Vec<Vertex>,
}

pub(super) fn geometry(
    style: &NativeTransitionStyle,
    progress: f32,
    width: u32,
    height: u32,
) -> Result<Vec<Draw>, CompositorError> {
    let invalid = || CompositorError::InvalidTransitionStyle;
    let commands = style
        .plan(f64::from(progress), f64::from(width), f64::from(height))
        .map_err(|_| invalid())?;
    if commands.len() > style.work() as usize {
        return Err(invalid());
    }
    let mut draws = Vec::with_capacity(commands.len());
    for command in commands {
        if let Command::Mesh {
            input,
            vertices: mesh,
            brightness,
            opacity,
        } = command
        {
            if !(3..=4).contains(&mesh.len())
                || !brightness.is_finite()
                || !opacity.is_finite()
                || !(0.0..=1.0).contains(&brightness)
                || !(0.0..=1.0).contains(&opacity)
            {
                return Err(invalid());
            }
            let mut vertices = Vec::with_capacity((mesh.len() - 2) * 3);
            for i in 1..mesh.len() - 1 {
                for source in [&mesh[0], &mesh[i], &mesh[i + 1]] {
                    if !source
                        .position
                        .iter()
                        .chain(&source.uv)
                        .all(|v| v.is_finite())
                        || !source.w.is_finite()
                        || source.w <= 0.0
                    {
                        return Err(invalid());
                    }
                    let vertex = Vertex {
                        // The authoritative position is already projected. Restore
                        // its clip-space divisor so native rasterization interpolates
                        // UVs perspectively instead of treating the quad as affine.
                        position: [
                            ((2.0 * source.position[0] / f64::from(width) - 1.0) * source.w) as f32,
                            ((1.0 - 2.0 * source.position[1] / f64::from(height)) * source.w)
                                as f32,
                            0.0,
                            source.w as f32,
                        ],
                        uv: [source.uv[0] as f32, source.uv[1] as f32],
                        brightness: brightness as f32,
                        opacity: opacity as f32,
                    };
                    if !vertex
                        .position
                        .iter()
                        .chain(&vertex.uv)
                        .all(|v| v.is_finite())
                        || vertex.position[3] <= 0.0
                    {
                        return Err(invalid());
                    }
                    vertices.push(vertex);
                }
            }
            draws.push(Draw { input, vertices });
            continue;
        }
        let (input, opacity, transform, clip, brightness) = match command {
            Command::Image {
                input,
                opacity,
                transform,
                clip,
                replace: false,
                blend: Blend::SourceOver,
            } => (
                input,
                opacity,
                transform,
                clip.unwrap_or_else(|| Clip::Polygons {
                    points: vec![vec![
                        [0.0, 0.0],
                        [f64::from(width), 0.0],
                        [f64::from(width), f64::from(height)],
                        [0.0, f64::from(height)],
                    ]],
                }),
                1.0,
            ),
            Command::Surface {
                input,
                opacity,
                transform,
                clip,
                brightness,
            } => (input, opacity, transform, clip, brightness),
            _ => return Err(invalid()),
        };
        let Clip::Polygons { points } = clip else {
            return Err(invalid());
        };
        // Peel emits one convex flat quadrilateral or one authoritative surface triangle.
        if points.len() != 1 || !(3..=4).contains(&points[0].len()) {
            return Err(invalid());
        }
        if !transform
            .iter()
            .chain([&opacity, &brightness])
            .all(|v| v.is_finite())
            || !(0.0..=1.0).contains(&opacity)
            || !(0.0..=1.0).contains(&brightness)
        {
            return Err(invalid());
        }
        let polygon = &points[0];
        let mut vertices = Vec::with_capacity((polygon.len() - 2) * 3);
        for i in 1..polygon.len() - 1 {
            for source in [polygon[0], polygon[i], polygon[i + 1]] {
                if !source.iter().all(|v| v.is_finite()) {
                    return Err(invalid());
                }
                let x = transform[0] * source[0] + transform[2] * source[1] + transform[4];
                let y = transform[1] * source[0] + transform[3] * source[1] + transform[5];
                let vertex = Vertex {
                    position: [
                        (2.0 * x / f64::from(width) - 1.0) as f32,
                        (1.0 - 2.0 * y / f64::from(height)) as f32,
                        0.0,
                        1.0,
                    ],
                    uv: [
                        (source[0] / f64::from(width)) as f32,
                        (source[1] / f64::from(height)) as f32,
                    ],
                    brightness: brightness as f32,
                    opacity: opacity as f32,
                };
                if !vertex
                    .position
                    .iter()
                    .chain(&vertex.uv)
                    .all(|v| v.is_finite())
                {
                    return Err(invalid());
                }
                vertices.push(vertex);
            }
        }
        draws.push(Draw { input, vertices });
    }
    Ok(draws)
}

pub(super) struct PeelPipeline {
    triangles: wgpu::RenderPipeline,
    straight: wgpu::RenderPipeline,
}
impl PeelPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-peel-shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/peel.wgsl").into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("native-peel-layout"),
            bind_group_layouts: &[Some(context.texture_sampler_bind_group_layout())],
            immediate_size: 0,
        });
        let attributes =
            wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x2, 2 => Float32, 3 => Float32];
        let triangles = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-peel-triangles"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vertex_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attributes,
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fragment_premultiplied"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: context.texture_format(),
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let straight = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native-peel-straight"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vertex_fullscreen"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fragment_straight"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: context.texture_format(),
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        Self {
            triangles,
            straight,
        }
    }
    pub fn render(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        from: &wgpu::Texture,
        to: &wgpu::Texture,
        premultiplied: &wgpu::Texture,
        output: &wgpu::Texture,
        draws: &[Draw],
    ) {
        let binding = |texture: &wgpu::Texture| {
            let view = texture.create_view(&Default::default());
            context
                .device()
                .create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("native-peel-source"),
                    layout: context.texture_sampler_bind_group_layout(),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                        },
                    ],
                })
        };
        let sources = [binding(from), binding(to)];
        let buffers: Vec<_> = draws
            .iter()
            .map(|draw| {
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("native-peel-vertices"),
                        contents: bytemuck::cast_slice(&draw.vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    })
            })
            .collect();
        let view = premultiplied.create_view(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("native-peel-painter-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
            pass.set_pipeline(&self.triangles);
            for (draw, buffer) in draws.iter().zip(&buffers) {
                pass.set_bind_group(
                    0,
                    &sources[match draw.input {
                        Input::From => 0,
                        Input::To => 1,
                    }],
                    &[],
                );
                pass.set_vertex_buffer(0, buffer.slice(..));
                pass.draw(0..draw.vertices.len() as u32, 0..1);
            }
        }
        let premultiplied_binding = binding(premultiplied);
        let view = output.create_view(&Default::default());
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("native-peel-unpremultiply-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
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
        pass.set_pipeline(&self.straight);
        pass.set_bind_group(0, &premultiplied_binding, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authoritative_geometry_is_bounded_finite_and_maps_source_uv() {
        assert_eq!(std::mem::size_of::<Vertex>(), 32);
        for direction in ["left", "right", "up", "down"] {
            let style: NativeTransitionStyle = serde_json::from_value(serde_json::json!({"kind":"peel", "direction":direction, "curl":0.17,"segments":32,"shading":0.6,"perspective":0.5})).unwrap();
            for progress in [0.0, 0.1, 0.5, 0.9, 1.0] {
                let draws = geometry(&style, progress, 192, 128).unwrap();
                assert!(draws.len() <= style.work() as usize);
                assert!(
                    draws
                        .iter()
                        .all(|d| d.vertices.len() <= 6 && d.vertices.len() % 3 == 0)
                );
                assert!(
                    draws
                        .iter()
                        .flat_map(|d| &d.vertices)
                        .all(|v| v.position[3] == 1.0)
                );
                assert!(
                    draws
                        .iter()
                        .flat_map(|d| &d.vertices)
                        .all(|v| v.uv.iter().all(|x| (0.0..=1.0).contains(x)))
                );
            }
        }
    }

    #[test]
    fn bend_mesh_preserves_real_clip_w_and_uv_in_triangle_fan() {
        for direction in ["left", "right", "up", "down"] {
            let style: NativeTransitionStyle = serde_json::from_value(serde_json::json!({
                "kind":"bend","direction":direction,"hinge":0.5,
                "angle":std::f64::consts::PI,"perspective":0.8,"shading":0.5
            }))
            .unwrap();
            for progress in [0.1f32, 0.25, 0.75, 0.9] {
                let plan = style.plan(f64::from(progress), 192.0, 128.0).unwrap();
                let draws = geometry(&style, progress, 192, 128).unwrap();
                assert_eq!(plan.len(), draws.len());
                for (command, draw) in plan.iter().zip(&draws) {
                    if let Command::Mesh { vertices, .. } = command {
                        assert_eq!(draw.vertices.len(), 6);
                        assert!(draw.vertices.iter().any(|v| v.position[3] != 1.0));
                        for (actual, index) in draw.vertices.iter().zip([0, 1, 2, 0, 2, 3]) {
                            let source = &vertices[index];
                            assert_eq!(actual.position[3], source.w as f32);
                            assert_eq!(actual.uv, [source.uv[0] as f32, source.uv[1] as f32]);
                            assert_eq!(
                                actual.position[0],
                                ((2.0 * source.position[0] / 192.0 - 1.0) * source.w) as f32
                            );
                            assert_eq!(
                                actual.position[1],
                                ((1.0 - 2.0 * source.position[1] / 128.0) * source.w) as f32
                            );
                        }
                    } else {
                        assert!(draw.vertices.iter().all(|v| v.position[3] == 1.0));
                    }
                }
            }
            for progress in [0.0, 1.0] {
                let draws = geometry(&style, progress, 192, 128).unwrap();
                assert_eq!(draws.len(), 1);
                assert_eq!(draws[0].vertices.len(), 6);
                assert!(draws[0].vertices.iter().all(|v| v.position[3] == 1.0));
            }
        }
    }
}
