#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;

use compositor::{Compositor, FrameDescriptor, RenderFrameOptions};
use gpu::wgpu;
use js_sys::Object;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::gpu::{
    compositor_capacity, import_canvas_texture, read_offscreen_canvas_property,
    read_serde_property, read_u32_property, with_gpu_runtime,
};
use crate::perf;
use crate::runtime_state::{DEFAULT_COMPOSITOR_HANDLE, HandleRegistry, HandleRegistryError};

struct CompositorRuntime {
    canvas: web_sys::HtmlCanvasElement,
    compositor: Compositor,
    surface: wgpu::Surface<'static>,
    surface_size: (u32, u32),
}

thread_local! {
    static COMPOSITOR_RUNTIMES: RefCell<HandleRegistry<Rc<RefCell<CompositorRuntime>>>> =
        RefCell::new(HandleRegistry::default());
}

fn registry_error(error: HandleRegistryError) -> JsValue {
    match error {
        HandleRegistryError::CapacityExceeded { capacity } if capacity == 0 => {
            JsValue::from_str("No GPU backend is selected. Call initializeGpu() first.")
        }
        HandleRegistryError::CapacityExceeded { capacity } => JsValue::from_str(&format!(
            "Compositor capacity {capacity} has been reached for the selected GPU backend."
        )),
        HandleRegistryError::Exhausted => {
            JsValue::from_str("Compositor handle space is exhausted; disposeGpu() to reset it.")
        }
    }
}

fn unknown_handle(handle: u32) -> JsValue {
    JsValue::from_str(&format!(
        "Compositor handle {handle} is not live. Create or initialize it first."
    ))
}

fn create_runtime(
    gpu_runtime: &crate::gpu::GpuRuntime,
    width: u32,
    height: u32,
) -> Result<CompositorRuntime, JsValue> {
    // On WebGL, wgpu is bound to a specific canvas. Its reported capacity is
    // one, so the single live handle owns that canvas. WebGPU can create an
    // independent canvas for every allowed handle.
    let canvas = if let Some(gl_canvas) = gpu_runtime.context.gl_canvas() {
        gl_canvas.clone()
    } else {
        let document = web_sys::window()
            .and_then(|window| window.document())
            .ok_or_else(|| JsValue::from_str("Document is not available"))?;
        document
            .create_element("canvas")?
            .dyn_into::<web_sys::HtmlCanvasElement>()
            .map_err(|_| JsValue::from_str("Failed to create compositor canvas"))?
    };
    canvas.set_width(width);
    canvas.set_height(height);

    let compositor = Compositor::new(&gpu_runtime.context);
    let surface = gpu_runtime
        .context
        .instance()
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    gpu_runtime
        .context
        .configure_surface(&surface, width, height)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    Ok(CompositorRuntime {
        canvas,
        compositor,
        surface,
        surface_size: (width, height),
    })
}

fn reserve_default() -> Result<(), JsValue> {
    let capacity = compositor_capacity();
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes
            .borrow()
            .reserve_default(capacity)
            .map_err(registry_error)
    })
}

fn reserve_explicit() -> Result<u32, JsValue> {
    let capacity = compositor_capacity();
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes
            .borrow_mut()
            .reserve_explicit(capacity)
            .map_err(registry_error)
    })
}

fn insert_runtime(handle: u32, runtime: CompositorRuntime) {
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes
            .borrow_mut()
            .insert(handle, Rc::new(RefCell::new(runtime)));
    });
}

fn runtime_for_handle(handle: u32) -> Result<Rc<RefCell<CompositorRuntime>>, JsValue> {
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes
            .borrow()
            .get(handle)
            .cloned()
            .ok_or_else(|| unknown_handle(handle))
    })
}

fn with_runtime<T>(
    handle: u32,
    action: impl FnOnce(&CompositorRuntime) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    let runtime = runtime_for_handle(handle)?;
    let borrow = runtime.borrow();
    action(&borrow)
}

fn with_runtime_mut<T>(
    handle: u32,
    action: impl FnOnce(&mut CompositorRuntime) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    let runtime = runtime_for_handle(handle)?;
    let mut borrow = runtime.borrow_mut();
    action(&mut borrow)
}

pub(crate) fn live_compositor_handles() -> Vec<u32> {
    COMPOSITOR_RUNTIMES.with(|runtimes| runtimes.borrow().handles())
}

pub(crate) fn reset_compositor_registry() {
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes.replace(HandleRegistry::default());
    });
}

#[wasm_bindgen(js_name = createCompositor)]
pub fn create_compositor(width: u32, height: u32) -> Result<u32, JsValue> {
    let handle = reserve_explicit()?;
    let runtime = with_gpu_runtime(|gpu_runtime| create_runtime(gpu_runtime, width, height))?;
    insert_runtime(handle, runtime);
    Ok(handle)
}

#[wasm_bindgen(js_name = initCompositor)]
pub fn init_compositor(width: u32, height: u32) -> Result<(), JsValue> {
    reserve_default()?;
    let runtime = with_gpu_runtime(|gpu_runtime| create_runtime(gpu_runtime, width, height))?;
    insert_runtime(DEFAULT_COMPOSITOR_HANDLE, runtime);
    Ok(())
}

#[wasm_bindgen(js_name = resizeCompositorForHandle)]
pub fn resize_compositor_for_handle(handle: u32, width: u32, height: u32) -> Result<(), JsValue> {
    with_gpu_runtime(|gpu_runtime| {
        with_runtime_mut(handle, |runtime| {
            runtime.canvas.set_width(width);
            runtime.canvas.set_height(height);
            if runtime.surface_size != (width, height) {
                gpu_runtime
                    .context
                    .configure_surface(&runtime.surface, width, height)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                runtime.surface_size = (width, height);
            }
            Ok(())
        })
    })
}

