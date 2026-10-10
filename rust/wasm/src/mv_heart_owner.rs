//! Object capability owned by one native render lifetime. No persistent token,
//! JSON pixel arrays, authored Session deserialization or global handle lookup.
use wasm_bindgen::prelude::*;
fn error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

#[wasm_bindgen(js_name = MvHeartOwner)]
pub struct MvHeartOwner {
    owner: editor_api::mv_heart_owner::Owner,
}
#[wasm_bindgen]
impl MvHeartOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<MvHeartOwner, JsValue> {
        Ok(Self {
            owner: editor_api::mv_heart_owner::Owner::new().map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name = capabilityJson)]
    pub fn capability_json() -> Result<String, JsValue> {
        editor_api::mv_heart_owner::Owner::capability_json().map_err(error)
    }
    #[wasm_bindgen(js_name = diagnosticJson)]
    pub fn diagnostic_json(&self) -> Result<String, JsValue> {
        self.owner.diagnostic_json().map_err(error)
    }
    /// Host-owned binary snapshots; generated JS passes typed arrays directly.
    pub fn prepare(
        &mut self,
        metadata: String,
        encoded: js_sys::Uint8Array,
        rgba: js_sys::Uint8Array,
    ) -> Result<u32, JsValue> {
        self.owner
            .prepare_with(
                &metadata,
                encoded.length() as usize,
                rgba.length() as usize,
                || Ok((encoded.to_vec(), rgba.to_vec())),
            )
            .map_err(error)
    }
    #[wasm_bindgen(js_name = prepareSky)]
    pub fn prepare_sky(
        &mut self,
        metadata: String,
        encoded: js_sys::Uint8Array,
        rgba: js_sys::Uint8Array,
    ) -> Result<u32, JsValue> {
        self.owner
            .prepare_sky_with(
                &metadata,
                encoded.length() as usize,
                rgba.length() as usize,
                || Ok((encoded.to_vec(), rgba.to_vec())),
            )
            .map_err(error)
    }
    #[wasm_bindgen(js_name = manifestJson)]
    pub fn manifest_json(&mut self, session: u32) -> Result<String, JsValue> {
        self.owner.manifest_json(session).map_err(error)
    }
    #[wasm_bindgen(js_name = imageBytes)]
    pub fn image_bytes(&mut self, session: u32, index: u32) -> Result<js_sys::Uint8Array, JsValue> {
        self.owner
            .with_image_bytes(session, index, |bytes| Ok(js_sys::Uint8Array::from(bytes)))
            .map_err(error)
    }
    #[wasm_bindgen(js_name = frameJson)]
    pub fn frame_json(&mut self, session: u32, metadata: String) -> Result<String, JsValue> {
        self.owner.frame_json(session, &metadata).map_err(error)
    }
    pub fn cancel(&mut self, session: u32) -> Result<bool, JsValue> {
        self.owner.cancel(session).map_err(error)
    }
    pub fn dispose(&mut self) -> Result<(), JsValue> {
        self.owner.dispose().map_err(error)
    }
}
