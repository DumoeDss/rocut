//! Host-owned opaque frame admission state. Author pages never receive this owner.
use editor_api::{LiquidObjectTransportSession, liquid_object_transport_policy};
use wasm_bindgen::prelude::*;

fn control_text(input: &JsValue) -> Result<String, JsValue> {
    let text = input
        .dyn_ref::<js_sys::JsString>()
        .ok_or_else(|| JsValue::from_str("Liquid control requires JSON text"))?;
    if text.length() as usize > liquid_object_transport_policy().max_control_json_bytes {
        return Err(JsValue::from_str("Liquid control exceeds pre-copy bound"));
    }
    input
        .as_string()
        .ok_or_else(|| JsValue::from_str("Liquid control text conversion failed"))
}

#[wasm_bindgen]
pub struct LiquidObjectTransportOwner {
    session: LiquidObjectTransportSession,
}

#[wasm_bindgen]
impl LiquidObjectTransportOwner {
    #[wasm_bindgen(constructor)]
    pub fn new(frame: JsValue) -> Result<LiquidObjectTransportOwner, JsValue> {
        let json = control_text(&frame)?;
        let session = LiquidObjectTransportSession::from_frame_json(&json)
            .map_err(|error| JsValue::from_str(error.message))?;
        Ok(Self { session })
    }

    pub fn command(&mut self, input: JsValue) -> Result<String, JsValue> {
        match control_text(&input) {
            Ok(json) => Ok(self.session.command_json(&json)),
            Err(error) => {
                // A transport rejection must terminate the same opaque state;
                // callers cannot retry malformed inputs against a fresh budget.
                self.session.command_json("");
                Err(error)
            }
        }
    }
}
