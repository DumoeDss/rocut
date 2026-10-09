use std::{
    cell::RefCell,
    future::Future,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll},
};

use gpu::wgpu;
use js_sys::{Function, Reflect};
use wasm_bindgen::{JsCast, JsValue, closure::Closure};

use crate::effects_readback_state::{MapState, ReadbackProgress};

const POLL_INTERVAL_MS: i32 = 4;

pub(crate) struct MapWait {
    device: wgpu::Device,
    webgl: bool,
    state: Rc<RefCell<MapState>>,
    performance: web_sys::Performance,
    progress: ReadbackProgress,
    global: js_sys::Object,
    set_timeout: Function,
    clear_timeout: Function,
    timer_id: Option<JsValue>,
    timer_callback: Closure<dyn FnMut()>,
}

impl MapWait {
    pub(crate) fn start(
        device: &wgpu::Device,
        buffer: &wgpu::Buffer,
        webgl: bool,
    ) -> Result<Self, JsValue> {
        let global = js_sys::global();
        let performance: web_sys::Performance =
            Reflect::get(&global, &"performance".into())?.dyn_into()?;
        let set_timeout: Function = Reflect::get(&global, &"setTimeout".into())?.dyn_into()?;
        let clear_timeout: Function = Reflect::get(&global, &"clearTimeout".into())?.dyn_into()?;
        let progress = ReadbackProgress::new(performance.now()).map_err(JsValue::from_str)?;
        let state = Rc::new(RefCell::new(MapState::default()));
        let timer_state = Rc::clone(&state);
        let timer_callback = Closure::new(move || {
            let waker = timer_state.borrow_mut().tick();
            if let Some(waker) = waker {
                waker.wake();
            }
        });
        let map_state = Rc::clone(&state);
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let waker = map_state
                    .borrow_mut()
                    .settle(result.map_err(|error| error.to_string()));
                if let Some(waker) = waker {
                    waker.wake();
                }
            });
        Ok(Self {
            device: device.clone(),
            webgl,
            state,
            performance,
            progress,
            global,
            set_timeout,
            clear_timeout,
            timer_id: None,
            timer_callback,
        })
    }
}

impl Future for MapWait {
    type Output = Result<(), JsValue>;

    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        if let Err(error) = this.progress.check(this.performance.now()) {
            return Poll::Ready(Err(JsValue::from_str(error)));
        }
        let timer_ready = this.state.borrow_mut().timer_ready;
        if timer_ready {
            this.state.borrow_mut().timer_ready = false;
            this.timer_id = None;
        }
        if this.progress.should_poll(timer_ready) {
            // Browser GL cannot block for a fence; WebGPU progresses on its own event loop.
            if this.webgl {
                if let Err(error) = this.device.poll(wgpu::PollType::Poll) {
                    return Poll::Ready(Err(JsValue::from_str(&error.to_string())));
                }
            }
        }
        {
            let mut state = this.state.borrow_mut();
            if let Some(result) = state.result.take() {
                return Poll::Ready(result.map_err(|error| JsValue::from_str(&error)));
            }
            state.waker = Some(context.waker().clone());
        }
        if this.timer_id.is_none() {
            match this.set_timeout.call2(
                &this.global,
                this.timer_callback.as_ref(),
                &JsValue::from(POLL_INTERVAL_MS),
            ) {
                Ok(id) => this.timer_id = Some(id),
                Err(error) => return Poll::Ready(Err(error)),
            }
        }
        Poll::Pending
    }
}

impl Drop for MapWait {
    fn drop(&mut self) {
        self.state.borrow_mut().close();
        if let Some(id) = self.timer_id.take() {
            let _ = self.clear_timeout.call1(&self.global, &id);
        }
    }
}
