//! Live WASM objects, never serialized stage identities or JSON pixel arrays.
use editor_api::mv_memories_owner as core;
use wasm_bindgen::prelude::*;
fn error(message: String) -> JsValue {
    JsValue::from_str(&message)
}
#[wasm_bindgen(js_name=MvMemoriesOwner)]
pub struct MvMemoriesOwner {
    owner: core::Owner,
}
#[wasm_bindgen(js_name=MvMemoriesStage)]
pub struct MvMemoriesStage {
    stage: Option<core::Stage>,
}
#[wasm_bindgen(js_name=MvMemoriesOutput)]
pub struct MvMemoriesOutput {
    output: Option<core::Output>,
}
#[wasm_bindgen(js_name=MvMemoriesPreparation)]
pub struct MvMemoriesPreparation {
    preparation: Option<core::Preparation>,
}
#[wasm_bindgen]
impl MvMemoriesOwner {
    #[wasm_bindgen(js_name=sourceRequestsJson)]
    pub fn source_requests_json(args: String, resources: String) -> Result<String, JsValue> {
        core::Owner::source_requests_json(&args, &resources).map_err(error)
    }
    pub fn reserve(&self, bytes: u32) -> Result<MvMemoriesPreparation, JsValue> {
        Ok(MvMemoriesPreparation {
            preparation: Some(self.owner.reserve(u64::from(bytes)).map_err(error)?),
        })
    }
    #[wasm_bindgen(js_name=sourceAdmissionJson)]
    pub fn source_admission_json(
        args: String,
        resource: String,
        bytes: js_sys::Uint8Array,
    ) -> Result<String, JsValue> {
        if bytes.length() > 16 * 1024 * 1024 {
            return Err(error("Memories source ingress exceeds limit".into()));
        }
        core::Owner::source_admission_json(&args, &resource, &bytes.to_vec()).map_err(error)
    }
    #[wasm_bindgen(js_name=prepareReserved)]
    pub fn prepare_reserved(
        &mut self,
        mut ticket: MvMemoriesPreparation,
        metadata: String,
        encoded: js_sys::Uint8Array,
        rgba: js_sys::Uint8Array,
    ) -> Result<u32, JsValue> {
        self.owner
            .prepare_reserved_with(
                ticket
                    .preparation
                    .take()
                    .ok_or_else(|| error("Memories preparation consumed".into()))?,
                &metadata,
                encoded.length() as usize,
                rgba.length() as usize,
                || Ok((encoded.to_vec(), rgba.to_vec())),
            )
            .map_err(error)
    }
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<Self, JsValue> {
        Ok(Self {
            owner: core::Owner::new().map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name=capabilityJson)]
    pub fn capability_json() -> Result<String, JsValue> {
        core::Owner::capability_json().map_err(error)
    }
    #[wasm_bindgen(js_name=diagnosticJson)]
    pub fn diagnostic_json(&self) -> Result<String, JsValue> {
        self.owner.diagnostic_json().map_err(error)
    }
    #[wasm_bindgen(js_name=measurementRequestsJson)]
    pub fn measurement_requests_json(args: String) -> Result<String, JsValue> {
        core::Owner::measurement_requests_json(&args).map_err(error)
    }
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
    #[wasm_bindgen(js_name=beginStage)]
    pub fn begin_stage(
        &mut self,
        session: u32,
        kind: String,
        slot: u32,
    ) -> Result<MvMemoriesStage, JsValue> {
        Ok(MvMemoriesStage {
            stage: Some(
                self.owner
                    .begin_stage(session, &kind, slot as usize)
                    .map_err(error)?,
            ),
        })
    }
    #[wasm_bindgen(js_name=acceptStage)]
    pub fn accept_stage(
        &mut self,
        session: u32,
        mut stage: MvMemoriesStage,
        metadata: String,
        rgba: js_sys::Uint8Array,
    ) -> Result<Option<MvMemoriesOutput>, JsValue> {
        let stage = stage
            .stage
            .take()
            .ok_or_else(|| error("Memories stage already consumed".into()))?;
        Ok(self
            .owner
            .accept_stage_with(session, stage, &metadata, rgba.length() as usize, || {
                Ok(rgba.to_vec())
            })
            .map_err(error)?
            .map(|output| MvMemoriesOutput {
                output: Some(output),
            }))
    }
    #[wasm_bindgen(js_name=cancelStage)]
    pub fn cancel_stage(
        &mut self,
        session: u32,
        mut stage: MvMemoriesStage,
    ) -> Result<(), JsValue> {
        self.owner
            .cancel_stage(
                session,
                stage
                    .stage
                    .take()
                    .ok_or_else(|| error("Memories stage already consumed".into()))?,
            )
            .map_err(error)
    }
    #[wasm_bindgen(js_name=preparedJson)]
    pub fn prepared_json(&mut self, session: u32) -> Result<String, JsValue> {
        self.owner.prepared_json(session).map_err(error)
    }
    #[wasm_bindgen(js_name=preparedBytes)]
    pub fn prepared_bytes(
        &mut self,
        session: u32,
        index: u32,
    ) -> Result<js_sys::Uint8Array, JsValue> {
        self.owner
            .prepared_bytes(session, index as usize, |bytes| {
                Ok(js_sys::Uint8Array::from(bytes))
            })
            .map_err(error)
    }
    pub fn frame(&mut self, session: u32, input: String) -> Result<MvMemoriesOutput, JsValue> {
        Ok(MvMemoriesOutput {
            output: Some(self.owner.frame(session, &input).map_err(error)?),
        })
    }
    #[wasm_bindgen(js_name=finishFrame)]
    pub fn finish_frame(
        &mut self,
        session: u32,
        mut output: MvMemoriesOutput,
    ) -> Result<(), JsValue> {
        self.owner
            .finish_frame(
                session,
                output
                    .output
                    .take()
                    .ok_or_else(|| error("Memories output already consumed".into()))?,
            )
            .map_err(error)
    }
    pub fn cancel(&mut self, session: u32) -> bool {
        self.owner.cancel(session)
    }
    pub fn dispose(&mut self) {
        self.owner.dispose();
    }
}
#[wasm_bindgen]
impl MvMemoriesStage {
    pub fn json(&self) -> Result<String, JsValue> {
        self.stage
            .as_ref()
            .ok_or_else(|| error("Memories stage consumed".into()))?
            .json()
            .map_err(error)
    }
    pub fn bytes(&mut self, index: u32) -> Result<js_sys::Uint8Array, JsValue> {
        self.stage
            .as_mut()
            .ok_or_else(|| error("Memories stage consumed".into()))?
            .bytes(index as usize, |bytes| Ok(js_sys::Uint8Array::from(bytes)))
            .map_err(error)
    }
}
#[wasm_bindgen]
impl MvMemoriesOutput {
    pub fn json(&self) -> Result<String, JsValue> {
        Ok(self
            .output
            .as_ref()
            .ok_or_else(|| error("Memories output consumed".into()))?
            .json()
            .into())
    }
    pub fn bytes(&mut self, index: u32) -> Result<js_sys::Uint8Array, JsValue> {
        self.output
            .as_mut()
            .ok_or_else(|| error("Memories output consumed".into()))?
            .bytes(index as usize, |bytes| Ok(js_sys::Uint8Array::from(bytes)))
            .map_err(error)
    }
}
