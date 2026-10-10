//! Dedicated lazy Canvas renderer. Upstream compositor must still establish the
//! ordered capture's owner/generation/request/source identity. This method binds
//! uploaded GPU source bytes to the immutable prepared bytes, not their provenance.
use gpu::GpuContext;

use super::{PreparedCanvasPass, gpu_pipeline::CanvasGpuPipeline};
use crate::{EffectPass, EffectPipeline, EffectsError};

/// Allocation-free dimension/device/format admission before first capture.
/// Concrete authored grid bounds remain a separate per-pass/payload admission;
/// this does not require a device to fit an unused hypothetical 128-cell grid.
pub fn validate_canvas_device_capture(
    [width, height]: [u32; 2],
    limits: &wgpu::Limits,
    format: wgpu::TextureFormat,
) -> Result<(), EffectsError> {
    let pixels = u64::from(width).checked_mul(u64::from(height));
    if width == 0 || height == 0 || width > 16384 || height > 16384
        || width > limits.max_texture_dimension_2d || height > limits.max_texture_dimension_2d
        || pixels.is_none_or(|v| v > super::raster::MAX_SOURCE_PIXELS)
        || limits.max_buffer_size < 64 || limits.max_uniform_buffer_binding_size < 64
        || limits.max_sampled_textures_per_shader_stage < 3 || limits.max_bind_groups < 2
        || limits.max_bindings_per_bind_group < 3 || limits.max_uniform_buffers_per_shader_stage < 1
        || limits.max_texture_array_layers < 1 || limits.max_vertex_buffers < 1
        || limits.max_vertex_attributes < 1 || limits.max_vertex_buffer_array_stride < 8
        || limits.max_inter_stage_shader_variables < 1 || limits.max_color_attachments < 1
        // wgpu29 charges RGBA8/BGRA8 render targets eight bytes/sample.
        || limits.max_color_attachment_bytes_per_sample < 8
        || !matches!(format, wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm)
    {
        return Err(EffectsError::CanvasPreparation {
            message: "Canvas capture device/dimensions/linear format invalid".into(),
        });
    }
    Ok(())
}

impl EffectPipeline {
    /// Does not alter ordinary EffectPipeline construction or unrelated effects.
    /// No external source texture is accepted; the exact prepared full-resolution
    /// capture bytes are uploaded to this call's private straight-sRGB texture.
    /// No compositor or runtime integration is claimed merely by this API existing.
    pub fn apply_canvas_prepared_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        pass: &EffectPass,
        prepared: &PreparedCanvasPass,
    ) -> Result<wgpu::Texture, EffectsError> {
        let dimensions = prepared.dimensions();
        if !prepared.matches(pass, dimensions) {
            return Err(EffectsError::CanvasPreparation {
                message: "Canvas renderer prepared/pass identity mismatch".into(),
            });
        }
        let [width, height] = dimensions;
        let row = CanvasGpuPipeline::validate_prepared_upload(
            width,
            height,
            prepared.payload(),
            prepared.source_rgba(),
            &context.device().limits(),
            context.texture_format(),
        )?;
        // All CPU input/device/format admission precedes every GPU allocation.
        let source = context.device().create_texture(&wgpu::TextureDescriptor {
            label: Some("canvas-owned-prepared-source"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            // Bytes are straight sRGB; shader explicitly decodes them. An sRGB
            // view would decode twice and is intentionally never created here.
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        context.queue().write_texture(
            source.as_image_copy(),
            prepared.source_rgba(),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(height),
            },
            source.size(),
        );
        // Creation is confined to this explicit method, not ordinary pipeline new.
        let canvas = CanvasGpuPipeline::new(context);
        canvas.apply_prepared(context, encoder, &source, width, height, prepared.payload())
    }
}

#[cfg(test)]
mod tests {
    use super::super::{CanvasRasterPayload, CanvasRasterUniforms};
    use super::*;

    #[test]
    fn upload_admission_checks_exact_source_and_limits_without_gpu() {
        let mut payload = CanvasRasterPayload {
            uniforms: CanvasRasterUniforms {
                geometry: [9, 8, 8, 8],
                material: [8.0, 0.02, 2.0, 0.0],
                light: [0.0, 0.0, 1.0, 0.0],
                metadata: [17, 0, 0, 0],
            },
            pigment_coverage: vec![[0.0; 4]; 64],
            height_wetness: vec![[0.0; 4]; 64],
        };
        let source = [0u8; 9 * 8 * 4];
        let limits = wgpu::Limits::default();
        let check = |p: &CanvasRasterPayload, s: &[u8], l: &wgpu::Limits, f| {
            CanvasGpuPipeline::validate_prepared_upload(9, 8, p, s, l, f)
        };
        assert_eq!(
            check(&payload, &source, &limits, wgpu::TextureFormat::Rgba8Unorm).unwrap(),
            36
        );
        assert!(
            validate_canvas_device_capture([9, 8], &limits, wgpu::TextureFormat::Bgra8Unorm)
                .is_ok()
        );
        assert!(
            validate_canvas_device_capture([0, 8], &limits, wgpu::TextureFormat::Rgba8Unorm)
                .is_err()
        );
        assert!(
            validate_canvas_device_capture(
                [16384, 16384],
                &limits,
                wgpu::TextureFormat::Rgba8Unorm
            )
            .is_err()
        );
        assert!(
            check(
                &payload,
                &source[..287],
                &limits,
                wgpu::TextureFormat::Rgba8Unorm
            )
            .is_err()
        );
        assert!(
            check(
                &payload,
                &source,
                &limits,
                wgpu::TextureFormat::Rgba8UnormSrgb
            )
            .is_err()
        );
        let mut limited = limits.clone();
        limited.max_uniform_buffer_binding_size = 63;
        assert!(check(&payload, &source, &limited, wgpu::TextureFormat::Rgba8Unorm).is_err());
        macro_rules! rejects_limit {
            ($field:ident, $low:expr) => {
                let mut limited = limits.clone();
                limited.$field = $low;
                assert!(
                    validate_canvas_device_capture(
                        [9, 8],
                        &limited,
                        wgpu::TextureFormat::Rgba8Unorm
                    )
                    .is_err(),
                    stringify!($field)
                );
                assert!(
                    check(&payload, &source, &limited, wgpu::TextureFormat::Rgba8Unorm).is_err(),
                    stringify!($field)
                );
            };
        }
        rejects_limit!(max_bindings_per_bind_group, 2);
        rejects_limit!(max_uniform_buffers_per_shader_stage, 0);
        rejects_limit!(max_texture_array_layers, 0);
        rejects_limit!(max_vertex_buffers, 0);
        rejects_limit!(max_vertex_attributes, 0);
        rejects_limit!(max_vertex_buffer_array_stride, 7);
        rejects_limit!(max_inter_stage_shader_variables, 0);
        rejects_limit!(max_color_attachments, 0);
        rejects_limit!(max_color_attachment_bytes_per_sample, 7);
        rejects_limit!(max_sampled_textures_per_shader_stage, 2);
        rejects_limit!(max_bind_groups, 1);
        rejects_limit!(max_buffer_size, 63);
        rejects_limit!(max_texture_dimension_2d, 8);
        payload.uniforms.light[0] = f32::NAN;
        assert!(check(&payload, &source, &limits, wgpu::TextureFormat::Rgba8Unorm).is_err());
    }
}
