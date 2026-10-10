//! Dedicated binary adapter: original JSON-only frame API remains unchanged.
use wasm_bindgen::prelude::*;
#[wasm_bindgen(js_name = resolveProgrammaticFrameTunnelJson)]
pub fn resolve_programmatic_frame_tunnel_json(
    input: String,
    layout: String,
    bytes: js_sys::Uint8Array,
) -> String {
    let length = bytes.length() as usize;
    if let Err(error) =
        editor_api::validate_tunnel_frame_transport_lengths(input.len(), layout.len(), length)
    {
        return editor_api::tunnel_frame_transport_error_json(error);
    }
    // wasm-bindgen must not copy an unbounded &[u8] argument before admission.
    let mut owned = Vec::new();
    if owned.try_reserve_exact(length).is_err() {
        return editor_api::tunnel_frame_transport_error_json(
            "Tunnel font transport allocation failed".into(),
        );
    }
    owned.resize(length, 0);
    bytes.copy_to(&mut owned);
    editor_api::resolve_programmatic_frame_tunnel_bytes(input, layout, &owned)
}
