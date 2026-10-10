//! Uint8Array reference transport: Rust checks metadata/reserves before copying.
use editor_api::mv_night_owner::{
    validate_session_id, validate_transport_lengths, Owner, MAX_METADATA_CHARS,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;
fn error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}
fn text(value: &JsValue, max: usize) -> Result<String, JsValue> {
    let string = value
        .dyn_ref::<js_sys::JsString>()
        .ok_or_else(|| error("Night requires JSON string transport"))?;
    if string.length() as usize > max {
        return Err(error("Night string pre-copy bound exceeded"));
    }
    value
        .as_string()
        .ok_or_else(|| error("Night string conversion failed"))
}
fn result<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(error)
}
fn copy(bytes: &js_sys::Uint8Array) -> Result<Vec<u8>, String> {
    let length = bytes.length() as usize;
    let mut owned = Vec::new();
    owned.try_reserve_exact(length).map_err(|e| e.to_string())?;
    owned.resize(length, 0);
    bytes.copy_to(&mut owned);
    Ok(owned)
}
#[wasm_bindgen]
pub struct MvNightOwner {
    owner: Owner,
}
#[wasm_bindgen]
impl MvNightOwner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<MvNightOwner, JsValue> {
        Ok(Self {
            owner: Owner::new().map_err(error)?,
        })
    }
    pub fn preflight(&self, metadata: JsValue, length: f64) -> Result<(), JsValue> {
        if !length.is_finite()
            || length.fract() != 0.0
            || length < 1.0
            || length > 128.0 * 1024.0 * 1024.0
        {
            return Err(error("Night binary length coercion rejected"));
        }
        self.owner
            .preflight(&text(&metadata, MAX_METADATA_CHARS)?, length as usize)
            .map_err(error)
    }
    pub fn prepare(
        &mut self,
        metadata: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<JsValue, JsValue> {
        let string = metadata
            .dyn_ref::<js_sys::JsString>()
            .ok_or_else(|| error("Night metadata must be string"))?;
        validate_transport_lengths(string.length() as usize, bytes.length() as usize)
            .map_err(error)?;
        let metadata = text(&metadata, MAX_METADATA_CHARS)?;
        result(
            &self
                .owner
                .inspect_with(&metadata, bytes.length() as usize, || copy(&bytes))
                .map_err(error)?,
        )
    }
    #[wasm_bindgen(js_name=bindDecoded)]
    pub fn bind_decoded(&mut self, id: f64, facts: JsValue) -> Result<(), JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        self.owner
            .bind_decoded(id, &text(&facts, 64 * 1024)?)
            .map_err(error)
    }
    #[wasm_bindgen(js_name=bindReflection)]
    pub fn bind_reflection(
        &mut self,
        id: f64,
        rgba: js_sys::Uint8Array,
    ) -> Result<JsValue, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        self.owner
            .check_reflection(id, rgba.length() as usize)
            .map_err(error)?;
        result(
            &self
                .owner
                .bind_reflection(id, &copy(&rgba).map_err(error)?)
                .map_err(error)?,
        )
    }
    #[wasm_bindgen(js_name=prepareLut)]
    pub fn prepare_lut(
        &mut self,
        metadata: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<JsValue, JsValue> {
        let string = metadata
            .dyn_ref::<js_sys::JsString>()
            .ok_or_else(|| error("Night LUT metadata must be string"))?;
        editor_api::mv_lut_atlas_bridge::validate_transport_lengths(
            string.length() as usize,
            bytes.length() as usize,
        )
        .map_err(error)?;
        let metadata = text(&metadata, 128 * 1024)?;
        result(
            &self
                .owner
                .prepare_lut_with(&metadata, bytes.length() as usize, || copy(&bytes))
                .map_err(error)?,
        )
    }
    #[wasm_bindgen(js_name=bindLutRow)]
    pub fn bind_lut_row(&mut self, rgba: js_sys::Uint8Array) -> Result<JsValue, JsValue> {
        self.owner
            .check_lut_row(rgba.length() as usize)
            .map_err(error)?;
        let mut bytes = [0u8; 1024];
        rgba.copy_to(&mut bytes);
        result(&self.owner.bind_lut_row(&bytes).map_err(error)?)
    }
    pub fn evaluate(&mut self, id: f64, sample: JsValue) -> Result<JsValue, JsValue> {
        let id = validate_session_id(id).map_err(error)?;
        let sample = text(&sample, 4096)?;
        let frame = self.owner.evaluate(id, &sample).map_err(error)?;
        match result(&frame) {
            Ok(value) => Ok(value),
            Err(error) => {
                let _ = self.owner.release_frame(frame.frame_id);
                Err(error)
            }
        }
    }
    #[wasm_bindgen(js_name=releaseFrame)]
    pub fn release_frame(&mut self, id: f64) -> Result<(), JsValue> {
        self.owner
            .release_frame(validate_session_id(id).map_err(error)?)
            .map_err(error)
    }
    pub fn diagnostic(&self) -> Result<JsValue, JsValue> {
        result(&self.owner.diagnostic())
    }
    pub fn dispose(&mut self, id: f64) -> Result<(), JsValue> {
        self.owner
            .dispose(validate_session_id(id).map_err(error)?)
            .map_err(error)
    }
    pub fn clear(&mut self) -> Result<(), JsValue> {
        self.owner.clear().map_err(error)
    }
}
