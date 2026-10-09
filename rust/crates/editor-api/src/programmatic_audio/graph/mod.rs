//! Admission primitives for the native HyperFrames audio graph adapter.
//! A normalized chain is not a capability declaration: graph execution remains
//! unavailable until its collection, scheduling and DSP path are connected.
mod assembly;
mod assembly_wire;
mod bus_pcm;
mod bus_schedule;
mod discovery;
mod dry;
mod execution;
mod execution_model;
mod facts;
mod fader;
mod fader_model;
mod fx;
mod fx_automation;
mod fx_automation_tail;
mod fx_automation_target;
#[cfg(test)]
mod fx_automation_tests;
mod fx_catalog;
mod fx_model;
mod fx_numbers;
mod fx_tail;
mod model;
mod native_window;
mod observations;
mod participation;
mod pcm;
mod plan;
mod plan_model;
mod rate_clock;
mod rate_lane;
mod rate_prepare;
#[cfg(test)]
mod rate_tests;
mod seek;
mod snapshot;
mod topology;
mod validation;
mod volume_lane;
mod working_set;

pub use assembly::{mix_hyperframes_audio_bus_pcm, mix_hyperframes_audio_master_pcm};
pub use bus_schedule::resolve_hyperframes_bus_fader_json;
pub use discovery::resolve_hyperframes_audio_discovery_json;
pub use dry::{apply_hyperframes_audio_track_gain_pcm, prepare_hyperframes_audio_dry_track_pcm};
pub use execution::resolve_hyperframes_audio_execution_plan_json;
pub use fx::normalize_hyperframes_fx_chain_json;
pub use observations::resolve_hyperframes_audio_observations_json;
pub use plan::resolve_hyperframes_audio_graph_json;
pub use seek::resolve_hyperframes_audio_seek_json;
