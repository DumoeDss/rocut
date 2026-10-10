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

fn is_current(handle: u32, request: u32, owner: (u64, u64)) -> bool {
    identity(handle).is_ok_and(|current| current == owner)
        && REQUESTS.with(|requests| {
            requests
                .borrow()
                .is_in_flight(handle, request, owner.0, owner.1)
        })
}

async fn advance_preparation(
    handle: u32,
    request: u32,
    owner: (u64, u64),
    preparation: Preparation,
    max_steps: u32,
) -> Result<(Preparation, bool), JsValue> {
    if !is_current(handle, request, owner) {
        return Err(cancelled());
    }
    let mut frame = match preparation {
        Preparation::Ready(frame) => frame,
        Preparation::Pending(mut pending) => {
            let quota = NonZeroU64::new(u64::from(max_steps)).unwrap();
            if !pending.advance(quota).map_err(preparation_error)? {
                return Ok((Preparation::Pending(pending), false));
            }
            pending.finish().map_err(preparation_error)?
        }
    };
    if frame.canvas_ready() {
        frame.finalize_canvas().map_err(preparation_error)?;
        return Ok((Preparation::Ready(frame), true));
    }
    if let Some(minimum) = frame.canvas_minimum_step_work() {
        let work = minimum
            .get()
            .checked_mul(u64::from(max_steps))
            .and_then(NonZeroU64::new)
            .ok_or_else(|| error("RENDER_FAILED", "Canvas chunk quota overflow"))?;
        // Exactly one bounded CPU chunk, not an entire graph loop.
        let ready = frame.advance_canvas(work).map_err(preparation_error)?;
        if ready {
            frame.finalize_canvas().map_err(preparation_error)?;
        }
        return Ok((Preparation::Ready(frame), ready));
    }
    if !is_current(handle, request, owner) {
        return Err(cancelled());
    }
    let capture = super::capture_next(handle, &frame)?;
    if !is_current(handle, request, owner) {
        return Err(cancelled());
    }
    match capture {
        Some((ticket, readback)) => {
            // Borrow-free await; the real reservation/owner/generation predicate
            // is checked by readback before/after each MapWait poll and unpack.
            let rgba = readback
                .finish_rgba(|| is_current(handle, request, owner))
                .await?;
            if !is_current(handle, request, owner) {
                return Err(cancelled());
            }
            frame
                .begin_canvas_preparation(ticket, rgba)
                .map_err(preparation_error)?;
            Ok((Preparation::Ready(frame), false))
        }
        None => {
            frame.finalize_canvas().map_err(preparation_error)?;
            Ok((Preparation::Ready(frame), true))
        }
    }
}

#[wasm_bindgen(js_name = beginRenderFrameForHandle)]
pub fn begin_render_frame_for_handle(handle: u32, options: JsValue) -> Result<u32, JsValue> {
    // Invalidate before parsing too: an invalid newer frame must not publish the old one.
    super::invalidate_runtime(handle)?;
    let owner = identity(handle)?;
    super::frame_preflight::validate(&options).map_err(|value| {
        error(
            "RENDER_FAILED",
            &format!("Invalid frame descriptor: {value}"),
        )
    })?;
    let frame: FrameDescriptor = serde_wasm_bindgen::from_value(options).map_err(|value| {
        error(
            "RENDER_FAILED",
            &format!("Invalid frame descriptor: {value}"),
        )
    })?;
    let preparation =
        FramePreparation::new(frame).map_err(|value| error("RENDER_FAILED", &value.to_string()))?;
    REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .begin(handle, owner.0, owner.1, Preparation::Pending(preparation))
            .map_err(request_error)
    })
}

#[wasm_bindgen(js_name = advanceRenderFrameForHandle)]
pub async fn advance_render_frame_for_handle(
    handle: u32,
    request: u32,
    max_steps: u32,
) -> Result<bool, JsValue> {
    let owner = identity(handle)?;
    // Take the payload, retaining its in-flight identity. No RefCell/runtime/GPU
    // borrow crosses replay, and late restore cannot replace a newer request.
    let preparation = REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .take(handle, request, owner.0, owner.1)
            .map_err(request_error)
    })?;
    if !(1..=64).contains(&max_steps) {
        REQUESTS.with(|requests| requests.borrow_mut().cancel(handle, request));
        return Err(error(
            "RENDER_FAILED",
            "Step quota must be between 1 and 64",
        ));
    }
    let result = advance_preparation(handle, request, owner, preparation, max_steps).await;
    let (preparation, ready) = match result {
        Ok(next) => next,
        Err(error) => {
            REQUESTS.with(|requests| requests.borrow_mut().cancel(handle, request));
            return Err(error);
        }
    };
    if !is_current(handle, request, owner) {
        REQUESTS.with(|requests| requests.borrow_mut().cancel(handle, request));
        return Err(cancelled());
    }
    REQUESTS
        .with(|requests| {
            requests
                .borrow_mut()
                .restore(handle, request, owner.0, owner.1, preparation)
        })
        .map_err(request_error)?;
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
    REQUESTS.with(|requests| {
        requests
            .borrow_mut()
            .finish(handle, request, owner.0, owner.1)
            .map_err(request_error)
    })?;
    let Preparation::Ready(frame) = preparation else {
        // Invalid commit is terminal, never retains a partially prepared frame.
        return Err(error(
            "RENDER_NOT_READY",
            "Render request has not completed CPU preparation",
        ));
    };
    frame.finalize_canvas().map_err(preparation_error)?;
    // Last cancellation/owner check is above. Synchronous GPU commit is not retractable.
    crate::perf::reset();
    super::render_prepared(handle, frame)
        .map_err(|value| error("RENDER_FAILED", &format!("GPU commit failed: {value:?}")))
}

#[wasm_bindgen(js_name = cancelRenderFrameForHandle)]
pub fn cancel_render_frame_for_handle(handle: u32, request: u32) {
    REQUESTS.with(|requests| requests.borrow_mut().cancel(handle, request));
}
