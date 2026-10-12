//! Production native straight output. No Canvas presentation or diagnostic feature ABI.
use super::{apply_effect_passes_to_texture, parse_apply_effect_passes_options};
use crate::{
    canvas_capture_readback::CanvasCaptureReadback,
    effects_readback_state::{ReadbackGuard, ReadbackLayout},
    gpu::{read_u32_property, with_gpu_runtime},
};
use js_sys::{Object, Promise, Reflect, Uint8Array};
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::future_to_promise;
#[path = "effects_output_state.rs"]
mod state;
use state::{OutputState, OutputTicket};
use crate::native_output_png as png;
type PreparedOutput = (
    PendingOutput,
    OutputTicket,
    CanvasCaptureReadback,
    u32,
    u32,
    &'static str,
    png::OutputBudget,
);

struct PendingOutput(Rc<RefCell<OutputState>>);
impl Drop for PendingOutput {
    fn drop(&mut self) {
        self.0.borrow_mut().finish();
    }
}

#[wasm_bindgen(typescript_custom_section)]
const OUTPUT_TYPES: &'static str = r#"
export interface BlazeOutputOptions { source: OffscreenCanvas; width: number; height: number; requestId: number; passes: {shader: 'blaze'; uniforms: {name: string; value: number[]}[]}[]; }
export interface NativeBlazeOutput { width: number; height: number; requestId: number; generation: number; peakBytes: number; format: 'rgba8unorm'; alphaMode: 'straight'; colorSpace: 'srgb'; backend: 'webgl' | 'webgpu'; }
export interface NativeBlazeRgba extends NativeBlazeOutput { rgba: Uint8Array; }
export interface NativeBlazePng extends NativeBlazeOutput { png: Uint8Array; mimeType: 'image/png'; }
"#;

#[wasm_bindgen]
pub struct BlazeOutputOwner {
    state: Rc<RefCell<OutputState>>,
}

#[wasm_bindgen]
impl BlazeOutputOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: Rc::new(RefCell::new(OutputState::default())),
        }
    }

    #[wasm_bindgen(js_name = render, unchecked_return_type = "Promise<NativeBlazeRgba>")]
    pub fn render(
        &self,
        #[wasm_bindgen(unchecked_param_type = "BlazeOutputOptions")] options: JsValue,
    ) -> Promise {
        finish_output(self.prepare(options), false)
    }
    #[wasm_bindgen(js_name = renderPng, unchecked_return_type = "Promise<NativeBlazePng>")]
    pub fn render_png(
        &self,
        #[wasm_bindgen(unchecked_param_type = "BlazeOutputOptions")] options: JsValue,
    ) -> Promise {
        finish_output(self.prepare(options), true)
    }
    pub fn cancel(&self) {
        self.state.borrow_mut().cancel();
    }
    pub fn dispose(&self) {
        self.state.borrow_mut().dispose();
    }
    pub fn pending(&self) -> bool {
        self.state.borrow().pending()
    }
}

fn finish_output(prepared: Result<PreparedOutput, JsValue>, encode_png: bool) -> Promise {
    future_to_promise(async move {
        let (pending, ticket, readback, width, height, backend, budget) = prepared?;
        let state = Rc::clone(&pending.0);
        let rgba = readback
            .finish_rgba(|| state.borrow().current(ticket))
            .await?;
        if !state.borrow().current(ticket) {
            return Err(cancelled());
        }
        let result = Object::new();
        for (name, value) in [
            ("width", width.into()),
            ("height", height.into()),
            ("requestId", ticket.request.into()),
            ("generation", ticket.generation.into()),
            ("format", JsValue::from_str("rgba8unorm")),
            ("alphaMode", JsValue::from_str("straight")),
            ("colorSpace", JsValue::from_str("srgb")),
            ("backend", JsValue::from_str(backend)),
            ("peakBytes", JsValue::from_f64(budget.peak_bytes as f64)),
        ] {
            Reflect::set(&result, &JsValue::from_str(name), &value)?;
        }
        if encode_png {
            let bytes = png::encode(width, height, &rgba, &budget).map_err(JsValue::from_str)?;
            Reflect::set(&result, &"png".into(), &Uint8Array::from(bytes.as_slice()))?;
            Reflect::set(&result, &"mimeType".into(), &JsValue::from_str("image/png"))?;
        } else {
            Reflect::set(&result, &"rgba".into(), &Uint8Array::from(rgba.as_slice()))?;
        }
        // Drop owns drain on success/error/cancel; no display canvas is returned.
        drop(pending);
        Ok(result.into())
    })
}

impl BlazeOutputOwner {
    fn prepare(&self, value: JsValue) -> Result<PreparedOutput, JsValue> {
        let object = Object::from(value.clone());
        let request = read_u32_property(&object, "requestId")?;
        let options = parse_apply_effect_passes_options(value)?;
        if options.passes.len() > 1 || options.passes.iter().any(|p| p.shader != "blaze") {
            return Err(JsValue::from_str(
                "Native Blaze output accepts only one Blaze pass or neutral bypass.",
            ));
        }
        let ticket = self
            .state
            .borrow_mut()
            .begin(request)
            .map_err(JsValue::from_str)?;
        let pending = PendingOutput(Rc::clone(&self.state));
        let (width, height) = (options.width, options.height);
        let (readback, backend, budget) = with_gpu_runtime(|runtime| {
            if ReadbackGuard::is_active() {
                return Err(JsValue::from_str("Another GPU readback must drain first."));
            }
            let limits = runtime.context.device().limits();
            // Preflight checked dimensions, padded64MiB staging/output budget before effects allocation.
            let layout = ReadbackLayout::new(
                width,
                height,
                limits.max_texture_dimension_2d,
                limits.max_buffer_size,
            )
            .map_err(JsValue::from_str)?;
            let budget = png::OutputBudget::new(width, height, layout.buffer_size)
                .map_err(JsValue::from_str)?;
            let texture = apply_effect_passes_to_texture(runtime, options)?;
            let backend = if runtime.context.adapter().get_info().backend == gpu::wgpu::Backend::Gl
            {
                "webgl"
            } else {
                "webgpu"
            };
            Ok((
                CanvasCaptureReadback::start(&runtime.context, &texture)?,
                backend,
                budget,
            ))
        })?;
        Ok((pending, ticket, readback, width, height, backend, budget))
    }
}
impl Default for BlazeOutputOwner {
    fn default() -> Self {
        Self::new()
    }
}
impl Drop for BlazeOutputOwner {
    fn drop(&mut self) {
        self.state.borrow_mut().dispose();
    }
}
fn cancelled() -> JsValue {
    let error = js_sys::Error::new("Native Blaze output is stale or cancelled");
    error.set_name("AbortError");
    error.into()
}
