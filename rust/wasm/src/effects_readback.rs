use gpu::wgpu;
use js_sys::{Object, Promise, Reflect, Uint8Array};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::future_to_promise;

use crate::{
    effects::{apply_effect_passes_to_texture, parse_apply_effect_passes_options},
    effects_readback_state::{ReadbackGuard, ReadbackLayout},
    effects_readback_wait::MapWait,
    gpu::{render_texture_to_canvas, with_gpu_runtime},
};

struct ReadbackBuffer(wgpu::Buffer);

impl Drop for ReadbackBuffer {
    fn drop(&mut self) {
        self.0.unmap();
        self.0.destroy();
    }
}

struct ReadbackJob {
    buffer: ReadbackBuffer,
    device: wgpu::Device,
    layout: ReadbackLayout,
    bgra: bool,
    webgl: bool,
    canvas: wgpu::web_sys::OffscreenCanvas,
}

impl ReadbackJob {
    async fn finish(self) -> Result<JsValue, JsValue> {
        MapWait::start(&self.device, &self.buffer.0, self.webgl)?.await?;
        let rgba = {
            let mapped = self.buffer.0.slice(..).get_mapped_range();
            self.layout
                .unpack(&mapped, self.bgra)
                .map_err(JsValue::from_str)?
        };
        let result = Object::new();
        Reflect::set(&result, &"rgba".into(), &Uint8Array::from(rgba.as_slice()))?;
        Reflect::set(&result, &"width".into(), &self.layout.width.into())?;
        Reflect::set(&result, &"height".into(), &self.layout.height.into())?;
        Reflect::set(&result, &"canvas".into(), &self.canvas)?;
        Reflect::set(
            &result,
            &"format".into(),
            &JsValue::from_str(if self.bgra {
                "bgra8unorm"
            } else {
                "rgba8unorm"
            }),
        )?;
        Reflect::set(
            &result,
            &"backend".into(),
            &JsValue::from_str(if self.webgl { "webgl" } else { "webgpu" }),
        )?;
        Ok(result.into())
    }
}

#[wasm_bindgen(
    js_name = applyEffectPassesReadback,
    unchecked_return_type = "Promise<{ rgba: Uint8Array; width: number; height: number; canvas: OffscreenCanvas; format: 'rgba8unorm' | 'bgra8unorm'; backend: 'webgl' | 'webgpu' }>"
)]
pub fn apply_effect_passes_readback(options: JsValue) -> Promise {
    // Preparation is synchronous, so disposeGpu cannot slip ahead of the pending guard.
    let prepared = prepare(options);
    future_to_promise(async move {
        let (_guard, job) = prepared?;
        job.finish().await
    })
}

fn prepare(options: JsValue) -> Result<(ReadbackGuard, ReadbackJob), JsValue> {
    let guard = ReadbackGuard::acquire().map_err(JsValue::from_str)?;
    let options = parse_apply_effect_passes_options(options)?;
    let job = with_gpu_runtime(|runtime| {
        let context = &runtime.context;
        let limits = context.device().limits();
        let layout = ReadbackLayout::new(
            options.width,
            options.height,
            limits.max_texture_dimension_2d,
            limits.max_buffer_size,
        )
        .map_err(JsValue::from_str)?;
        let output = apply_effect_passes_to_texture(runtime, options)?;
        let bgra = match output.format() {
            wgpu::TextureFormat::Rgba8Unorm => false,
            wgpu::TextureFormat::Bgra8Unorm => true,
            _ => {
                return Err(JsValue::from_str(
                    "Diagnostic readback requires linear RGBA8/BGRA8.",
                ));
            }
        };
        let buffer = ReadbackBuffer(context.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("diagnostic-effect-readback"),
            size: layout.buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        }));
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("diagnostic-effect-readback-copy"),
                });
        encoder.copy_texture_to_buffer(
            output.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer.0,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(layout.stride),
                    rows_per_image: Some(layout.height),
                },
            },
            wgpu::Extent3d {
                width: layout.width,
                height: layout.height,
                depth_or_array_layers: 1,
            },
        );
        context.queue().submit([encoder.finish()]);
        let canvas = render_texture_to_canvas(context, &output, layout.width, layout.height)?;
        Ok(ReadbackJob {
            buffer,
            device: context.device().clone(),
            layout,
            bgra,
            webgl: context.adapter().get_info().backend == wgpu::Backend::Gl,
            canvas,
        })
    })?;
    Ok((guard, job))
}
