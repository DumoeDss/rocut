//! Full immutable render-graph output, captured before display presentation.
use crate::{
    canvas_capture_readback::CanvasCaptureReadback, effects_readback_state::ReadbackLayout,
    gpu::with_gpu_runtime, native_output_png::OutputBudget,
};
use compositor::PreparedFrame;
use wasm_bindgen::JsValue;

pub(super) fn capture_frame(
    handle: u32,
    frame: PreparedFrame,
) -> Result<(CanvasCaptureReadback, u32, u32, &'static str, OutputBudget), JsValue> {
    let (width, height) = frame.dimensions();
    with_gpu_runtime(|gpu| {
        super::with_runtime_mut(handle, |runtime| {
            let limits = gpu.context.device().limits();
            let layout = ReadbackLayout::new(
                width,
                height,
                limits.max_texture_dimension_2d,
                limits.max_buffer_size,
            )
            .map_err(JsValue::from_str)?;
            // Output admission precedes graph GPU allocation and staging allocation.
            let budget = OutputBudget::for_frame(width, height, layout.buffer_size)
                .map_err(JsValue::from_str)?;
            // Exactly the ordinary graph traversal, including transforms, masks,
            // isolated groups, transitions, layer/scene/master effects and Canvas.
            let texture = runtime
                .compositor
                .render_prepared_frame_to_texture(&gpu.context, frame)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            let resident = runtime
                .compositor
                .resident_rgba_bytes()
                .ok_or_else(|| JsValue::from_str("Compositor resident memory overflow."))?;
            let budget = budget
                .with_resident_bytes(resident)
                .map_err(JsValue::from_str)?;
            // Copy/submission occur now, before the pooled final texture can recycle.
            // Only an independent staging job survives the runtime borrow below.
            let capture = CanvasCaptureReadback::start(&gpu.context, &texture)?;
            let backend = if gpu.context.adapter().get_info().backend == gpu::wgpu::Backend::Gl {
                "webgl"
            } else {
                "webgpu"
            };
            Ok((capture, width, height, backend, budget))
        })
    })
}
