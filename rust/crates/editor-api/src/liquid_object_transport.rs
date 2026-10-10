//! Rust-owned per-frame admission. The Host creates this session from its
//! trusted mapped frame, never from an author's identity or serialized state.
#[path = "liquid_object_transport_policy.rs"]
mod policy;
#[path = "liquid_object_transport_session.rs"]
mod session;
#[path = "liquid_object_transport_types.rs"]
mod types;
pub use policy::{
    LiquidObjectTransportPolicy, liquid_object_transport_policy,
    liquid_object_transport_policy_json,
};
pub use session::LiquidObjectTransportSession;
pub use types::{
    LiquidObjectTransportError, LiquidObjectTransportFrame, LiquidObjectTransportIdentity,
    LiquidObjectTransportReservation, LiquidObjectTransportTotals,
};

#[cfg(test)]
#[path = "liquid_object_transport_tests.rs"]
mod tests;
