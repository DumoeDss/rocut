use editor_api::mv_jz_owner as core;
use wasm_bindgen::prelude::*;
fn error(v: String) -> JsValue {
    JsValue::from_str(&v)
}
#[wasm_bindgen]
pub struct MvJzOwner {
    owner: core::Owner,
}
#[wasm_bindgen]
impl MvJzOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            owner: core::Owner::new(),
        }
    }
    pub fn prepare(&mut self, metadata: String, bytes: js_sys::Uint8Array) -> Result<u32, JsValue> {
        self.owner
            .prepare_with(&metadata, bytes.length() as usize, || Ok(bytes.to_vec()))
            .map_err(error)
    }
    #[wasm_bindgen(js_name=preparedJson)]
    pub fn prepared_json(&self, session: u32) -> Result<String, JsValue> {
        self.owner.prepared_json(session).map_err(error)
    }
    pub fn frame(&mut self, session: u32, request: String) -> Result<String, JsValue> {
        self.owner.frame(session, &request).map_err(error)
    }
    #[wasm_bindgen(js_name=finishFrame)]
    pub fn finish_frame(&mut self, session: u32, serial: u32) -> Result<(), JsValue> {
        self.owner.finish_frame(session, serial).map_err(error)
    }
    #[wasm_bindgen(js_name = checkText)]
    pub fn check_text(&self, session: u32, font_id: String, text: String) -> Result<(), JsValue> {
        self.owner
            .check_text(session, &font_id, &text)
            .map_err(error)
    }
    pub fn release(&mut self, session: u32) -> Result<(), JsValue> {
        self.owner.release(session).map_err(error)
    }
    pub fn dispose(&mut self) {
        self.owner.dispose();
    }
}
