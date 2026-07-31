#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use effects::EffectPipeline;
use gpu::{GpuContext, wgpu};
use js_sys::{Array, Object, Reflect};
use masks::MaskFeatherPipeline;
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::compositor::{dispose_compositor, live_compositor_handles, reset_compositor_registry};
use crate::runtime_state::{
    InitializationAction, InitializationEpoch, RuntimeGraphicsState, SelectedBackend,
};

pub(crate) struct GpuRuntime {
    pub(crate) context: GpuContext,
    pub(crate) effects: EffectPipeline,
    pub(crate) masks: MaskFeatherPipeline,
}

#[derive(Default)]
struct InitializationWaitState {
    result: Option<Result<(), String>>,
    waker: Option<Waker>,
}

struct InitializationWait {
    state: Rc<RefCell<InitializationWaitState>>,
}

impl Future for InitializationWait {
    type Output = Result<(), String>;

    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.state.borrow_mut();
        if let Some(result) = state.result.take() {
            return Poll::Ready(result);
        }
        state.waker = Some(context.waker().clone());
        Poll::Pending
    }
}

struct InitializationWaiter {
    generation: u64,
    state: Rc<RefCell<InitializationWaitState>>,
}

#[derive(Default)]
struct GpuLifecycle {
    epoch: InitializationEpoch,
    waiters: Vec<InitializationWaiter>,
}

thread_local! {
    static GPU_RUNTIME: RefCell<Option<GpuRuntime>> = const { RefCell::new(None) };
    static GRAPHICS_STATE: RefCell<RuntimeGraphicsState> =
        RefCell::new(RuntimeGraphicsState::default());
    static GPU_LIFECYCLE: RefCell<GpuLifecycle> = RefCell::new(GpuLifecycle::default());
}

enum BeginInitialization {
    Ready,
    Start(u64),
    Wait(InitializationWait),
}

fn begin_initialization() -> Result<BeginInitialization, JsValue> {
    if GPU_RUNTIME.with(|runtime| runtime.borrow().is_some()) {
        return Ok(BeginInitialization::Ready);
    }

    GPU_LIFECYCLE.with(|lifecycle| {
        let mut lifecycle = lifecycle.borrow_mut();
        match lifecycle.epoch.begin().map_err(JsValue::from_str)? {
            InitializationAction::Start(generation) => Ok(BeginInitialization::Start(generation)),
            InitializationAction::Join(generation) => {
                let state = Rc::new(RefCell::new(InitializationWaitState::default()));
                lifecycle.waiters.push(InitializationWaiter {
                    generation,
                    state: Rc::clone(&state),
                });
                Ok(BeginInitialization::Wait(InitializationWait { state }))
            }
        }
    })
}

fn is_current_initialization(generation: u64) -> bool {
    GPU_LIFECYCLE.with(|lifecycle| lifecycle.borrow().epoch.is_current(generation))
}

fn settle_initialization(generation: u64, result: Result<(), String>) -> bool {
    let waiters = GPU_LIFECYCLE.with(|lifecycle| {
        let mut lifecycle = lifecycle.borrow_mut();
        if !lifecycle.epoch.finish(generation) {
            return None;
        }

        let mut matched = Vec::new();
        let mut retained = Vec::new();
        for waiter in lifecycle.waiters.drain(..) {
            if waiter.generation == generation {
                matched.push(waiter);
            } else {
                retained.push(waiter);
            }
        }
        lifecycle.waiters = retained;
        Some(matched)
    });

    let Some(waiters) = waiters else {
        return false;
    };
    for waiter in waiters {
        let waker = {
            let mut state = waiter.state.borrow_mut();
            state.result = Some(result.clone());
            state.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
    true
}

fn cancel_initialization(reason: &str) {
    let waiters = GPU_LIFECYCLE.with(|lifecycle| {
        let mut lifecycle = lifecycle.borrow_mut();
        lifecycle.epoch.cancel();
        lifecycle.waiters.drain(..).collect::<Vec<_>>()
    });
    for waiter in waiters {
        let waker = {
            let mut state = waiter.state.borrow_mut();
            state.result = Some(Err(reason.to_owned()));
            state.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

fn set_panic_hook() {
    static SET_HOOK: std::sync::Once = std::sync::Once::new();
    SET_HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            // Store the full panic message in window.__wasmPanic so the JS catch block
            // can surface it instead of the opaque "Unreachable" WASM trap message.
            if let Some(window) = web_sys::window() {
                let _ = Reflect::set(
                    &window,
                    &JsValue::from_str("__wasmPanic"),
                    &JsValue::from_str(&info.to_string()),
                );
            }
            console_error_panic_hook::hook(info);
        }));
    });
}

