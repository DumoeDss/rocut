//! Internal compositor capture of an already selected texture, without presentation.
//! Shared mapping and the dispose guard are available on production wasm32;
//! diagnostic exports remain separately gated. This module neither registers a
//! JS API nor proves owner/generation/request or source-content identity.
use gpu::{GpuContext, wgpu};
use std::{future::poll_fn, pin::Pin};
use wasm_bindgen::JsValue;

use crate::{
    effects_readback_state::{ReadbackGuard, ReadbackLayout},
    effects_readback_wait::MapWait,
};

#[path = "capture_buffer_retirement.rs"]
mod retirement;
use retirement::{CaptureBuffer, CaptureBufferResource};
impl CaptureBufferResource for wgpu::Buffer {
    fn destroy(&self) { wgpu::Buffer::destroy(self); }
}

pub(crate) struct CanvasCaptureReadback {
    buffer: CaptureBuffer<wgpu::Buffer>,
    device: wgpu::Device,
    layout: ReadbackLayout,
    bgra: bool,
    webgl: bool,
    // Kept through mapping and CPU unpack; serializes with diagnostic readback.
    // disposeGpu observes this shared guard on production wasm32 too.
    _guard: ReadbackGuard,
}

impl CanvasCaptureReadback {
    /// Synchronously copies/submits the supplied full texture. No GpuRuntime,
    /// RefCell borrow, encoder, or context reference survives this call.
    /// Caller selects the correct ordered compositor capture and owns cancellation
    /// identity checks. GPU texture metadata alone cannot establish byte identity.
    pub(crate) fn start(context: &GpuContext, texture: &wgpu::Texture) -> Result<Self, JsValue> {
        let bgra = match texture.format() {
            wgpu::TextureFormat::Rgba8Unorm => false,
            wgpu::TextureFormat::Bgra8Unorm => true,
            _ => {
                return Err(JsValue::from_str(
                    "Canvas capture requires linear RGBA8/BGRA8 storage.",
                ));
            }
        };
        if texture.dimension() != wgpu::TextureDimension::D2
            || texture.depth_or_array_layers() != 1
            || texture.sample_count() != 1
            || texture.mip_level_count() != 1
            || !texture.usage().contains(wgpu::TextureUsages::COPY_SRC)
        {
            return Err(JsValue::from_str(
                "Canvas capture requires a single-layer, single-sample D2 COPY_SRC texture.",
            ));
        }
        let limits = context.device().limits();
        // Existing layout performs checked row/stride/output byte arithmetic and
        // enforces max_dimension, max_buffer_size and the 64MiB padded budget.
        let layout = ReadbackLayout::new(
            texture.width(),
            texture.height(),
            limits.max_texture_dimension_2d,
            limits.max_buffer_size,
        )
        .map_err(JsValue::from_str)?;
        let guard = ReadbackGuard::acquire().map_err(JsValue::from_str)?;
        // All format, layout, usage, budget, and exclusivity checks precede GPU
        // allocation. No source view/sampler/presentation canvas is needed.
        let buffer = CaptureBuffer(context.device().create_buffer(&wgpu::BufferDescriptor {
            label: Some("canvas-capture-readback"),
            size: layout.buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        }));
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("canvas-capture-copy"),
                });
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
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
        Ok(Self {
            buffer,
            device: context.device().clone(),
            layout,
            bgra,
            webgl: context.adapter().get_info().backend == wgpu::Backend::Gl,
            _guard: guard,
        })
    }

    /// Owned async job only. MapWait uses browser callbacks/timers and nonblocking
    /// Poll for GL; its existing 10s/2500-poll timeout bounds the mapping wait.
    /// Returns Rust-owned RGBA bytes, not JS pixels. BGRA normalization is exactly
    /// one swap while unpacking; alpha and hidden RGB bytes are otherwise unchanged.
    pub(crate) async fn finish_rgba(
        self,
        mut is_current: impl FnMut() -> bool,
    ) -> Result<Vec<u8>, JsValue> {
        if !is_current() {
            return Err(cancelled());
        }
        let mut wait = MapWait::start(&self.device, &self.buffer.0, self.webgl)?;
        poll_fn(|context| {
            crate::capture_poll::poll_current(Pin::new(&mut wait), context, &mut is_current)
        })
        .await
        .map_err(|_| cancelled())??;
        drop(wait);
        if !is_current() {
            return Err(cancelled());
        }
        let rgba = {
            let mapped = self.buffer.0.slice(..).get_mapped_range();
            self.layout
                .unpack(&mapped, self.bgra)
                .map_err(JsValue::from_str)?
        };
        if !is_current() {
            return Err(cancelled());
        }
        Ok(rgba)
    }
}

fn cancelled() -> JsValue {
    let error = js_sys::Error::new("Canvas capture request is no longer current");
    error.set_name("AbortError");
    let _ = js_sys::Reflect::set(
        &error,
        &JsValue::from_str("code"),
        &JsValue::from_str("RENDER_CANCELLED"),
    );
    error.into()
}
