use gpu::wgpu;
use js_sys::{Object, Promise, Uint8Array};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::future_to_promise;

use crate::{
    effects::{
        EffectPassInput, apply_mapped_effect_passes, map_effect_passes,
        validate_mapped_effect_passes,
    },
    effects_readback::{ReadbackJob, linear_texture_bgra, prepare_texture_readback},
    effects_readback_state::{ReadbackGuard, ReadbackLayout},
    effects_rgba_layout::{RgbaUploadLayout, encode_upload_channels},
    gpu::{read_property, read_serde_property, read_u32_property, with_gpu_runtime},
};

#[wasm_bindgen(
    js_name = applyEffectPassesRgbaReadback,
    unchecked_return_type = "Promise<{ rgba: Uint8Array; width: number; height: number; canvas: OffscreenCanvas; format: 'rgba8unorm' | 'bgra8unorm'; backend: 'webgl' | 'webgpu' }>"
)]
pub fn apply_effect_passes_rgba_readback(options: JsValue) -> Promise {
    // Acquire and prepare synchronously, before disposal or another call can run.
    let prepared = prepare(options);
    future_to_promise(async move {
        let (_guard, job) = prepared?;
        job.finish().await
    })
}

fn prepare(options: JsValue) -> Result<(ReadbackGuard, ReadbackJob), JsValue> {
    let guard = ReadbackGuard::acquire().map_err(JsValue::from_str)?;
    let object: Object = options.dyn_into().map_err(|_| {
        JsValue::from_str("applyEffectPassesRgbaReadback expects an options object")
    })?;
    let rgba: Uint8Array = read_property(&object, "rgba")?
        .dyn_into()
        .map_err(|_| JsValue::from_str("Property 'rgba' must be a Uint8Array"))?;
    let width = read_u32_property(&object, "width")?;
    let height = read_u32_property(&object, "height")?;
    let passes: Vec<EffectPassInput> = read_serde_property(&object, "passes")?;
    let upload = RgbaUploadLayout::new(width, height, u64::from(rgba.length()))
        .map_err(JsValue::from_str)?;
    let passes = map_effect_passes(passes);
    let job = with_gpu_runtime(|runtime| {
        let context = &runtime.context;
        let limits = context.device().limits();
        let layout = ReadbackLayout::new(
            width,
            height,
            limits.max_texture_dimension_2d,
            limits.max_buffer_size,
        )
        .map_err(JsValue::from_str)?;
        let bgra = linear_texture_bgra(context.texture_format())?;
        validate_mapped_effect_passes(runtime, width, height, &passes)?;
        // No CPU pixel copy or GPU allocation until every preflight above passes.
        let mut bytes = rgba.to_vec();
        encode_upload_channels(&mut bytes, bgra);
        let source = context.create_render_texture(width, height, "diagnostic-raw-rgba-input");
        context.queue().write_texture(
            source.as_image_copy(),
            &bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(upload.row_bytes),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        let output = apply_mapped_effect_passes(runtime, &source, width, height, &passes)?;
        // The shared job copies raw output before presenting a separate canvas.
        prepare_texture_readback(runtime, &output, layout)
    })?;
    Ok((guard, job))
}