#[wasm_bindgen(js_name = initializeGpu)]
pub async fn initialize_gpu() -> Result<(), JsValue> {
    set_panic_hook();

    let generation = match begin_initialization()? {
        BeginInitialization::Ready => return Ok(()),
        BeginInitialization::Wait(wait) => {
            return wait.await.map_err(|reason| JsValue::from_str(&reason));
        }
        BeginInitialization::Start(generation) => generation,
    };

    let context = match GpuContext::new().await {
        Ok(context) => context,
        Err(error) => {
            let reason = error.to_string();
            if is_current_initialization(generation) {
                GRAPHICS_STATE.with(|state| {
                    state.borrow_mut().mark_unavailable(reason.clone());
                });
                settle_initialization(generation, Err(reason.clone()));
                return Err(JsValue::from_str(&reason));
            }
            return Err(JsValue::from_str(
                "GPU initialization was cancelled before it completed.",
            ));
        }
    };
    if !is_current_initialization(generation) {
        return Err(JsValue::from_str(
            "GPU initialization was cancelled before it completed.",
        ));
    }
    let selected_backend = if context.adapter().get_info().backend == wgpu::Backend::Gl {
        SelectedBackend::WebGl
    } else {
        SelectedBackend::WebGpu
    };
    let effects = EffectPipeline::new(&context);
    let masks = MaskFeatherPipeline::new(&context);

    GPU_RUNTIME.with(|runtime| {
        runtime.replace(Some(GpuRuntime {
            context,
            effects,
            masks,
        }));
    });
    GRAPHICS_STATE.with(|state| state.borrow_mut().select(selected_backend));
    settle_initialization(generation, Ok(()));

    Ok(())
}

pub(crate) fn selected_backend() -> Option<SelectedBackend> {
    GRAPHICS_STATE.with(|state| state.borrow().selected_backend())
}

pub(crate) fn compositor_capacity() -> usize {
    GRAPHICS_STATE.with(|state| state.borrow().compositor_capacity())
}

pub(crate) fn unavailable_reason() -> String {
    GRAPHICS_STATE.with(|state| state.borrow().unavailable_reason().to_owned())
}

#[wasm_bindgen(js_name = disposeGpu)]
pub fn dispose_gpu() -> Result<(), JsValue> {
    let handles = live_compositor_handles();
    if !handles.is_empty() {
        return Err(JsValue::from_str(&format!(
            "Cannot dispose GPU while compositor handles are live: {handles:?}"
        )));
    }

    GPU_RUNTIME.with(|runtime| {
        runtime.replace(None);
    });
    reset_compositor_registry();
    GRAPHICS_STATE.with(|state| {
        state
            .borrow_mut()
            .mark_unavailable("GPU runtime was disposed.");
    });
    cancel_initialization("GPU initialization was cancelled by disposeGpu().");
    Ok(())
}

#[wasm_bindgen]
pub struct WasmRuntimeGraphicsQuery;

#[wasm_bindgen]
impl WasmRuntimeGraphicsQuery {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen(
        js_name = selectedBackend,
        unchecked_return_type = "\"webgl\" | \"webgpu\" | null"
    )]
    pub fn selected_backend(&self) -> JsValue {
        match selected_backend() {
            Some(backend) => JsValue::from_str(backend.as_str()),
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(js_name = concurrentCompositorInstances)]
    pub fn concurrent_compositor_instances(&self) -> u32 {
        compositor_capacity() as u32
    }

    #[wasm_bindgen(js_name = unavailableReason)]
    pub fn unavailable_reason(&self) -> String {
        unavailable_reason()
    }
}

