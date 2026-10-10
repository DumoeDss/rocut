//! Narrow wasm32 type check of the real policy/session and binding adapter.
//! Existing compiled dependencies are reused; this is not a package build.
extern crate self as editor_api;

#[path = "../../rust/crates/editor-api/src/liquid_object_transport.rs"]
mod transport;
pub use transport::*;

#[path = "../../rust/wasm/src/liquid_object_transport.rs"]
mod adapter;
pub use adapter::*;