#[wasm_bindgen(js_name = resizeCompositor)]
pub fn resize_compositor(width: u32, height: u32) -> Result<(), JsValue> {
    resize_compositor_for_handle(DEFAULT_COMPOSITOR_HANDLE, width, height)
}

#[wasm_bindgen(js_name = getCompositorCanvasForHandle)]
pub fn get_compositor_canvas_for_handle(
    handle: u32,
) -> Result<web_sys::HtmlCanvasElement, JsValue> {
    with_runtime(handle, |runtime| Ok(runtime.canvas.clone()))
}

#[wasm_bindgen(js_name = getCompositorCanvas)]
pub fn get_compositor_canvas() -> Result<web_sys::HtmlCanvasElement, JsValue> {
    get_compositor_canvas_for_handle(DEFAULT_COMPOSITOR_HANDLE)
}

#[wasm_bindgen(js_name = uploadTextureForHandle)]
pub fn upload_texture_for_handle(handle: u32, options: JsValue) -> Result<(), JsValue> {
    let UploadTextureOptions {
        id,
        source,
        width,
        height,
    } = parse_upload_texture_options(options)?;

    with_gpu_runtime(|gpu_runtime| {
        let texture = import_canvas_texture(
            &gpu_runtime.context,
            &source,
            width,
            height,
            "compositor-upload-texture",
        );
        with_runtime_mut(handle, |runtime| {
            runtime.compositor.upsert_texture(id, texture);
            Ok(())
        })
    })
}

#[wasm_bindgen(js_name = uploadTexture)]
pub fn upload_texture(options: JsValue) -> Result<(), JsValue> {
    upload_texture_for_handle(DEFAULT_COMPOSITOR_HANDLE, options)
}

#[wasm_bindgen(js_name = releaseTextureForHandle)]
pub fn release_texture_for_handle(handle: u32, id: String) -> Result<(), JsValue> {
    with_runtime_mut(handle, |runtime| {
        runtime.compositor.release_texture(&id);
        Ok(())
    })
}

#[wasm_bindgen(js_name = releaseTexture)]
pub fn release_texture(id: String) -> Result<(), JsValue> {
    release_texture_for_handle(DEFAULT_COMPOSITOR_HANDLE, id)
}

#[wasm_bindgen(js_name = renderFrameForHandle)]
pub fn render_frame_for_handle(handle: u32, options: JsValue) -> Result<(), JsValue> {
    perf::reset();

    let t_deserialize = perf::now_ms();
    let frame: FrameDescriptor = serde_wasm_bindgen::from_value(options)
        .map_err(|error| JsValue::from_str(&format!("Invalid frame descriptor: {error}")))?;
    perf::record("wasm.deserialize", perf::now_ms() - t_deserialize);

    with_gpu_runtime(|gpu_runtime| {
        with_runtime_mut(handle, |runtime| {
            if runtime.surface_size != (frame.width, frame.height) {
                runtime.canvas.set_width(frame.width);
                runtime.canvas.set_height(frame.height);
                let t_surface = perf::now_ms();
                gpu_runtime
                    .context
                    .configure_surface(&runtime.surface, frame.width, frame.height)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                perf::record("wasm.surfaceConfigure", perf::now_ms() - t_surface);
                runtime.surface_size = (frame.width, frame.height);
            }

            if gpu_runtime.context.supports_surface_rendering() {
                let t_render = perf::now_ms();
                let result = runtime
                    .compositor
                    .render_frame(
                        &gpu_runtime.context,
                        RenderFrameOptions {
                            frame: &frame,
                            surface: &runtime.surface,
                        },
                    )
                    .map_err(|error| JsValue::from_str(&error.to_string()));
                perf::record("wasm.renderFrameToSurface", perf::now_ms() - t_render);
                result
            } else {
                let t_composite = perf::now_ms();
                let texture = runtime
                    .compositor
                    .render_frame_to_texture(&gpu_runtime.context, &frame)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                perf::record("wasm.compositeToTexture", perf::now_ms() - t_composite);

                let t_present = perf::now_ms();
                gpu_runtime
                    .context
                    .present_texture_to_surface(&texture, &runtime.surface)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                perf::record("wasm.presentToSurface", perf::now_ms() - t_present);
                Ok(())
            }
        })
    })
}

#[wasm_bindgen(js_name = renderFrame)]
pub fn render_frame(options: JsValue) -> Result<(), JsValue> {
    render_frame_for_handle(DEFAULT_COMPOSITOR_HANDLE, options)
}

#[wasm_bindgen(js_name = disposeCompositor)]
pub fn dispose_compositor(handle: u32) -> Result<(), JsValue> {
    COMPOSITOR_RUNTIMES.with(|runtimes| {
        runtimes.borrow_mut().remove(handle);
    });
    Ok(())
}

#[derive(Debug)]
struct UploadTextureOptions {
    id: String,
    source: wgpu::web_sys::OffscreenCanvas,
    width: u32,
    height: u32,
}

fn parse_upload_texture_options(value: JsValue) -> Result<UploadTextureOptions, JsValue> {
    let object: Object = value
        .dyn_into()
        .map_err(|_| JsValue::from_str("uploadTexture expects an options object"))?;

    Ok(UploadTextureOptions {
        id: read_serde_property(&object, "id")?,
        source: read_offscreen_canvas_property(&object, "source")?,
        width: read_u32_property(&object, "width")?,
        height: read_u32_property(&object, "height")?,
    })
}
