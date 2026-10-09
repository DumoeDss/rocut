//! Persistent render-owner sessions. This class accepts platform-admitted pixels,
//! never an authored recipe's allocation limit or prepared result.
use editor_api::mv_image_preprocess::{Binding, Budget, Request, Sessions};
use wasm_bindgen::prelude::*;

fn error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn external_bytes(value: f64) -> Result<u64, JsValue> {
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=268_435_456.0).contains(&value) {
        return Err(error("Invalid Flame joint residency"));
    }
    Ok(value as u64)
}

#[wasm_bindgen]
pub struct MvImagePreprocessOwner {
    sessions: Sessions,
}

#[wasm_bindgen]
impl MvImagePreprocessOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            sessions: Sessions::default(),
        }
    }

    /// Canonical request/key and ROI come from the same Rust implementation as
    /// the producer. JSON is metadata only; input and output pixels are binary.
    pub fn request(&self, binding: JsValue) -> Result<JsValue, JsValue> {
        let binding: Binding = serde_wasm_bindgen::from_value(binding).map_err(error)?;
        let request = Request::new(binding).map_err(error)?;
        serde_wasm_bindgen::to_value(&request).map_err(error)
    }

    pub fn key(&self, binding: JsValue) -> Result<String, JsValue> {
        let binding: Binding = serde_wasm_bindgen::from_value(binding).map_err(error)?;
        Request::new(binding)
            .map_err(error)?
            .patch_key()
            .map_err(error)
    }

    pub fn admit(&self, bytes: f64) -> Result<(), JsValue> {
        self.sessions
            .admit_external(external_bytes(bytes)?)
            .map_err(error)
    }

    pub fn begin(&mut self, binding: JsValue, rgba: &[u8], bytes: f64) -> Result<u64, JsValue> {
        let binding: Binding = serde_wasm_bindgen::from_value(binding).map_err(error)?;
        self.sessions
            .begin_rgba(&binding, rgba, &Budget::joint(external_bytes(bytes)?))
            .map_err(error)
    }

    pub fn step(&mut self, id: u64, max_pixels: u32) -> Result<bool, JsValue> {
        Ok(self.sessions.step(id, max_pixels).map_err(error)?.complete)
    }

    pub fn take(&mut self, id: u64, binding: JsValue) -> Result<Vec<u8>, JsValue> {
        let binding: Binding = serde_wasm_bindgen::from_value(binding).map_err(error)?;
        self.sessions
            .take(id, &binding)
            .map_err(error)?
            .into_envelope()
            .map_err(error)
    }

    pub fn dispose(&mut self, id: u64) {
        self.sessions.dispose(id);
    }
}
