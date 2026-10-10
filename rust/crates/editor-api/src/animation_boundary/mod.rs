//! Explicit v1 scalar JSON boundary; not a legacy normalization or admission API.
//!
//! Times are local f64 ticks, without frame rounding, trim, or retime adjustment.
//! Keys require canonical time/value/segmentToNext and explicit extrapolation.
//! Optional handles contain integer dt and finite dv; key IDs and tangent metadata
//! are not part of this DTO. Callers normalize legacy channels before crossing it.
//! Integer fields use integer JSON tokens (not decimal/exponent spellings); this
//! avoids accepting a fractional token rounded to an integer during f64 parsing.
//! Optional means absent, not null. Inspection budgets are explicitly required.
//!
//! Limits cover input length/capacity, decoded strings, JSON depth/value count,
//! items, keys, samples, inspection nodes, and serialized output. They are not a
//! process-memory or elapsed-time guarantee. The bridge already allocated input;
//! rejecting its capacity cannot undo that allocation. No mutable cache is used.
//!
//! A batch-result is not all-success. Sampling is atomic per item, and consumers
//! must accept all required items before publishing a frame. Inspection is only a
//! report about this request: safe is not a persisted document certificate, and
//! unresolved is neither safe nor invalid. Consumers must bind any cached report
//! to every numeric input and their document/edit revision themselves.

mod channel;
mod inspect;
mod model;
mod parse;
mod read;
mod request;
mod sample;
mod serialize;

pub const VERSION: u8 = 1;
pub const NUMERIC_SEMANTICS: &str = "scalar-f64-v1";
pub const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_STRING_BYTES: usize = 256;
pub const MAX_JSON_DEPTH: usize = 16;
pub const MAX_JSON_NODES: usize = 1_000_000;
pub const MAX_ITEMS: usize = 128;
pub const MAX_ITEM_KEYS: usize = 8192;
pub const MAX_REQUEST_KEYS: usize = 32768;
pub const MAX_ITEM_SAMPLES: usize = 4096;
pub const MAX_REQUEST_SAMPLES: usize = 65536;
pub const MAX_REQUEST_NODES: u32 = 262144;

/// Returns values/error for every identified item, or one atomic request-error.
pub fn sample_scalar_animation_batch_json(input: String) -> String {
    execute(input, false)
}

/// Returns safe/violation/unresolved/error, never a blanket admission decision.
pub fn inspect_scalar_animation_domains_json(input: String) -> String {
    execute(input, true)
}

fn execute(input: String, inspection: bool) -> String {
    let result = if input.len() > MAX_INPUT_BYTES || input.capacity() > MAX_INPUT_BYTES {
        Err(model::Error::new("input-bytes", "$", "Input exceeds 8 MiB"))
    } else {
        parse::parse(&input).and_then(|value| request::prepare(value, inspection))
    };
    drop(input);
    let response = match result {
        Ok(request) if inspection => inspect::run(request),
        Ok(request) => sample::run(request),
        Err(error) => model::Response::request_error(error),
    };
    serialize::response(&response)
}
