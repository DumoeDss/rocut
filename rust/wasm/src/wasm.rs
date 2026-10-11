#[cfg(target_arch = "wasm32")]
mod canvas_capture_readback;
#[cfg(target_arch = "wasm32")]
mod capture_poll;
#[cfg(target_arch = "wasm32")]
mod compositor;
#[cfg(target_arch = "wasm32")]
mod effects;
#[cfg(all(target_arch = "wasm32", feature = "browser-readback-tests"))]
mod effects_readback;
#[cfg(any(target_arch = "wasm32", test))]
mod effects_readback_state;
#[cfg(target_arch = "wasm32")]
mod effects_readback_wait;
#[cfg(any(all(target_arch = "wasm32", feature = "browser-readback-tests"), test))]
mod effects_rgba_layout;
#[cfg(all(target_arch = "wasm32", feature = "browser-readback-tests"))]
mod effects_rgba_readback;
#[cfg(target_arch = "wasm32")]
mod gpu;
#[cfg(target_arch = "wasm32")]
#[path = "mv_heart_owner.rs"]
mod heart_owner_adapter;
#[cfg(target_arch = "wasm32")]
#[path = "mv_jz_owner.rs"]
mod jz_owner_adapter;
#[cfg(target_arch = "wasm32")]
#[path = "mv_lut_atlas.rs"]
mod lut_atlas_adapter;
#[cfg(target_arch = "wasm32")]
#[path = "mv_memories_owner.rs"]
mod memories_owner_adapter;
#[cfg(target_arch = "wasm32")]
#[path = "mv_night_owner.rs"]
mod night_owner_adapter;
#[cfg(target_arch = "wasm32")]
mod masks;
#[cfg(target_arch = "wasm32")]
mod liquid_object_transport;
#[cfg(target_arch = "wasm32")]
mod mv_image_preprocess;
#[cfg(target_arch = "wasm32")]
mod perf;
#[cfg(any(target_arch = "wasm32", test))]
mod render_requests;
#[cfg(any(target_arch = "wasm32", test))]
mod runtime_state;
#[cfg(target_arch = "wasm32")]
mod tunnel_font_stack;

pub use ::effects::{
    color_adjustment_catalog, normalize_color_adjustment, resolve_stylized_effect_json,
    stylized_effect_catalog_json,
};
#[cfg(target_arch = "wasm32")]
pub use compositor::*;
pub use editor_api::*;

#[bridge::export]
pub fn native_transition_style_validate_json(input: String) -> Result<String, String> {
    editor_api::native_transition_style_validate_json(&input)
}

#[bridge::export]
pub fn resolve_glass_object_params_json(input: String) -> String {
    editor_api::resolve_glass_object_params_json(input)
}

#[bridge::export]
pub fn resolve_liquid_object_params_json(input: String) -> String {
    editor_api::resolve_liquid_object_params_json(input)
}

#[bridge::export]
pub fn evaluate_liquid_object_frame_json(input: String) -> String {
    editor_api::evaluate_liquid_object_frame_json(input)
}

#[bridge::export]
pub fn liquid_object_transport_policy_json() -> String {
    editor_api::liquid_object_transport_policy_json()
}

#[bridge::export]
pub fn resolve_ink_object_params_json(input: String) -> String {
    editor_api::resolve_ink_object_params_json(input)
}
#[cfg(target_arch = "wasm32")]
pub use effects::*;
#[cfg(all(target_arch = "wasm32", feature = "browser-readback-tests"))]
pub use effects_readback::*;
#[cfg(all(target_arch = "wasm32", feature = "browser-readback-tests"))]
pub use effects_rgba_readback::*;
#[cfg(target_arch = "wasm32")]
pub use gpu::*;
#[cfg(target_arch = "wasm32")]
pub use heart_owner_adapter::*;
#[cfg(target_arch = "wasm32")]
pub use lut_atlas_adapter::*;
#[cfg(target_arch = "wasm32")]
pub use memories_owner_adapter::*;
#[cfg(target_arch = "wasm32")]
pub use night_owner_adapter::*;
#[cfg(target_arch = "wasm32")]
pub use masks::*;
#[cfg(target_arch = "wasm32")]
pub use liquid_object_transport::*;
pub use motion_text::*;
#[cfg(target_arch = "wasm32")]
pub use mv_image_preprocess::*;
#[cfg(target_arch = "wasm32")]
pub use perf::*;
pub use time::*;
pub use transaction_identity::*;
#[cfg(target_arch = "wasm32")]
pub use tunnel_font_stack::*;
