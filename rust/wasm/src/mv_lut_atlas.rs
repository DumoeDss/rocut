//! Primitive-only WASM resource adapter. JS array sizes are inspected BEFORE copies.
use editor_api::mv_lut_atlas_bridge::{
    validate_row_lengths, validate_session_id, validate_transport_lengths, AtlasSessions,
    MAX_METADATA_CHARS,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;
fn error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}
fn bounded_string(value: &JsValue, max: usize) -> Result<String, JsValue> {
    let text = value
        .dyn_ref::<js_sys::JsString>()
        .ok_or_else(|| error("LUT atlas adapter requires JSON/string transport"))?;
    if text.length() as usize > max {
        return Err(error("LUT atlas adapter string exceeds pre-copy bound"));
    }
    value
        .as_string()
        .ok_or_else(|| error("LUT atlas adapter string conversion failed"))
}
fn result<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(error)
}
#[wasm_bindgen]
pub struct MvLutAtlasOwner {
    sessions: AtlasSessions,
}
#[wasm_bindgen]
impl MvLutAtlasOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            sessions: AtlasSessions::default(),
        }
    }
    pub fn prepare(
        &mut self,
        metadata: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<JsValue, JsValue> {
        let text = metadata
            .dyn_ref::<js_sys::JsString>()
            .ok_or_else(|| error("LUT atlas metadata must be JSON string"))?;
        let length = bytes.length() as usize;
        validate_transport_lengths(text.length() as usize, length).map_err(error)?;
        let metadata = bounded_string(&metadata, MAX_METADATA_CHARS)?;
        let mut owned = Vec::new();
        owned.try_reserve_exact(length).map_err(error)?;
        owned.resize(length, 0);
        bytes.copy_to(&mut owned);
        result(&self.sessions.prepare(&metadata, &owned).map_err(error)?)
    }
    pub fn sample(&self, id: f64, alias: JsValue) -> Result<JsValue, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        let alias = bounded_string(&alias, 128)?;
        result(&self.sessions.sample(id, &alias).map_err(error)?)
    }
    #[wasm_bindgen(js_name=resolveParameters)]
    pub fn resolve_parameters(&self, id: f64, parameters: JsValue) -> Result<JsValue, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        let json = bounded_string(&parameters, 128 * 1024)?;
        result(&self.sessions.resolve_parameters(id, &json).map_err(error)?)
    }
    #[wasm_bindgen(js_name=bindRow)]
    pub fn bind_row(
        &mut self,
        id: f64,
        alias: JsValue,
        rgba: js_sys::Uint8Array,
    ) -> Result<JsValue, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        validate_row_lengths(rgba.length() as usize).map_err(error)?;
        let alias = bounded_string(&alias, 128)?;
        self.sessions.sample(id, &alias).map_err(error)?;
        let mut bytes = [0u8; 1024];
        rgba.copy_to(&mut bytes);
        result(&self.sessions.bind_row(id, &alias, &bytes).map_err(error)?)
    }
    #[wasm_bindgen(js_name=rowPixels)]
    pub fn row_pixels(&self, id: f64, alias: JsValue) -> Result<Vec<u8>, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        let alias = bounded_string(&alias, 128)?;
        Ok(self
            .sessions
            .row_pixels(id, &alias)
            .map_err(error)?
            .pixels()
            .to_vec())
    }
    pub fn dispose(&mut self, id: f64) -> Result<(), JsValue> {
        self.sessions
            .dispose(validate_session_id(id).map_err(error)?);
        Ok(())
    }
    pub fn clear(&mut self) {
        self.sessions.clear()
    }
}
impl Default for MvLutAtlasOwner {
    fn default() -> Self {
        Self::new()
    }
}