impl Default for WasmRuntimeGraphicsQuery {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct WasmRuntimeGpuResourceQuery;

#[wasm_bindgen]
impl WasmRuntimeGpuResourceQuery {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen(
        js_name = liveHandles,
        unchecked_return_type = "readonly number[]"
    )]
    pub fn live_handles(&self) -> Array {
        live_compositor_handles()
            .into_iter()
            .map(JsValue::from)
            .collect()
    }

    #[wasm_bindgen(js_name = release)]
    pub fn release(
        &self,
        #[wasm_bindgen(unchecked_param_type = "{ handle: number }")] input: JsValue,
    ) -> Result<(), JsValue> {
        let object: Object = input.dyn_into().map_err(|_| {
            JsValue::from_str("WasmRuntimeGpuResourceQuery.release expects { handle: number }")
        })?;
        dispose_compositor(read_u32_property(&object, "handle")?)
    }
}

impl Default for WasmRuntimeGpuResourceQuery {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn with_gpu_runtime<T>(
    action: impl FnOnce(&GpuRuntime) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    GPU_RUNTIME.with(|runtime| {
        let borrow = runtime.borrow();
        let Some(gpu_runtime) = borrow.as_ref() else {
            return Err(JsValue::from_str(
                "GPU context not initialized. Call initializeGpu() first.",
            ));
        };
        action(gpu_runtime)
    })
}

pub(crate) fn import_canvas_texture(
    context: &GpuContext,
    canvas: &wgpu::web_sys::OffscreenCanvas,
    width: u32,
    height: u32,
    label: &'static str,
) -> wgpu::Texture {
    context.import_offscreen_canvas_texture(canvas, width, height, label)
}

pub(crate) fn render_texture_to_canvas(
    context: &GpuContext,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let canvas = wgpu::web_sys::OffscreenCanvas::new(width, height)?;
    context
        .render_texture_to_offscreen_canvas(texture, &canvas, width, height)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(canvas)
}

pub(crate) fn read_property(object: &Object, name: &str) -> Result<JsValue, JsValue> {
    Reflect::get(object, &JsValue::from_str(name))
        .map_err(|_| JsValue::from_str(&format!("Missing property '{name}'")))
}

pub(crate) fn read_offscreen_canvas_property(
    object: &Object,
    name: &str,
) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    read_property(object, name)?
        .dyn_into::<wgpu::web_sys::OffscreenCanvas>()
        .map_err(|_| JsValue::from_str(&format!("Property '{name}' must be an OffscreenCanvas")))
}

pub(crate) fn read_u32_property(object: &Object, name: &str) -> Result<u32, JsValue> {
    let value = read_property(object, name)?;
    let Some(number) = value.as_f64() else {
        return Err(JsValue::from_str(&format!(
            "Property '{name}' must be a number"
        )));
    };
    if !number.is_finite() || number.fract() != 0.0 || number < 0.0 || number > u32::MAX as f64 {
        return Err(JsValue::from_str(&format!(
            "Property '{name}' must be an unsigned 32-bit integer"
        )));
    }
    Ok(number as u32)
}

pub(crate) fn read_f32_property(object: &Object, name: &str) -> Result<f32, JsValue> {
    let value = read_property(object, name)?;
    let Some(number) = value.as_f64() else {
        return Err(JsValue::from_str(&format!(
            "Property '{name}' must be a number"
        )));
    };
    Ok(number as f32)
}

pub(crate) fn read_serde_property<T>(object: &Object, name: &str) -> Result<T, JsValue>
where
    T: for<'de> Deserialize<'de>,
{
    let value = read_property(object, name)?;
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("Invalid property '{name}': {error}")))
}
