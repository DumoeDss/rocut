use super::{PreparedFrame, with_gpu_runtime, with_runtime_mut};
use crate::canvas_capture_readback::CanvasCaptureReadback;
use compositor::CanvasCaptureTicket;
use wasm_bindgen::JsValue;

/// Prefix submission and independent copy submission happen synchronously inside
/// one GPU/runtime borrow. Only the owned staging job leaves that scope; no pool
/// texture or encoder may survive into the caller's mapping await.
pub(super) fn capture_next(
    handle: u32,
    frame: &PreparedFrame,
) -> Result<Option<(CanvasCaptureTicket, CanvasCaptureReadback)>, JsValue> {
    with_gpu_runtime(|gpu| {
        with_runtime_mut(handle, |runtime| {
            let capture = runtime
                .compositor
                .capture_prepared_frame(&gpu.context, frame, |ticket, input| {
                    CanvasCaptureReadback::start(&gpu.context, input)
                        .map(|readback| (ticket, readback))
                })
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            capture.transpose()
        })
    })
}
