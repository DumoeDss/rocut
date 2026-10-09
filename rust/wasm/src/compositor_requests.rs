use std::cell::RefCell;
use std::num::NonZeroU64;

use compositor::{FrameDescriptor, FramePreparation, PreparedFrame};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::render_requests::{RenderRequests, RequestError};

enum Preparation {
    Pending(FramePreparation),
    Ready(PreparedFrame),
}

thread_local! {
    static REQUESTS: RefCell<RenderRequests<Preparation>> = RefCell::new(RenderRequests::default());
}

fn error(code: &str, message: &str) -> JsValue {
    let error = js_sys::Error::new(message);
    error.set_name(if code == "RENDER_CANCELLED" {
        "AbortError"
    } else {
        "RenderFrameError"
    });
    let _ = js_sys::Reflect::set(&error, &JsValue::from_str("code"), &JsValue::from_str(code));
    error.into()
}

fn cancelled() -> JsValue {
    error("RENDER_CANCELLED", "Render request is no longer current")
}

fn request_error(value: RequestError) -> JsValue {
    match value {
        RequestError::Cancelled => cancelled(),
        RequestError::Exhausted => {
            error("RENDER_FAILED", "Render request identity space exhausted")
        }
    }
}

fn preparation_error(value: effects::EffectsError) -> JsValue {
    if matches!(value, effects::EffectsError::Cancelled) {
        cancelled()
    } else {
        error("RENDER_FAILED", &value.to_string())
    }
}

pub(super) fn new_owner() -> Result<u64, JsValue> {
    REQUESTS.with(|requests| requests.borrow_mut().new_owner().map_err(request_error))
}

pub(super) fn invalidate(handle: u32) {
    REQUESTS.with(|requests| requests.borrow_mut().invalidate(handle));
}

pub(super) fn reset() {
    REQUESTS.with(|requests| requests.borrow_mut().clear());
}

fn identity(handle: u32) -> Result<(u64, u64), JsValue> {
    super::with_runtime(handle, |runtime| Ok((runtime.owner, runtime.generation)))
        .map_err(|_| cancelled())
}

#[wasm_bindgen(js_name = beginRenderFrameForHandle)]
pub fn begin_render_frame_for_handle(handle: u32, options: JsValue) -> Result<u32, JsValue> {
    // Invalidate before parsing too: an invalid newer frame must not publish the old one.
    super::invalidate_runtime(handle)?;
    let owner = identity(handle)?;
    super::frame_preflight::validate(&options).map_err(|value| {
        error("RENDER_FAILED", &format!("Invalid frame descriptor: {value}"))
    })?;
    let frame: FrameDescriptor = serde_wasm_bindgen::from_value(options).map_err(|value| {
        error(
            "RENDER_FAILED",
            &format!("Invalid frame descriptor: {value}"),
        )
    })?;
    let preparation = FramePreparation::new(frame)
        .map_err(|value| error("RENDER_FAILED", &value.to_string()))?;
    REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .begin(handle, owner.0, owner.1, Preparation::Pending(preparation))
            .map_err(request_error)
    })
}

#[wasm_bindgen(js_name = advanceRenderFrameForHandle)]
pub fn advance_render_frame_for_handle(
    handle: u32,
    request: u32,
    max_steps: u32,
) -> Result<bool, JsValue> {
    let owner = identity(handle)?;
    // Remove while doing CPU work: no RefCell/runtime/GPU borrow crosses replay.
    let preparation = REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .take(handle, request, owner.0, owner.1)
            .map_err(request_error)
    })?;
    if !(1..=64).contains(&max_steps) {
        return Err(error(
            "RENDER_FAILED",
            "Step quota must be between 1 and 64",
        ));
    }
    let quota = NonZeroU64::new(u64::from(max_steps)).unwrap();
    let (preparation, ready) = match preparation {
        Preparation::Ready(frame) => (Preparation::Ready(frame), true),
        Preparation::Pending(mut pending) => {
            if pending.advance(quota).map_err(preparation_error)? {
                (
                    Preparation::Ready(pending.finish().map_err(preparation_error)?),
                    true,
                )
            } else {
                (Preparation::Pending(pending), false)
            }
        }
    };
    REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .restore(handle, request, owner.0, owner.1, preparation)
    });
    Ok(ready)
}

#[wasm_bindgen(js_name = commitRenderFrameForHandle)]
pub fn commit_render_frame_for_handle(handle: u32, request: u32) -> Result<(), JsValue> {
    let owner = identity(handle)?;
    let preparation = REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .take(handle, request, owner.0, owner.1)
            .map_err(request_error)
    })?;
    let Preparation::Ready(frame) = preparation else {
        // Invalid commit is terminal, never retains a partially prepared frame.
        return Err(error(
            "RENDER_NOT_READY",
            "Render request has not completed CPU preparation",
        ));
    };
    // Last cancellation/owner check is above. Synchronous GPU commit is not retractable.
    crate::perf::reset();
    super::render_prepared(handle, frame)
        .map_err(|value| error("RENDER_FAILED", &format!("GPU commit failed: {value:?}")))
}

#[wasm_bindgen(js_name = cancelRenderFrameForHandle)]
pub fn cancel_render_frame_for_handle(handle: u32, request: u32) {
    REQUESTS.with(|requests| requests.borrow_mut().cancel(handle, request));
}
